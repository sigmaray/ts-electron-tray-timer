import { ipcMain, type WebContents } from "electron";
import { MAX_TIMER_SECONDS } from "./time";

/** Renderer-facing snapshot of the current timer state. */
export type TimerSnapshot = {
  seconds: number;
  durationSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
};

/** Visibility preferences exposed to the main renderer window. */
type UiSettings = {
  confirmQuit: boolean;
  advancedControlsVisible: boolean;
  instructionsVisible: boolean;
  notificationMode: "window" | "system" | "both";
  alarmSoundEnabled: boolean;
  alarmSound: "classic" | "digital" | "gentle";
  countdownFormat: "compact" | "clock" | "seconds";
  countdownFontSize: number;
  countdownMenuButtonVisible: boolean;
  countdownBackgroundColor: string;
  trayIconColor: string;
  mainWindowBackgroundColor: string;
  sectionHeaderBackgroundColor: string;
  sectionBackgroundColor: string;
};

/** Main-process operations required by the IPC registration layer. */
type IpcDependencies = {
  isMainWindowSender(sender: WebContents): boolean;
  isSettingsWindowSender(sender: WebContents): boolean;
  isAlertWindowSender(sender: WebContents): boolean;
  isCountdownWindowSender(sender: WebContents): boolean;
  getUiSettings(): UiSettings;
  setUiSettings(settings: Partial<UiSettings>): void;
  setAlertWindowMode(mode: "window" | "system" | "both" | null): void;
  openSettingsWindow(): void;
  dismissAlertWindow(): void;
  getTimerState(): TimerSnapshot;
  setAlerting(alerting: boolean): void;
  startTimer(seconds: number): void;
  stopTimer(): void;
  pauseResumeTimer(): void;
  adjustTimerTime(seconds: number): void;
  toggleCountdownWindow(): void;
  closeCountdownWindow(): void;
  showCountdownWindowMenu(): void;
  resizeCountdownWindow(width: number, height: number): void;
  minimizeWindow(): void;
  clickTray(): void;
  requestQuit(): void;
};

/** Check whether an IPC payload is a non-null object record.
 * @param value Untrusted IPC payload to inspect.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Register validated IPC handlers for the main and countdown windows.
 * @param deps Main-process callbacks and sender authorization checks.
 */
export function registerIpcHandlers(deps: IpcDependencies): void {
  ipcMain.handle("ui-settings-get", (event) => {
    if (
      !deps.isMainWindowSender(event.sender) &&
      !deps.isSettingsWindowSender(event.sender)
    )
      throw new Error("Unauthorized IPC sender");
    return deps.getUiSettings();
  });

  ipcMain.on("settings-window-open", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.openSettingsWindow();
  });

  ipcMain.handle("timer-state-get", (event) => {
    if (!deps.isMainWindowSender(event.sender))
      throw new Error("Unauthorized IPC sender");
    return deps.getTimerState();
  });

  ipcMain.on("ui-settings-set", (event, value: unknown) => {
    if (
      (!deps.isMainWindowSender(event.sender) &&
        !deps.isSettingsWindowSender(event.sender)) ||
      !isRecord(value)
    )
      return;
    const settings: Partial<UiSettings> = {};
    if (typeof value.confirmQuit === "boolean") settings.confirmQuit = value.confirmQuit;
    if (typeof value.advancedControlsVisible === "boolean")
      settings.advancedControlsVisible = value.advancedControlsVisible;
    if (typeof value.instructionsVisible === "boolean")
      settings.instructionsVisible = value.instructionsVisible;
    if (
      value.notificationMode === "window" ||
      value.notificationMode === "system" ||
      value.notificationMode === "both"
    )
      settings.notificationMode = value.notificationMode;
    if (typeof value.alarmSoundEnabled === "boolean")
      settings.alarmSoundEnabled = value.alarmSoundEnabled;
    if (
      value.alarmSound === "classic" ||
      value.alarmSound === "digital" ||
      value.alarmSound === "gentle"
    )
      settings.alarmSound = value.alarmSound;
    if (
      value.countdownFormat === "compact" ||
      value.countdownFormat === "clock" ||
      value.countdownFormat === "seconds"
    )
      settings.countdownFormat = value.countdownFormat;
    if (
      typeof value.countdownFontSize === "number" &&
      Number.isInteger(value.countdownFontSize) &&
      value.countdownFontSize >= 8 &&
      value.countdownFontSize <= 32
    )
      settings.countdownFontSize = value.countdownFontSize;
    if (typeof value.countdownMenuButtonVisible === "boolean")
      settings.countdownMenuButtonVisible = value.countdownMenuButtonVisible;
    if (
      typeof value.countdownBackgroundColor === "string" &&
      /^#[0-9a-fA-F]{6}$/.test(value.countdownBackgroundColor)
    )
      settings.countdownBackgroundColor =
        value.countdownBackgroundColor.toLowerCase();
    for (const colorKey of ["trayIconColor", "mainWindowBackgroundColor", "sectionHeaderBackgroundColor", "sectionBackgroundColor"] as const) {
      const color = value[colorKey];
      if (typeof color === "string" && /^#[0-9a-fA-F]{6}$/.test(color)) settings[colorKey] = color.toLowerCase();
    }
    if (Object.keys(settings).length) deps.setUiSettings(settings);
  });

  ipcMain.on("timer-alert-window", (event, value: unknown) => {
    if (
      !deps.isMainWindowSender(event.sender) ||
      (value !== null &&
        value !== "window" &&
        value !== "system" &&
        value !== "both")
    )
      return;
    deps.setAlertWindowMode(value);
  });

  ipcMain.on("timer-alert-dismiss", (event) => {
    if (deps.isAlertWindowSender(event.sender)) deps.dismissAlertWindow();
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

  ipcMain.on("countdown-window-menu", (event) => {
    if (deps.isCountdownWindowSender(event.sender))
      deps.showCountdownWindowMenu();
  });

  ipcMain.on(
    "countdown-window-resize",
    (event, width: unknown, height: unknown) => {
      if (
        !deps.isCountdownWindowSender(event.sender) ||
        typeof width !== "number" ||
        typeof height !== "number" ||
        !Number.isInteger(width) ||
        !Number.isInteger(height) ||
        width < 100 ||
        width > 800 ||
        height < 30 ||
        height > 200
      )
        return;
      deps.resizeCountdownWindow(width, height);
    },
  );

  ipcMain.on("minimize-window", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.minimizeWindow();
  });

  ipcMain.on("tray-click", (event) => {
    if (deps.isMainWindowSender(event.sender)) deps.clickTray();
  });

  ipcMain.on("close-app", (event) => {
    if (!deps.isMainWindowSender(event.sender)) return;
    deps.requestQuit();
  });
}
