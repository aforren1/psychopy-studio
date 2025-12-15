import proc from "child_process";
import path from "path";
import logging from "../logging.js";

export class ScriptRunner {
  constructor(pythonExecutable, outputHandler) {
    this.pythonExecutable = pythonExecutable;
    this.outputHandler = outputHandler;
    this.scripts = [];
  }

  async run(file, executable, ...args) {
    executable = executable || this.pythonExecutable;
    
    const script = proc.execFile(executable, [file, ...args], {
      cwd: path.dirname(file)
    });
    
    this.scripts.push(script);
    
    script.stdout.on("data", evt => this.outputHandler.stdout(evt));
    script.stderr.on("data", evt => this.outputHandler.stderr(evt));
    
    return new Promise((resolve, reject) => {
      script.on("exit", evt => {
        delete this.scripts[this.scripts.indexOf(script)];
        logging.log(`Finished running ${file}`);
        resolve(evt);
      });
      
      script.on("error", err => {
        delete this.scripts[this.scripts.indexOf(script)];
        logging.log(`Failed to run ${file}: ${err.message}`);
        reject(err.message);
      });
    });
  }

  stopAll() {
    this.scripts.forEach(script => script.kill());
    this.scripts = [];
  }
}