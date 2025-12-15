import proc from "child_process";

export class PythonShell {
  constructor(pythonExecutable) {
    this.pythonExecutable = pythonExecutable;
    this.tokens = {
      stdout: { start: "###START-STDOUT###", stop: "###END-STDOUT###" },
      stderr: { start: "###START-STDERR###", stop: "###END-STDERR###" }
    };

    this.process = proc.spawn(pythonExecutable, ['-i'], { shell: true });
    this.send("import sys");
  }

  send(msg, timeout = 2000) {
    const decoder = new TextDecoder();
    let thusfar = { message: [], stdout: false, stderr: false };

    const promise = new Promise((resolve, reject) => {
      for (let src of ["stdout", "stderr"]) {
        this.process[src].on("data", resp => {
          const value = decoder.decode(resp);
          const safevalue = value
            .replaceAll(this.tokens[src].stop, "")
            .replaceAll(">>> ", "")
            .trim();
          
          if (safevalue) {
            thusfar.message.push(safevalue);
          }
          
          if (value.includes(this.tokens[src].stop)) {
            thusfar[src] = true;
            this.process[src].removeAllListeners();
          }
          
          if (thusfar.stdout && thusfar.stderr) {
            resolve(thusfar.message);
          }
        });
      }

      setTimeout(() => resolve(thusfar.message), timeout);
    });

    thusfar.message.push(`>> ${msg}`);
    
    this.process.stdin.write(
      `${msg}\nprint("${this.tokens.stdout.stop}", file=sys.stdout)\nprint("${this.tokens.stderr.stop}", file=sys.stderr)\n`
    );
    
    return promise;
  }

  close() {
    if (this.process) {
      this.process.kill();
    }
  }
}