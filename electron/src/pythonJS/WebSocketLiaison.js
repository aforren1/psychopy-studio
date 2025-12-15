import { BrowserWindow } from "electron";
import logging from "../logging.js";
import { PYTHON_CONFIG } from "./config.js";
import { randomUUID } from "node:crypto";
import { EventEmitter } from "node:events";

export class WebSocketLiaison {
  constructor() {
    this.socket = null;
    this.ready = Promise.withResolvers();
    this.pending = [];
    this.address = PYTHON_CONFIG.LIAISON_ADDRESS;
    this.pingInterval = null;

    EventEmitter.defaultMaxListeners = 50;
  }

  async connect() {
    this.socket = new WebSocket(`ws://${this.address}`);
    this._setupSocketListeners();
    await this.ready.promise;
    this._startHeartbeat();
    logging.log(`Opened websocket on ws://${this.address}`);
  }

  async disconnect() {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }

    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }

    this.ready = Promise.withResolvers();
    this.pending = [];
  }

  async send(msg, timeout = PYTHON_CONFIG.MESSAGE_TIMEOUT) {
    await this.ready.promise;
    await Promise.allSettled(this.pending);

    const msgid = randomUUID();
    logging.log(msg, `SENT\t${msgid}`, "liaison", false);

    this.socket.send(JSON.stringify({
      command: msg,
      id: msgid
    }));

    const promise = new Promise((resolve, reject) => {
      let completed = false;

      const listener = evt => {
        if (completed) return;

        try {
          const data = JSON.parse(evt.data);
          if (data.evt.id !== msgid) {
            return;
          }

          completed = true;
          this.socket.removeEventListener("message", listener);

          if ("response" in data) {
            logging.log(data.response, `RECEIVED\t${msgid}`, "liaison", false);
            resolve(data.response);
          } else {
            logging.log(data.error, `ERROR\t${msgid}`, "liaison", false);
            reject(data);
          }
        } catch (error) {
          if (!completed) {
            completed = true;
            this.socket.removeEventListener("message", listener);
            reject(error);
          }
        }
      };

      this.socket.addEventListener("message", listener);

      setTimeout(() => {
        if (!completed) {
          completed = true;
          this.socket.removeEventListener("message", listener);
          reject({
            error: [`Message timed out: ${JSON.stringify(msg, undefined, 4)}`],
            evt: null
          });
        }
      }, timeout);
    });

    this.pending.push(promise);
    return promise;
  }

  _setupSocketListeners() {
    this.socket.onopen = () => {
      logging.log(`WebSocket opened on ${this.address}`);
      this.ready.resolve(true);
    };

    this.socket.onclose = evt => {
      logging.error(`Websocket closed unexpectedly: ${evt.reason}`, "liaison");
    };

    this.socket.onerror = () => {
      logging.error("Websocket error occurred", "liaison");
      this.ready.reject();
    };

    this.socket.addEventListener("message", evt => {
      let msg = evt.data;
      if (msg instanceof Buffer) {
        msg = new TextDecoder().decode(evt);
      }
      if (typeof msg === "string") {
        try {
          msg = JSON.parse(msg);
        } catch { }
      }
      if (typeof msg === "object" && "tag" in msg) {
        BrowserWindow.getAllWindows().forEach(
          win => win.webContents.send(`liaison:${msg.tag}`, msg)
        );
      }
    });
  }

  _startHeartbeat() {
    this.pingInterval = setInterval(() => {
      this.send({ command: "ping" }, PYTHON_CONFIG.PING_INTERVAL)
        .catch(err => logging.error("Liaison isn't responding", "liaison"));
    }, PYTHON_CONFIG.PING_INTERVAL);
  }
}