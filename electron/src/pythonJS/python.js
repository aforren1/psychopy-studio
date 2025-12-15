import { app, BrowserWindow } from "electron";
import path from "path";
import { uv } from "../uv.js";
import { randomUUID } from "node:crypto";
import { appVersion } from "../version.js";
import logging from "../logging.js";
import { PYTHON_CONFIG } from "./config.js";
import { PythonProcessManager } from "./PythonProcessManager.js";
import { WebSocketLiaison } from "./WebSocketLiaison.js";
import { LiaisonServices } from "./LiaisonServices.js";
import { ConstantsManager } from "./ConstantsManager.js";
import { ScriptRunner } from "./ScriptRunner.js";
import { PythonShell } from "./PythonShell.js";

const decoder = new TextDecoder();

// Output handler
const outputHandler = {
  stdout: (message) => {
    if (message instanceof Buffer) {
      message = decoder.decode(message);
    }
    logging.log(message, "STDOUT");
    BrowserWindow.getAllWindows().forEach(
      win => win.webContents.send("stdout", message)
    );
  },
  stderr: (message) => {
    if (message instanceof Buffer) {
      message = decoder.decode(message);
    }
    logging.log(message, "STDERR");
    BrowserWindow.getAllWindows().forEach(
      win => win.webContents.send("stderr", message)
    );
  }
};

// Initialize details
const pythonDetails = {
  executable: uv.findPython(),
  dir: PYTHON_CONFIG.PYTHON_DIR
};

// Initialize managers
let processManager, liaison, services, constants, scriptRunner;
let shellManager = {
  shells: {},
  open() {
    const id = randomUUID();
    this.shells[id] = new PythonShell(pythonDetails.executable);
    return id;
  },
  close(id) {
    if (this.shells[id]) {
      this.shells[id].close();
      delete this.shells[id];
    }
  },
  closeAll() {
    Object.keys(this.shells).forEach(id => this.close(id));
  }
};

// Create shared ready promise that can be resolved externally
let readyResolvers = Promise.withResolvers();

export async function startPython() {
  if (python.started) {
    return;
  }

  try {
    logging.log("Starting Python...");
    
    // Initialize managers
    processManager = new PythonProcessManager(pythonDetails.executable, outputHandler);
    liaison = new WebSocketLiaison();
    services = new LiaisonServices(liaison);
    constants = new ConstantsManager(pythonDetails.executable);
    scriptRunner = new ScriptRunner(pythonDetails.executable, outputHandler);
    
    // Get constants
    const liaisonConstants = await constants.getConstants();
    python.liaison.constants = liaisonConstants;
    
    // Start process
    const process = processManager.start();
    python.process = process;
    
    // Wait for liaison startup marker
    await new Promise((resolve, reject) => {
      let resolved = false;
      
      const onData = (evt) => {
        const message = decoder.decode(evt);
        if (message === `${liaisonConstants.START_MARKER}@${liaison.address}`) {
          if (!resolved) {
            resolved = true;
            process.stdout.removeListener("data", onData);
            process.stdout.on("data", evt => outputHandler.stdout(evt));
            resolve();
          }
        }
      };
      
      process.stdout.on("data", onData);
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          process.stdout.removeListener("data", onData);
          reject(new Error("Liaison startup marker not received within timeout"));
        }
      }, 30000);
    });

    // Connect liaison
    await liaison.connect();
    python.socket = liaison.socket;
    
    // Mark as started and resolve ready promise BEFORE setting up services
    python.started = true;
    readyResolvers.resolve(true);
    
    logging.log("Python started successfully");
    
    // Setup services asynchronously in background (like original code)
    // This runs after startup completes and doesn't block
    setupServicesInBackground();
    
  } catch (error) {
    logging.error("Failed to start Python", error);
    readyResolvers.reject(error);
    await stopPython();
    throw error;
  }
}

