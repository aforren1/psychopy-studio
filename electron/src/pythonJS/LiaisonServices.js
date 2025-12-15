import logging from "../logging.js";
import { PYTHON_CONFIG } from "./config.js";

export class LiaisonServices {
  constructor(liaison) {
    this.liaison = liaison;
  }

  async setupAll() {
    await this.setupAlerts();
    await this.setupPreferences();
  }

  async setupAlerts() {
    try {
      await this.liaison.send({
        command: "init",
        args: ["alerts", PYTHON_CONFIG.REQUIRED_PACKAGES.ALERTS],
        kwargs: { liaison: "$liaison" }
      }, PYTHON_CONFIG.MESSAGE_TIMEOUT);

      await this.liaison.send({
        command: "run",
        args: ["psychopy.alerts:addAlertHandler", "$alerts"]
      }, PYTHON_CONFIG.MESSAGE_TIMEOUT);

    } catch (err) {
      logging.error("Failed to setup alert handler", err);
      throw err;
    }
  }

  async setupPreferences() {
    try {
      await this.liaison.send({
        command: "register",
        args: ["prefs", PYTHON_CONFIG.REQUIRED_PACKAGES.PREFS]
      }, PYTHON_CONFIG.MESSAGE_TIMEOUT);

      await this.liaison.send({
        command: "run",
        args: ["prefs.setDevicesFile", PYTHON_CONFIG.DEVICES_FILE]
      }, PYTHON_CONFIG.MESSAGE_TIMEOUT);

    } catch (err) {
      logging.error("Failed to setup preferences", err);
      throw err;
    }
  }
}