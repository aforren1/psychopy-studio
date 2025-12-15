import { app, BrowserWindow } from 'electron';
import proc from "child_process";
import { platform, arch } from "process";
import logging from "./logging.js";
import path from "path";
import fs from "fs";
import unzip from "extract-zip";
import { extract as untar } from "tar";
import { appVersion, isDev } from "./version.js";

let decoder = new TextDecoder();


/**
 * Execute a function with output sent to the front end
 */
async function execTracked(args) {
    // execute asynchronously
    let prog = proc.spawn(
        uv.executable,
        args
    )
    // pass output to front end
    prog.stdout.on("data", evt => uv.output(evt))
    prog.stderr.on("data", evt => uv.output(evt))
    // await completion/error
    let promise = Promise.withResolvers()
    prog.on("close", (code, signal) => promise.resolve([code, signal]))
    prog.on("error", err => promise.reject(err))

    return promise.promise
}

export async function installUV() {
    // make sure folder exists
    fs.mkdirSync(uv.dir, {
        recursive: true
    })
    // map installers to system architectures
    let installers = {
        win32: {
            x64: "uv-x86_64-pc-windows-msvc.zip",
            x86: "uv-i686-pc-windows-msvc.zip",
            arm64: "uv-aarch64-pc-windows-msvc.zip",
        },
        darwin: {
            x64: "uv-x86_64-apple-darwin.tar.gz",
            arm64: "uv-aarch64-apple-darwin.tar.gz"
        },
        linux: {
            x64: "uv-x86_64-unknown-linux-gnu.tar.gz",
            x86: "uv-i686-unknown-linux-gnu.tar.gz",
            arm: "uv-armv7-unknown-linux-gnueabihf.tar.gz",
            arm64: "uv-aarch64-unknown-linux-gnu.tar.gz",
            ppc: "uv-powerpc64-unknown-linux-gnu.tar.gz",
            s390x: "uv-s390x-unknown-linux-gnu.tar.gz",
            ppc64: "uv-powerpc64le-unknown-linux-gnu.tar.gz",
            ricsv: "uv-riscv64gc-unknown-linux-gnu.tar.gz",
        }
    }
    // Linux requires some further distinctions
    if (platform === "linux") {
        // use different installers for MUSL linux
        if (!process.report.getReport().header?.glibcVersionRuntime) {
            installers.linux = {
                x64: "uv-x86_64-unknown-linux-musl.tar.gz",
                x86: "uv-i686-unknown-linux-musl.tar.gz",
                arm: "uv-armv7-unknown-linux-musleabihf.tar.gz",
                arm64: "uv-aarch64-unknown-linux-musl.tar.gz",
            }
        }
    }
    // get relevant executable 
    await fetch(
        `https://github.com/astral-sh/uv/releases/download/0.8.18/${installers[platform][arch]}`
    ).then(
        resp => resp.blob()
    ).then(
        async blob => {
            // write to a zipped file
            let zipfile = path.join(uv.dir, installers[platform][arch]);
            fs.writeFileSync(zipfile, await blob.bytes());
            // extract file
            if (path.extname(zipfile) === ".zip") {
                // extract zip file...
                await unzip(zipfile, {
                    dir: uv.dir
                })
            }
            if (path.extname(zipfile) === ".gz") {
                // extract tar.gz file...
                untar({
                    file: zipfile,
                    cwd: uv.dir,
                    strip: 1,
                    sync: true
                })
            }
            // delete zip file
            fs.unlink(zipfile, err => { if (err) throw err })
        }
    )
}

export function findPython(
    version = { python: "3.10", psychopy: appVersion.major },
    folder = path.join(app.getPath("appData"), "psychopy4", ".python")
) {
    // make sure version has necessary keys
    version.python = version.python || "3.10"
    version.psychopy = version.psychopy || appVersion.major
    // get specific folder for this version
    folder = path.join(app.getPath("appData"), "psychopy4", ".python", version.psychopy)
    // try using UV to search for a Python executable
    try {
        return decoder.decode(
            proc.execSync(`"${uv.executable}" python find "${folder}"`)
        ).trim()
    } catch (err) {
        // if this fails, return undefined (as there is none)
        return
    }
}


export async function listPackageVersions(name) {
    // ask uvs for available versions
    try {
        let resp = decoder.decode(
            proc.execSync(`"${uv.executable}x" pip index versions ${name}`)
        );
    } catch {
        // if this fails, return a blank list
        return []
    }
    // get string with versions in
    let versionsStr = resp.match(/Available versions:(.*)/)[1]
    // if none listed, return a blank list
    if (!versionsStr) {
        return []
    }
    // parse the response to an array
    return versionsStr.split(",").map(
        version => version.trim()
    )
}


