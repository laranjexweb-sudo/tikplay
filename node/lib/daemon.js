// Daemon Python (spawn/IO/vida) — extraído de server.js na Fase B da separação estrutural.
// Sem mudança de comportamento: mesmo spawn, parsing de stdout (JSON), stderr, backoff e respawn.
const { spawn } = require("child_process");

class Daemon {
  /**
   * @param {object} opts
   * @param {string} opts.pythonBin   comando/binário do Python (ex.: PYTHON_BIN)
   * @param {string} opts.servicePath caminho do service.py
   * @param {object} opts.env         env extra para o filho
   * @param {(msg:any)=>void} [opts.onMessage]  recebe cada JSON do stdout
   * @param {(line:string)=>void} [opts.onStderr] linha bruta do stderr
   * @param {()=>void} [opts.onDown]  chamado quando o processo sai/falha
   */
  constructor({ pythonBin, servicePath, env, onMessage, onStderr, onDown }) {
    this.pythonBin = pythonBin;
    this.servicePath = servicePath;
    this.env = env;
    this.onMessage = onMessage;
    this.onStderr = onStderr;
    this.onDown = onDown;
    this.proc = null;
    this.pid = null;
    this.backoff = 1000;
    this.timer = null;
  }

  start() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.pid) {
      try {
        process.kill(this.pid);
      } catch (e) {}
      this.pid = null;
    }
    try {
      const proc = spawn(this.pythonBin, ["-u", this.servicePath], { env: this.env });
      this.proc = proc;
      this.pid = proc.pid;

      let buffer = "";
      proc.stdout.on("data", (data) => {
        this.backoff = 1000;
        buffer += data.toString("utf-8");
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (let line of lines) {
          line = line.replace(/\r$/, "");
          if (!line.trim()) continue;
          let msg;
          try {
            msg = JSON.parse(line);
          } catch {
            continue;
          }
          if (this.onMessage) this.onMessage(msg);
        }
      });

      proc.stderr.on("data", (data) => {
        const lines = data.toString("utf-8").split("\n");
        for (const line of lines) {
          if (!line.trim()) continue;
          if (this.onStderr) this.onStderr(line);
        }
      });

      proc.on("error", (err) => {
        console.error("[Daemon] Erro ao iniciar:", err.message);
        this.proc = null;
        this.pid = null;
        if (this.onDown) this.onDown();
        this.schedule();
      });

      proc.on("close", (code) => {
        console.log(`[Daemon] Encerrado (codigo: ${code})`);
        this.proc = null;
        this.pid = null;
        if (this.onDown) this.onDown();
        this.schedule();
      });
    } catch (e) {
      console.error("[Daemon] Falha ao iniciar:", e.message);
      this.schedule();
    }
  }

  schedule() {
    if (this.proc || this.timer) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.start();
    }, this.backoff);
    this.backoff = Math.min(this.backoff * 2, 15000);
  }

  send(obj) {
    if (!this.proc) this.start();
    if (!this.proc || !this.proc.stdin || !this.proc.stdin.writable) return false;
    this.proc.stdin.write(JSON.stringify(obj) + "\n");
    return true;
  }

  kill() {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (this.proc) {
      try {
        this.proc.kill();
      } catch (e) {}
      this.proc = null;
      this.pid = null;
    }
  }
}

module.exports = Daemon;