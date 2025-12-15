import proc from "child_process";
import logging from "../logging.js";
import { PYTHON_CONFIG } from "./config.js";

export class PythonProcessManager {
  constructor(pythonExecutable, outputHandler) {
    this.pythonExecutable = pythonExecutable;
    this.outputHandler = outputHandler;
    this.process = null;
  }

  start() {
    if (this.process) {
      throw new Error("Python process already running");
    }

    this.process = proc.spawn(this.pythonExecutable, [
      "-m", "liaison.websocket", PYTHON_CONFIG.LIAISON_ADDRESS
    ]);

    this._setupEventListeners();
    logging.log("Python process started");
    
    return this.process;
  }

  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      logging.log("Python process stopped");
    }
  }

  getProcess() {
    return this.process;
  }

  _setupEventListeners() {
    this.process.stderr.on("data", evt => this.outputHandler.stderr(evt));
    
    this.process.on("exit", evt => {
      logging.log(`Python process stopped, reason: ${evt?.message}`);
    });

    this.process.on("error", error => {
      logging.error("Python process error", error);
    });
  }
}