export async function installPython(
    version = { python: "3.10", psychopy: appVersion },
    folder = path.join(app.getPath("appData"), "psychopy4", ".python")
) {
    // make sure version has necessary keys
    version.python = version.python || "3.10"
    version.psychopy = version.psychopy || appVersion
    // get specific folder for this version
    folder = path.join(app.getPath("appData"), "psychopy4", ".python", version.psychopy.major)
    // make sure folder exists
    fs.mkdirSync(folder, {
        recursive: true
    })
    // make a new venv
    proc.execSync(`"${uv.executable}" venv --python ${version.python} --clear "${folder}"`)
    // get executable
    const pythonExecutable = findPython(); // Use local variable instead of python.details.executable
    // install liaison
    proc.execSync(`"${uv.executable}" pip install git+https://github.com/psychopy/liaison[websocket] --python "${pythonExecutable}"`)
    // install metapensiero, esprima (Py -> JS translation) and PyQt (expInfo dialog)
    proc.execSync(`"${uv.executable}" pip install pyqt6 esprima git+https://gitlab.com/peircej/metapensiero.pj --python "${pythonExecutable}"`)
    // install psychopy
    if (version.psychopy.major === "dev") {
        proc.execSync(
            `"${uv.executable}" pip install git+https://github.com/psychopy/psychopy-lib@dev --python "${pythonExecutable}"`
        )
    } else {
        // get known versions of PsychoPy
        let versions = await listPackageVersions("psychopy-lib")
        // if version exists, install from pip
        if (versions.some(item => item.startsWith(version.psychopy.major))) {
            proc.execSync(
                `"${uv.executable}" pip install psychopy-lib=="${version.psychopy.str}" --python "${pythonExecutable}"`
            )
        } else {
            // if unreleased, install from the release branch
            proc.execSync(
                `"${uv.executable}" pip install git+https://github.com/psychopy/psychopy-lib --python "${pythonExecutable}"`
            )
        }
    }

    // Return the executable path so the caller can update python.details.executable
    return pythonExecutable;
}


export async function installPackage(name, executable) {
    // log start
    uv.output(
        `Installing ${name}...`
    )
    // install
    let resp = await execTracked(
        ["pip", "install", name, "--python", executable]
    )
    // log done
    uv.output(
        `Finished installing ${name}.`
    )

    return resp
}


export async function uninstallPackage(name, executable) {
    // log start
    uv.output(
        `Uninstalling ${name}...`
    )
    // uninstall
    let resp = await execTracked(
        ["pip", "uninstall", name, "--python", executable]
    )
    // log done
    uv.output(
        `Finished uninstalling ${name}.`
    )

    return resp
}


export function getPackages(executable) {
    // get package list from pip
    let resp = decoder.decode(
        proc.execSync(`"${uv.executable}" pip list --python "${executable}" --format json`)
    )
    // parse it
    let output = Object.fromEntries(
        JSON.parse(resp).map(val => [val.name, val.version])
    )

    return output
}


export async function getPackageDetails(name, executable) {
    // use pip show to get details
    let resp = decoder.decode(
        proc.execSync(`"${uv.executable}" pip show ${name} --python "${executable}"`)
    );
    // parse as an object
    let local = Object.fromEntries(
        resp.matchAll(/^(.*?): (.*?)$/gm).map(val => [val[1], val[2]])
    );
    // coerce to PyPi esque format
    let pypi = {
        info: {
            name: local.Name,
            version: local.Version,
            requires_dist: local.Requires
        },
        releases: {
            [local.Version]: []
        }
    }
    // get package from pypi if possible
    let online
    try {
        // request
        online = await fetch(`https://pypi.org/pypi/${name}/json`, { cache: "force-cache" }).then(resp => resp.json());
    } catch {
        // fail silently
        online = {}
    }
    // apply to existing info object
    Object.assign(pypi, online)

    return pypi
}


export function getEnvironments(
    folder = path.join(app.getPath("appData"), "psychopy4", ".python")
) {
    let output = {}
    // iterate through subfolders in the python folder
    for (let subfolder of fs.readdirSync(folder)) {
        let executable
        let ppyVersion
        try {
            // look for an executable in this folder
            executable = decoder.decode(
                proc.execSync(`"${uv.executable}" python find "${path.join(folder, subfolder)}"`)
            ).trim()
            // get version of PsychoPy
            ppyVersion = decoder.decode(
                proc.execSync(`"${uv.executable}" pip show psychopy --python "${executable}"`)
            ).match(/Version: (\d+\.\d+\.\d+)/)[1]
        } catch (err) {
            // skip if none found
            continue
        }
        // store
        output[subfolder] = {
            executable: executable,
            version: ppyVersion
        }
    }

    return output
}


export var uv = {
    dir: path.join(app.getPath("appData"), "psychopy4", ".uv"),
    executable: path.join(app.getPath("appData"), "psychopy4", ".uv", "uv"),
    output: (message) => {
        // if given a buffer, decode it
        if (message instanceof Buffer) {
            message = decoder.decode(message)
        }
        // log message
        logging.log(message, "UV")
        // emit event
        BrowserWindow.getAllWindows().forEach(
            win => win.webContents.send("uv", message)
        )
    },
    exists: () => fs.globSync("uv*", { cwd: uv.dir }).length > 0,
    installUV: installUV,
    installPython: installPython,
    findPython: findPython,
    getEnvironments: getEnvironments,
    installPackage: installPackage,
    uninstallPackage: uninstallPackage,
    getPackages: getPackages,
    getPackageDetails: getPackageDetails,
}