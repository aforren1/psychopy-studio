const path = require('node:path');
const fs = require("fs");
const proc = require("child_process");
const { VelopackApp } = require('velopack');
const { app, dialog, BrowserWindow, ipcMain, shell } = require('electron');

// make sure psychopy4 folder exists before importing subpackages
if (!fs.existsSync(path.join(app.getPath("appData"), "psychopy4"))) {
  fs.mkdirSync(
    path.join(app.getPath("appData"), "psychopy4")
  )
}

const { python } = require("./pythonJS/python.js");
const { uv } = require("./uv.js");
const logging = require("./logging.js");
const { appVersion, isDev } = require('./version.js');

VelopackApp.build().run();

// figure out best file to use for a favicon
var favicon = path.join(__dirname, 'favicon')
if (process.platform === "win32") {
  favicon += ".ico"
} else if (process.platform === "darwin") {
  favicon += ".icns"
} else {
  favicon += "@1024x1024.png"
}

var svelte = {
  address: {
    host: "localhost",
    port: 8003,
  },
  process: undefined
};
var windows = {
  splash: undefined
};

// redirect app gubbins to a subfolder so it's distinct from user data
app.setPath("userData", path.join(app.getPath("appData"), "psychopy4", ".node"))

// setup a clipboard
clipboard = undefined


const createWindow = () => {
  // create splash
  windows.splash = new BrowserWindow({
    icon: favicon,
    title: "PsychoPy",
    width: 720,
    height: 400,
    show: false,
    transparent: true,
    frame: false,
    alwaysOnTop: true
  });
  windows.splash.loadFile(path.join(__dirname, 'splash.html'));
  windows.splash.center();
  windows.splash.show();

  // keep track of ready statuses
  let ready = {
    svelte: Promise.withResolvers()
  }
  // start timers 
  let mintime = new Promise((resolve, reject) => setTimeout(resolve, 1000));
  let maxtime = new Promise((resolve, reject) => setTimeout(resolve, 10000));
  // start the svelte side of things
  if (isDev) {
    // use Vite dev server for development
    logging.log(`Starting Vite dev server at ${svelte.address.host}:${svelte.address.port}`)
    svelte.process = proc.exec(`vite dev --host=${svelte.address.host} --port=${svelte.address.port}`);
    svelte.process.stdout.on("data", msg => {
      // look for ready message
      let readyMatch = msg.match(
        /➜  Local:   http:\/\/(?<host>[\w\d]+):(?<port>[\w\d]+)/
      )
      // if this is it...
      if (readyMatch) {
        // store final host and port
        svelte.address.host = readyMatch.groups.host
        svelte.address.port = readyMatch.groups.port
        // mark as ready
        ready.svelte.resolve()
        // log
        logging.log(
          `Started Vite dev server at ${svelte.address.host}:${svelte.address.port}`
        )
      }
    })
  } else {
    // use express to serve static files in production
    const express = require('express');
    const app = express();

    app.use(express.static(path.join(__dirname, '../../dist')));

    // Handle SPA fallback without wildcard
    app.use((req, res) => {
      res.sendFile(path.join(__dirname, '../../dist/index.html'));
    });

    const server = app.listen(svelte.address.port, svelte.address.host, () => {
      logging.log(`Started static server at ${svelte.address.host}:${svelte.address.port}`)
      ready.svelte.resolve();
    });

    svelte.process = { kill: () => server.close() };
  }

  // show when Svelte has loaded and min time has been reached, or when max time has been reached
  Promise.any([
    Promise.all([
      mintime,
      ...Object.values(ready).map(val => val.promise)
    ]),
    maxtime
  ]).then(
    () => newWindow("builder", true, false)
  )
};


