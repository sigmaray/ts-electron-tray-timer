import { app, ipcMain, type WebContents } from "electron";
import { MAX_TIMER_SECONDS } from "./time";

export type TimerSnapshot = {
  seconds: number;
  durationSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
};

type UiSettings = {
  advancedControlsVisible: boolean;
  instructionsVisible: boolean;
};

type IpcDependencies = {
  isMainWindowSender(sender: WebContents): boolean;
  isCountdownWindowSender(sender: WebContents): boolean;
  getUiSettings(): UiSettings;
  setUiSettings(settings: Partial<UiSettings>): void;
  getTimerState(): TimerSnapshot;
  setAlerting(alerting: boolean): void;
  startTimer(seconds: number): void;
  stopTimer(): void;
  pauseResumeTimer(): void;
  adjustTimerTime(seconds: number): void;
  toggleCountdownWindow(): void;
  closeCountdownWindow(): void;
  minimizeWindow(): void;
  clickTray(): void;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function registerIpcHandlers(deps: IpcDependencies): void {
  ipcMain.handle("ui-settings-get", (event) => {
    if (!deps.isMainWindowSender(event.sender))
      throw new Error("Unauthorized IPC sender");
    return deps.getUiSettings();
  });

  ipcMain.handle("timer-state-get", (event) => {
    if (!deps.isMainWindowSender(event.sender))
      throw new Error("Unauthorized IPC sender");
    return deps.getTimerState();
  });

  ipcMain.on("ui-settings-set", (event, value: unknown) => {
    if (!deps.isMainWindowSender(event.sender) || !isRecord(value)) return;
    const settings: Partial<UiSettings> = {};
    if (typeof value.advancedControlsVisible === "boolean")
      settings.advancedControlsVisible = value.advancedControlsVisible;
    if (typeof value.instructionsVisible === "boolean")
      settings.instructionsVisible = value.instructionsVisible;
    if (Object.keys(settings).length) deps.setUiSettings(settings);
  });

  ipcMain.on("timer-state-update", (event, value: unknown) => {
    if (
      !deps.isMainWindowSender(event.sender) ||
      !isRecord(value) ||
      typeof value.isAlerting !== "boolean"
    )
      return;
    deps.setAlerting(value.isAlerting);
  });

  ipcMain.on("timer-start", (event, value: unknown) => {
    if (
      !deps.isMainWindowSender(event.sender) ||
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value <= 0 ||
      value > MAX_TIMER_SECONDS
    )
      return;
    deps.startTimer(value);
  });

  ipcMain.on("timer-stop", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.stopTimer();
  });

  ipcMain.on("timer-pause-resume", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.pauseResumeTimer();
  });

  ipcMain.on("timer-adjust", (event, value: unknown) => {
    if (
      !deps.isMainWindowSender(event.sender) ||
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      Math.abs(value) > MAX_TIMER_SECONDS
    )
      return;
    deps.adjustTimerTime(value);
  });

  ipcMain.on("countdown-window-toggle", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.toggleCountdownWindow();
  });

  ipcMain.on("countdown-window-close", (event) => {
    if (deps.isCountdownWindowSender(event.sender)) deps.closeCountdownWindow();
  });

  ipcMain.on("minimize-window", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.minimizeWindow();
  });

  ipcMain.on("tray-click", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.clickTray();
  });

  ipcMain.on("close-app", (event) => {
    if (!deps.isMainWindowSender(event.sender)) return;
    app.quit();
  });
}
