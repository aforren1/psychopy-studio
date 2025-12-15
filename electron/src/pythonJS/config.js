import { app } from "electron";
import path from "path";
import { appVersion } from "../version.js";

export const PYTHON_CONFIG = {
  LIAISON_READY_TIMEOUT: 30000,
  MESSAGE_TIMEOUT: 10000,
  PING_INTERVAL: 30000,
  CONSTANTS_TIMEOUT: 10000,
  LIAISON_ADDRESS: "localhost:8002",
  PYTHON_DIR: path.join(app.getPath("appData"), "psychopy4", ".python", appVersion.major),
  DEVICES_FILE: path.join(app.getPath("appData"), "psychopy4", "devices.json"),
  REQUIRED_PACKAGES: {
    ALERTS: "psychopy.alerts.liaison:LiaisonAlertHandler",
    PREFS: "psychopy.preferences:prefs"
  }
};