async function newWindow(target = null, show = true, fullscreen = false, debug = isDev) {
  // create window
  let win = new BrowserWindow({
    icon: favicon,
    width: 1600,
    height: 900,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js')
    }
  });
  win.removeMenu();
  // open new windows in browser unless opened by electron
  win.webContents.setWindowOpenHandler(
    ({ url }) => {
      shell.openExternal(url);

      return { action: 'deny' }
    }
  )

  // load target URL
  let url = `http://${svelte.address.host}:${svelte.address.port}/${target || ''}`;
  logging.log(`Loading ${url}...`)
  win.loadURL(url);
  // store handle against id
  windows[win.webContents.id] = win;
  // create promise waiting for ready event
  let ready = Promise.withResolvers()
  // show when ready (if requested)
  if (show) {
    // show once ready, if requested
    win.once("ready-to-show", evt => {
      logging.log(`Loaded ${url}`)
      win.show();
      // fulscreen if requested
      if (fullscreen) {
        win.maximize();
      }
      // give focus
      win.focus();
      // make sure the splash screen is closed
      if (!windows.splash.isDestroyed()) {
        windows.splash.close()
      }
      // show dev tools if debugging
      if (debug) {
        win.webContents.openDevTools();
      }
    })
    // return ID once ready message is received (has to be sent via electron.windows.emit)
    win.webContents.on("ipc-message", (evt, tag) => {
      if (tag === "ready") {
        ready.resolve(win.webContents.id)
      }
    })
  } else {
    // if not showing, return ID once ready to show
    win.once("ready-to-show", evt => ready.resolve(win.webContents.id))
  }
  // wait until ready
  return await ready.promise
}


/**
 * Opens a new BrowserWindow to login to Pavlovia, and waits for it to have a code in the URL
 * 
 * @param {string} url Authentication URL to use
 * @param {string} pattern Regex pattern we expect to be able to use to get the auth code
 */
async function authenticatePavlovia(url) {
  // create window
  let win = new BrowserWindow({
    icon: favicon,
    width: 980,
    height: 720,
    show: true
  });
  win.removeMenu();
  // make sure any auth cache is cleared
  await win.webContents.session.clearCache()
  // load auth url
  win.loadURL(url);
  // construct promise for the auth code
  let code = Promise.withResolvers()
  // on navigate, resolve if we have a code
  win.webContents.on("did-navigate", (evt, url) => {
    // search the URL for the auth code
    let params = new URLSearchParams(
      url.replace(/https:\/\/.*?(?=\?)/, "")
    )
    // if we got one...
    if (params.get("code")) {
      // resolve the promise
      code.resolve(
        params.get("code")
      )
      // close the window
      win.close()
    }
  })

  return code.promise
}


// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(() => {
  createWindow();

  // On OS X it's common to re-create a window in the app when the
  // dock icon is clicked and there are no other windows open.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
app.on("quit", async (evt, code) => {
  // close svelte
  svelte.process.kill(0);
  // close python gracefully
  try {
    await python.stop();
  } catch (error) {
    console.error("Error stopping Python during quit:", error);
  }
})


function getFileTree(folder, recursive=false) {
  let output = [];

  try {
    for (let item of fs.readdirSync(folder, { recursive: false })) {
      console.log(item)
      // construct absolute path
      let abspath = path.join(folder, item);
      // get stats
      let stats = fs.statSync(abspath);
      // construct details
      let details = {
        relpath: item,
        abspath: abspath,
      }
      if (stats.isDirectory()) {
        // if directory, recursively get children
        details.children = getFileTree(abspath)
      } else {
        // if file, get size
        details.size = stats.size / 1000000
      }
      // append
      output.push(details)
    }
  } catch (err) {
    console.error(err)

    return output
  }

  return output
}

/* handlers which can be invoked by electron */

