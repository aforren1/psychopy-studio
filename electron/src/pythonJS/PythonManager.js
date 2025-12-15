import logging from "../logging.js";
import { PythonProcessManager } from "./PythonProcessManager.js";
import { WebSocketLiaison } from "./WebSocketLiaison.js";
import { LiaisonServices } from "./LiaisonServices.js";
import { ConstantsManager } from "./ConstantsManager.js";
import { PythonShell } from "./PythonShell.js";
import { ScriptRunner } from "./ScriptRunner.js";

export class PythonManager {
  constructor(pythonDetails, outputHandler) {
    this.pythonDetails = pythonDetails;
    this.outputHandler = outputHandler;
    this.isStarted = false;
    
    // Initialize components
    this.processManager = new PythonProcessManager(pythonDetails, outputHandler);
    this.liaison = new WebSocketLiaison();
    this.services = new LiaisonServices(this.liaison);
    this.constants = new ConstantsManager(pythonDetails.executable);
    this.shell = new PythonShell(pythonDetails.executable);
    this.scriptRunner = new ScriptRunner(pythonDetails.executable, outputHandler);
  }

  async start() {
    if (this.isStarted) {
      logging.log("Python is already started");
      return;
    }

    try {
      logging.log("Starting Python...");
      
      // Get constants first
      const constants = await this.constants.getConstants();
      
      // Start Python process
      const process = await this.processManager.start();
      
      // Wait for liaison startup marker
      await this._waitForLiaisonStartup(process, constants);
      
      // Connect WebSocket
      await this.liaison.connect();
      
      // Setup services
      await this.services.setupAll();
      
      this.isStarted = true;
      logging.log("Python startup completed successfully");
      
    } catch (error) {
      logging.error("Failed to start Python", error);
      await this.stop();
      throw error;
    }
  }

  async stop() {
    try {
      await this.liaison.disconnect();
      await this.processManager.stop();
      this.scriptRunner.stopAll();
      this.shell.closeAll();
      this.constants.clearConstants();
      this.isStarted = false;
      logging.log("Python stopped successfully");
    } catch (error) {
      logging.error("Error during Python shutdown", error);
      throw error;
    }
  }

  async send(message, timeout) {
    if (!this.isStarted) {
      throw new Error("Python is not started");
    }
    return await this.liaison.send(message, timeout);
  }

  _waitForLiaisonStartup(process, constants) {
    return new Promise((resolve, reject) => {
      const expectedMarker = `${constants.START_MARKER}@${this.liaison.address}`;
      
      const onData = (data) => {
        const message = new TextDecoder().decode(data);
        if (message === expectedMarker) {
          process.stdout.removeListener("data", onData);
          process.stdout.on("data", evt => this.outputHandler.stdout(evt));
          resolve();
        }
      };

      process.stdout.on("data", onData);
      
      // Timeout after reasonable period
      setTimeout(() => {
        process.stdout.removeListener("data", onData);
        reject(new Error("Liaison startup marker not received"));
      }, 30000);
    });
  }

  // Public API
  getShell(id) {
    return this.shell.get(id);
  }

  createShell() {
    return this.shell.create();
  }

  closeShell(id) {
    return this.shell.close(id);
  }

  runScript(file, executable, ...args) {
    return this.scriptRunner.run(file, executable, ...args);
  }

  stopAllScripts() {
    return this.scriptRunner.stopAll();
  }
}