import proc from "child_process";
import logging from "../logging.js";
import { PYTHON_CONFIG } from "./config.js";

export class ConstantsManager {
  constructor(pythonExecutable) {
    this.pythonExecutable = pythonExecutable;
    this.constants = null;
  }

  async getConstants() {
    if (this.constants) {
      return this.constants;
    }

    const constantsProcess = proc.spawn(this.pythonExecutable, ["-m", "liaison.constants"]);
    
    return new Promise((resolve, reject) => {
      constantsProcess.stdout.once("data", evt => {
        try {
          this.constants = JSON.parse(new TextDecoder().decode(evt));
          resolve(this.constants);
        } catch (error) {
          reject(new Error("Failed to parse constants JSON"));
        }
      });

      setTimeout(() => {
        constantsProcess.kill();
        reject(new Error("Getting Liaison constants timed out"));
      }, PYTHON_CONFIG.CONSTANTS_TIMEOUT);

      constantsProcess.on("error", error => reject(error));
    });
  }

  clearConstants() {
    this.constants = null;
  }
}