const handlers = {
  electron: {
    windows: {
      new: ipcMain.handle("electron.windows.new", async (evt, target) => await newWindow(target)),
      get: ipcMain.handle("electron.windows.get", (evt, target) => Object.keys(windows).filter(
        id => !windows[id].isDestroyed()
      ).filter(
        id => String(windows[id].webContents.getURL()).startsWith(`http://${svelte.address.host}:${svelte.address.port}/${target}`)
      )),
      send: ipcMain.handle("electron.windows.send", (evt, id, tag, data) => windows[id].webContents.send(tag, data)),
      focus: ipcMain.handle("electron.windows.focus", (evt, id) => windows[id || evt.sender.id].focus()),
      devtools: ipcMain.handle("electron.windows.devtools", (evt, id) => windows[id || evt.sender.id].openDevTools()),
      close: ipcMain.handle("electron.windows.close", (evt, id) => windows[id || evt.sender.id].close()),
    },
    paths: {
      documents: ipcMain.handle("electron.paths.documents", (evt) => app.getPath("documents")),
      user: ipcMain.handle("electron.paths.user", (evt) => path.join(app.getPath("appData"), "psychopy4")),
      devices: ipcMain.handle("electron.paths.devices", (evt) => path.join(app.getPath("appData"), "psychopy4", "devices.json")),
      prefs: ipcMain.handle("electron.paths.prefs", (evt) => path.join(app.getPath("appData"), "psychopy4", "preferences.json")),
      pavlovia: {
        dir: ipcMain.handle("electron.paths.pavlovia", (evt) => path.join(app.getPath("appData"), "psychopy4", "pavlovia")),
        users: ipcMain.handle("electron.paths.pavlovia.users", (evt) => path.join(app.getPath("appData"), "psychopy4", "pavlovia", "users.json")),
        projects: ipcMain.handle("electron.paths.pavlovia.projects", (evt) => path.join(app.getPath("appData"), "psychopy4", "pavlovia", "projects.json")),
      }
    },
    files: {
      load: ipcMain.handle("electron.files.load", (evt, file) => fs.readFileSync(file, { encoding: 'utf8' })),
      save: ipcMain.handle("electron.files.save", (evt, file, content) => fs.writeFileSync(file, content, { encoding: 'utf8', mode: 0o777 })),
      exists: ipcMain.handle("electron.files.exists", (evt, file) => fs.existsSync(file)),
      stat: ipcMain.handle("electron.files.stat", (evt, file) => {
        let stat = fs.statSync(file)
        return Object.assign({
          isDirectory: stat.isDirectory(),
          isFile: stat.isFile()
        }, stat)
      }),
      mkdir: ipcMain.handle("electron.files.mkdir", (evt, path, recursive = true) => fs.mkdirSync(path, { recursive: recursive })),
      openDialog: ipcMain.handle("electron.files.openDialog", (evt, options) => dialog.showOpenDialogSync(windows[evt.sender.id], options)),
      saveDialog: ipcMain.handle("electron.files.saveDialog", (evt, options) => dialog.showSaveDialogSync(windows[evt.sender.id], options)),
      scandir: ipcMain.handle("electron.files.scandir", (evt, root, recursive) => fs.readdirSync(root, { recursive: recursive }).sort(
        (a, b) => fs.statSync(path.join(root, b)).isDirectory() - fs.statSync(path.join(root, a)).isDirectory()
      )),
      showItemInFolder: ipcMain.handle("electron.files.showItemInFolder", (evt, folder) => shell.showItemInFolder(folder)),
      openPath: ipcMain.handle("electron.files.openPath", (evt, path) => shell.openPath(path)),
      openExternal: ipcMain.handle("electron.files.openExternal", (evt, url) => shell.openExternal(url))
    },
    clipboard: {
      get: ipcMain.handle("electron.clipboard.get", (evt) => clipboard),
      set: ipcMain.handle("electron.clipboard.set", (evt, value) => clipboard = value)
    },
    authenticatePavlovia: ipcMain.handle("electron.authenticatePavlovia", (evt, url) => authenticatePavlovia(url)),
    version: ipcMain.handle("electron.version", (evt) => appVersion),
    quit: ipcMain.handle("electron.quit", (evt) => app.quit())
  },
  python: {
    details: ipcMain.handle("python.details", (evt) => python.details),
    start: ipcMain.handle("python.start", async (evt) => {
      try {
        return await python.start();
      } catch (error) {
        console.error("Failed to start Python:", error);
        throw error;
      }
    }),
    stop: ipcMain.handle("python.stop", async (evt) => {
      try {
        return await python.stop();
      } catch (error) {
        console.error("Failed to stop Python:", error);
        throw error;
      }
    }),
    started: ipcMain.handle("python.started", (evt) => python.started),
    uv: {
      dir: ipcMain.handle("python.uv.dir", (evt) => python.uv.dir),
      executable: ipcMain.handle("python.uv.executable", (evt) => python.uv.executable),
      exists: ipcMain.handle("python.uv.exists", (evt) => python.uv.exists()),
      installUV: ipcMain.handle("python.uv.installUV", async (evt) => {
        try {
          return await python.uv.installUV();
        } catch (error) {
          console.error("Failed to install UV:", error);
          throw error;
        }
      }),
      installPython: ipcMain.handle("python.uv.installPython", async (evt, version, folder) => {
        try {
          const executable = await python.uv.installPython(version, folder);
          // Update python details with new executable
          python.details.executable = executable;
          return executable;
        } catch (error) {
          console.error("Failed to install Python:", error);
          throw error;
        }
      }),
      findPython: ipcMain.handle("python.uv.findPython", (evt, version, folder) => python.uv.findPython(version, folder)),
      getEnvironments: ipcMain.handle("python.uv.getEnvironments", (evt, folder) => python.uv.getEnvironments(folder)),
      installPackage: ipcMain.handle("python.uv.installPackage", async (evt, name, executable) => {
        try {
          return await python.uv.installPackage(name, executable);
        } catch (error) {
          console.error("Failed to install package:", error);
          throw error;
        }
      }),
      uninstallPackage: ipcMain.handle("python.uv.uninstallPackage", async (evt, name, executable) => {
        try {
          return await python.uv.uninstallPackage(name, executable);
        } catch (error) {
          console.error("Failed to uninstall package:", error);
          throw error;
        }
      }),
      getPackages: ipcMain.handle("python.uv.getPackages", (evt, executable) => python.uv.getPackages(executable)),
      getPackageDetails: ipcMain.handle("python.uv.getPackageDetails", async (evt, name, executable) => {
        try {
          return await python.uv.getPackageDetails(name, executable);
        } catch (error) {
          console.error("Failed to get package details:", error);
          throw error;
        }
      }),
    },
    shell: {
      list: ipcMain.handle("python.shell.list", () => Object.keys(python.shell.shells)),
      send: ipcMain.handle("python.shell.send", async (evt, id, msg) => {
        try {
          return await python.shell.send(id, msg);
        } catch (error) {
          console.error("Failed to send shell message:", error);
          throw error;
        }
      }),
      open: ipcMain.handle("python.shell.open", (evt) => python.shell.open()),
      close: ipcMain.handle("python.shell.close", (evt, id) => python.shell.close(id))
    },
    liaison: {
      constants: ipcMain.handle("python.liaison.constants", (evt) => python.liaison.constants),
      send: ipcMain.handle("python.liaison.send", async (evt, message, timeout = 1000) => {
        try {
          return await python.liaison.send(message, timeout);
        } catch (error) {
          console.error("Failed to send liaison message:", error);
          throw error;
        }
      }),
      ready: ipcMain.handle("python.liaison.ready", async (evt) => {
        try {
          return await python.liaison.ready.promise;
        } catch (error) {
          console.error("Liaison not ready:", error);
          throw error;
        }
      })
    },
    scripts: {
      run: ipcMain.handle("python.scripts.run", async (evt, file, ...args) => {
        try {
          return await python.scripts.run(file, ...args);
        } catch (error) {
          console.error("Failed to run script:", error);
          throw error;
        }
      }),
      stop: ipcMain.handle("python.scripts.stop", (evt) => python.scripts.stop())
    }
  }
};

// make sure user folder exists
if (!fs.existsSync(
  path.join(app.getPath("appData"), "psychopy4")
)) {
  fs.mkdirSync(
    path.join(app.getPath("appData"), "psychopy4"),
    { recursive: true }
  )
}