// Setup services in background without blocking startup
function setupServicesInBackground() {
  // Start heartbeat
  setInterval(() => {
    if (liaison && python.started) {
      liaison.send({ command: "ping" }, PYTHON_CONFIG.PING_INTERVAL)
        .catch(err => logging.error("Liaison isn't responding (sent a ping and didn't receive a pong within 30s)", "liaison"));
    }
  }, PYTHON_CONFIG.PING_INTERVAL);

  // Setup alerts (async, don't block)
  liaison.send({
    command: "init",
    args: ["alerts", PYTHON_CONFIG.REQUIRED_PACKAGES.ALERTS],
    kwargs: { liaison: "$liaison" }
  }, PYTHON_CONFIG.MESSAGE_TIMEOUT).then(
    resp => liaison.send({
      command: "run",
      args: ["psychopy.alerts:addAlertHandler", "$alerts"]
    }, PYTHON_CONFIG.MESSAGE_TIMEOUT).catch(
      err => logging.error("Failed to add alert handler", err)
    )
  ).catch(
    err => logging.error("Failed to setup alert handler", err)
  );

  // Setup prefs (async, don't block)
  liaison.send({
    command: "register",
    args: ["prefs", PYTHON_CONFIG.REQUIRED_PACKAGES.PREFS]
  }, PYTHON_CONFIG.MESSAGE_TIMEOUT).catch(
    err => logging.error("Failed to load prefs", err)
  ).then(
    resp => {
      if (resp) {
        liaison.send({
          command: "run",
          args: ["prefs.setDevicesFile", PYTHON_CONFIG.DEVICES_FILE]
        }, PYTHON_CONFIG.MESSAGE_TIMEOUT).catch(
          err => logging.error("Failed to set devices file", err)
        );
      }
    }
  ).catch(
    err => logging.error("Failed to setup preferences", err)
  );
}

async function stopPython() {
  try {
    if (liaison) await liaison.disconnect();
    if (processManager) await processManager.stop();
    if (scriptRunner) scriptRunner.stopAll();
    shellManager.closeAll();
    
    python.started = false;
    python.process = undefined;
    python.socket = undefined;
    
    // Reset ready promise
    readyResolvers = Promise.withResolvers();
    python.liaison.ready = readyResolvers;
    python.liaison.pending = [];
    
  } catch (error) {
    logging.error("Error stopping Python", error);
    throw error;
  }
}

// Export the original interface
export const python = {
  details: pythonDetails,
  uv: uv,
  start: startPython,
  stop: stopPython,
  started: false,
  scripts: {
    run: (file, executable, ...args) => {
      if (!scriptRunner) throw new Error("Python not started");
      return scriptRunner.run(file, executable, ...args);
    },
    stop: () => {
      if (scriptRunner) scriptRunner.stopAll();
    }
  },
  output: {
    ...outputHandler,
    liaison: []
  },
  liaison: {
    address: PYTHON_CONFIG.LIAISON_ADDRESS,
    constants: undefined,
    send: async (msg, timeout = PYTHON_CONFIG.MESSAGE_TIMEOUT) => {
      // Wait for Python to be started before allowing any liaison calls
      if (!python.started) {
        try {
          await Promise.race([
            readyResolvers.promise,
            new Promise((_, reject) => 
              setTimeout(() => reject(new Error("Python startup timeout")), 30000)
            )
          ]);
        } catch (error) {
          throw new Error("Python not started and startup failed: " + error.message);
        }
      }
      
      if (!liaison) throw new Error("Python liaison not available");
      try {
        return await liaison.send(msg, timeout);
      } catch (err) {
        throw new Error(err.error?.slice?.(-1) || err.message, { cause: err.error?.join?.("\n") });
      }
    },
    ready: readyResolvers,
    pending: []
  },
  shell: {
    get shells() { return shellManager.shells; },
    send: (id, msg) => {
      if (!shellManager.shells[id]) throw new Error(`Shell ${id} not found`);
      return shellManager.shells[id].send(msg);
    },
    open: () => shellManager.open(),
    close: (id) => shellManager.close(id),
    closeAll: () => shellManager.closeAll()
  },
  socket: undefined,
  process: undefined
};