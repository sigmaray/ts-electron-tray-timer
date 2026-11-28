import { app, BrowserWindow, Tray, Menu, dialog, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
import {
  parsePersistedSettings,
  type CountdownWindowPosition,
  type PersistedSettings,
  type PersistedTimer,
} from "./settings";
import { MAX_TIMER_SECONDS } from "./time";
import { registerIpcHandlers } from "./ipc-handlers";
import {
  createAppIcon,
  createTextIcon,
  formatTimeForTooltip,
  formatTimeForTray,
} from "./icons";

/** Test-only globals exposed to the Electron test process. */
declare global {
  /** Return the active system tray instance to an E2E test. */
  var __tray__: (() => Tray | null) | undefined;
}

let mainWindow: BrowserWindow | null = null;
let countdownWindow: BrowserWindow | null = null;
let countdownWindowPosition: CountdownWindowPosition | undefined;
let countdownWindowWidth = 280;
let countdownWindowHeight = 70;
let countdownPositionSaveTimer: NodeJS.Timeout | null = null;
let settingsWindow: BrowserWindow | null = null;
let alertWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

// Expose the tray for tests in development mode only.
if (process.env.NODE_ENV === "test") {
  globalThis.__tray__ = () => tray;
}

// Control whether the app allows only one running instance.
const ALLOW_ONLY_ONE_INSTANCE = process.env.ALLOW_ONLY_ONE_INSTANCE !== "false";

/** Values used to render the timer's system-tray icon and tooltip. */
type TrayTimerState = {
  seconds: number;
  isRunning: boolean;
  isAlerting: boolean;
  isPaused?: boolean;
  durationSeconds?: number;
};

let timerState: TrayTimerState = {
  seconds: 0,
  isRunning: false,
  isAlerting: false,
  isPaused: false,
};
let blinkInterval: NodeJS.Timeout | null = null;
let isBlinking = false;

// Timer state owned by the main process.
let timerInterval: NodeJS.Timeout | null = null;
let remainingSeconds: number = 0;
let isPaused: boolean = false;
let lastUpdateTime: number = 0;
let timerEndTime: number = 0; // Timestamp when the timer should finish.
let timerDurationSeconds = 0;
let isRestoringSettings = false;
let pendingStartupTimerFinished = false;

let advancedControlsVisible = false;
let instructionsVisible = false;
let notificationMode: "window" | "system" | "both" = "window";
let alarmSoundEnabled = true;
let alarmSound: "classic" | "digital" | "gentle" = "classic";
let countdownFormatPref: "compact" | "clock" | "seconds" = "compact";
let countdownFontSizePref = 15;
let countdownMenuButtonVisiblePref = true;
let countdownBackgroundColorPref = "#5b7fa6";
let trayIconColorPref = "#5b7fa6";
let mainWindowBackgroundColorPref = "#f8f9fa";
let sectionHeaderBackgroundColorPref = "#0d6efd";
let sectionBackgroundColorPref = "#ffffff";
let confirmQuitPref = true;

const SETTINGS_VERSION = 1 as const;
const SETTINGS_FILE_NAME = "settings.json";
let settingsPathOverride: string | null = null;
let ownsInstanceLock = !ALLOW_ONLY_ONE_INSTANCE;

/** Coordinates for a window centered on the primary display's work area. */
type WindowPosition = { x: number; y: number };

/** Calculate top-left coordinates that place a window on the primary display.
 * @param width The window width in screen-independent pixels.
 * @param height The window height in screen-independent pixels.
 */
function getPrimaryDisplayPosition(
  width: number,
  height: number,
): WindowPosition {
  const {
    x: displayX,
    y: displayY,
    width: displayWidth,
    height: displayHeight,
  } = screen.getPrimaryDisplay().workArea;
  return {
    x: Math.max(displayX, displayX + Math.floor((displayWidth - width) / 2)),
    y: Math.max(displayY, displayY + Math.floor((displayHeight - height) / 2)),
  };
}

/** Resolve the settings path, preferring writable portable storage when enabled. */
function getSettingsPath(): string {
  if (process.env.TIMER_SETTINGS_PATH) return process.env.TIMER_SETTINGS_PATH;
  if (settingsPathOverride) return settingsPathOverride;

  const userDataPath = path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
  const markerPath = [
    path.join(process.resourcesPath, "portable-mode"),
    path.join(app.getAppPath(), "portable-mode"),
  ].find((candidate) => fs.existsSync(candidate));
  if (!markerPath) return userDataPath;

  const portableDirectory = path.dirname(markerPath);
  try {
    fs.accessSync(portableDirectory, fs.constants.W_OK);
    return path.join(portableDirectory, SETTINGS_FILE_NAME);
  } catch {
    return userDataPath;
  }
}

/** Copy an older settings file into the selected storage location if needed.
 * @param destination The active settings file path.
 */
function migrateLegacySettings(destination: string): void {
  if (process.env.TIMER_SETTINGS_PATH || fs.existsSync(destination)) return;

  const legacyPaths = [
    path.join(app.getAppPath(), SETTINGS_FILE_NAME),
    path.join(app.getAppPath(), "dist", SETTINGS_FILE_NAME),
    path.join(app.getPath("userData"), SETTINGS_FILE_NAME),
  ];
  for (const legacyPath of legacyPaths) {
    if (legacyPath === destination || !fs.existsSync(legacyPath)) continue;
    try {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(legacyPath, destination);
      console.info(
        `[settings] Migrated settings from ${legacyPath} to ${destination}`,
      );
      return;
    } catch (error) {
      console.warn(
        `[settings] Could not migrate settings from ${legacyPath}`,
        error,
      );
    }
  }
}

/** Read and validate persisted settings, returning null when unavailable. */
function loadSettings(): PersistedSettings | null {
  let settingsPath = getSettingsPath();
  migrateLegacySettings(settingsPath);
  const existedBeforeLoad = fs.existsSync(settingsPath);
  console.info(
    `[settings] path: ${settingsPath}; exists: ${existedBeforeLoad}`,
  );

  if (!existedBeforeLoad) {
    console.info(
      "[settings] File is missing; creating it with default settings.",
    );
    saveSettings();
    settingsPath = getSettingsPath();
    if (fs.existsSync(settingsPath)) {
      console.info(`[settings] Created settings file: ${settingsPath}`);
    } else {
      console.error(
        `[settings] Could not create settings file: ${settingsPath}`,
      );
    }
    return null;
  }

  try {
    const settings = parsePersistedSettings(
      fs.readFileSync(settingsPath, "utf8"),
    );
    if (settings) {
      console.info(`[settings] Successfully loaded settings: ${settingsPath}`);
      return settings;
    }

    console.error(
      `[settings] File exists but contains invalid settings: ${settingsPath}`,
    );
  } catch (error) {
    console.error(
      `[settings] Failed to read settings file: ${settingsPath}`,
      error,
    );
  }

  return null;
}

/**
 * Persist current UI preferences and active timer state.
 */
function saveSettings(): void {
  if (isRestoringSettings) return;

  const countdownWindowVisible = !!(
    countdownWindow && !countdownWindow.isDestroyed()
  );

  let timer: PersistedTimer | null = null;
  if (timerInterval && remainingSeconds > 0) {
    if (isPaused) {
      timer = {
        secondsLeft: remainingSeconds,
        durationSeconds: timerDurationSeconds,
        isPaused: true,
        savedAt: Date.now(),
      };
    } else {
      timer = {
        secondsLeft: remainingSeconds,
        durationSeconds: timerDurationSeconds,
        isPaused: false,
        timerEndTimestamp: timerEndTime,
        savedAt: Date.now(),
      };
    }
  }

  const settings: PersistedSettings = {
    version: SETTINGS_VERSION,
    timer,
    countdownWindowVisible,
    countdownWindowPosition,
    advancedControlsVisible,
    instructionsVisible,
    notificationMode,
    alarmSoundEnabled,
    alarmSound,
    countdownFormat: countdownFormatPref,
    countdownFontSize: countdownFontSizePref,
    countdownMenuButtonVisible: countdownMenuButtonVisiblePref,
    countdownBackgroundColor: countdownBackgroundColorPref,
    trayIconColor: trayIconColorPref,
    mainWindowBackgroundColor: mainWindowBackgroundColorPref,
    sectionHeaderBackgroundColor: sectionHeaderBackgroundColorPref,
    sectionBackgroundColor: sectionBackgroundColorPref,
    confirmQuit: confirmQuitPref,
  };

  let settingsPath = getSettingsPath();
  migrateLegacySettings(settingsPath);
  const existedBeforeSave = fs.existsSync(settingsPath);
  console.info(
    `[settings] path: ${settingsPath}; exists before save: ${existedBeforeSave}`,
  );

  try {
    fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), "utf8");
    console.info(
      `[settings] Successfully ${existedBeforeSave ? "updated" : "created"} settings file: ${settingsPath}`,
    );
  } catch (error) {
    const userDataPath = path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
    const isPortablePath =
      !process.env.TIMER_SETTINGS_PATH && settingsPath !== userDataPath;

    if (isPortablePath) {
      console.warn(
        `[settings] Could not write to portable path ${settingsPath}; falling back to ${userDataPath}`,
        error,
      );
      settingsPathOverride = userDataPath;
      settingsPath = userDataPath;
      fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
      const fallbackExisted = fs.existsSync(settingsPath);
      console.info(
        `[settings] path: ${settingsPath}; exists before fallback save: ${fallbackExisted}`,
      );
      try {
        fs.writeFileSync(
          settingsPath,
          JSON.stringify(settings, null, 2),
          "utf8",
        );
        console.info(
          `[settings] Successfully ${fallbackExisted ? "updated" : "created"} settings file: ${settingsPath}`,
        );
      } catch (fallbackError) {
        console.error(
          `[settings] Failed to save settings file: ${settingsPath}`,
          fallbackError,
        );
      }
      return;
    }

    console.error(
      `[settings] Failed to save settings file: ${settingsPath}`,
      error,
    );
  }
}

/** Restore saved preferences and restart or pause the saved timer. */
function restoreSettings(): void {
  const settings = loadSettings();
  if (!settings) return;

  isRestoringSettings = true;
  advancedControlsVisible = settings.advancedControlsVisible === true;
  instructionsVisible = settings.instructionsVisible === true;
  notificationMode = settings.notificationMode ?? "window";
  alarmSoundEnabled = settings.alarmSoundEnabled ?? true;
  alarmSound = settings.alarmSound ?? "classic";
  countdownFormatPref = settings.countdownFormat ?? "compact";
  countdownFontSizePref = settings.countdownFontSize ?? 15;
  countdownMenuButtonVisiblePref = settings.countdownMenuButtonVisible ?? true;
  countdownBackgroundColorPref = settings.countdownBackgroundColor ?? "#5b7fa6";
  trayIconColorPref = settings.trayIconColor ?? "#5b7fa6";
  mainWindowBackgroundColorPref = settings.mainWindowBackgroundColor ?? "#f8f9fa";
  sectionHeaderBackgroundColorPref = settings.sectionHeaderBackgroundColor ?? "#0d6efd";
  sectionBackgroundColorPref = settings.sectionBackgroundColor ?? "#ffffff";
  confirmQuitPref = settings.confirmQuit ?? true;
  countdownWindowPosition = settings.countdownWindowPosition;

  // Do not restore the alerting state on startup.
  timerState.isAlerting = false;
  stopBlinking();

  try {
    if (settings.timer && settings.timer.secondsLeft > 0) {
      if (settings.timer.isPaused) {
        // startTimer creates the interval; the restored timer is then paused.
        startTimer(settings.timer.secondsLeft);
        timerDurationSeconds =
          settings.timer.durationSeconds ?? settings.timer.secondsLeft;
        isPaused = true;
        sendTimerUpdateToRenderer();
      } else {
        const now = Date.now();
        const endTs =
          typeof settings.timer.timerEndTimestamp === "number"
            ? settings.timer.timerEndTimestamp
            : now + settings.timer.secondsLeft * 1000;
        if (endTs <= now) {
          timerDurationSeconds =
            settings.timer.durationSeconds ?? settings.timer.secondsLeft;
          pendingStartupTimerFinished = true;
        } else {
          const secondsLeft = Math.max(0, Math.floor((endTs - now) / 1000));
          if (secondsLeft > 0) {
            startTimer(secondsLeft);
            timerDurationSeconds =
              settings.timer.durationSeconds ?? settings.timer.secondsLeft;
          }
        }
      }
    }

    if (settings.countdownWindowVisible) {
      createCountdownWindow();
    }
  } finally {
    isRestoringSettings = false;
    saveSettings();
  }
}

/** Format the remaining duration for the floating countdown window.
 * @param seconds Remaining timer duration in seconds.
 */
function formatTimeForCountdownWindow(seconds: number): string {
  const remaining = Math.max(0, Math.floor(seconds));
  if (countdownFormatPref === "seconds") return `${remaining}s`;
  if (countdownFormatPref === "clock") {
    const hours = Math.floor(remaining / 3600);
    const minutes = Math.floor((remaining % 3600) / 60);
    const secondsRemaining = remaining % 60;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secondsRemaining).padStart(2, "0")}`;
  }
  if (remaining <= 0) return "—";
  if (remaining < 60) return "< 1m";
  const hours = Math.floor(remaining / 3600);
  const minutes = Math.floor((remaining % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  return parts.join(" ");
}

/** Return the current countdown text for the floating window. */
function getCountdownText(): string {
  return formatTimeForCountdownWindow(remainingSeconds);
}

/** Check whether an IPC message came from the main renderer window.
 * @param sender WebContents that sent the IPC message.
 */
function isMainWindowSender(sender: Electron.WebContents): boolean {
  return (
    !!mainWindow &&
    !mainWindow.isDestroyed() &&
    sender.id === mainWindow.webContents.id
  );
}

/** Check whether an IPC message came from the settings window.
 * @param sender WebContents that sent the IPC message.
 */
function isSettingsWindowSender(sender: Electron.WebContents): boolean {
  return (
    !!settingsWindow &&
    !settingsWindow.isDestroyed() &&
    sender.id === settingsWindow.webContents.id
  );
}

/** Check whether an IPC message came from the timer completion window.
 * @param sender WebContents that sent the IPC message.
 */
function isAlertWindowSender(sender: Electron.WebContents): boolean {
  return (
    !!alertWindow &&
    !alertWindow.isDestroyed() &&
    sender.id === alertWindow.webContents.id
  );
}

/** Open or focus the separate application settings window.
 */
function openSettingsWindow(): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    const position = getPrimaryDisplayPosition(520, 600);
    settingsWindow.setPosition(position.x, position.y);
    settingsWindow.show();
    settingsWindow.focus();
    return;
  }

  const windowWidth = 520;
  const windowHeight = 600;
  const position = getPrimaryDisplayPosition(windowWidth, windowHeight);

  settingsWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: position.x,
    y: position.y,
    minWidth: 460,
    minHeight: 520,
    title: "Timer Settings",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  settingsWindow.loadFile(path.join(__dirname, "settings.html"));
  settingsWindow.on("closed", () => {
    settingsWindow = null;
  });
}

/** Show or close the separate always-on-top timer completion window.
 * @param mode The selected notification mode, or null to close the alert.
 */
function setAlertWindowMode(mode: "window" | "system" | "both" | null): void {
  if (mode === null || mode === "system") {
    closeAlertWindow(false);
    return;
  }
  if (alertWindow && !alertWindow.isDestroyed()) {
    const position = getPrimaryDisplayPosition(420, 330);
    alertWindow.setPosition(position.x, position.y);
    alertWindow.show();
    alertWindow.focus();
    alertWindow.moveTop();
    return;
  }

  const windowWidth = 420;
  const windowHeight = 330;
  const position = getPrimaryDisplayPosition(windowWidth, windowHeight);

  const createdAlertWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: position.x,
    y: position.y,
    minWidth: 360,
    minHeight: 300,
    title: "Timer finished",
    alwaysOnTop: true,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  alertWindow = createdAlertWindow;
  createdAlertWindow.loadFile(path.join(__dirname, "alert.html"));
  createdAlertWindow.on("closed", () => {
    if (alertWindow !== createdAlertWindow) return;
    alertWindow = null;
    if (mainWindow && !mainWindow.isDestroyed())
      mainWindow.webContents.send("timer-alert-dismissed");
  });
}

/** Dismiss the alert window and synchronize the main renderer alert state.
 * @param notifyMain Whether to tell the main renderer that the user dismissed the alert.
 */
function closeAlertWindow(notifyMain: boolean): void {
  const activeAlertWindow = alertWindow;
  alertWindow = null;
  if (activeAlertWindow && !activeAlertWindow.isDestroyed())
    activeAlertWindow.close();
  if (notifyMain && mainWindow && !mainWindow.isDestroyed())
    mainWindow.webContents.send("timer-alert-dismissed");
}

/** Check whether an IPC message came from the countdown window.
 * @param sender WebContents that sent the IPC message.
 */
function isCountdownWindowSender(sender: Electron.WebContents): boolean {
  return (
    !!countdownWindow &&
    !countdownWindow.isDestroyed() &&
    sender.id === countdownWindow.webContents.id
  );
}

/** Send the current remaining duration to the countdown window. */
function updateCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    const text = getCountdownText();
    countdownWindow.webContents.send("countdown-update", text);
    sendCountdownWindowPreferences();
  }
}

/** Send countdown appearance settings to the floating window.
 */
function sendCountdownWindowPreferences(): void {
  if (!countdownWindow || countdownWindow.isDestroyed()) return;
  countdownWindow.webContents.send(
    "countdown-menu-button-visibility",
    countdownMenuButtonVisiblePref,
  );
  countdownWindow.webContents.send(
    "countdown-font-size",
    countdownFontSizePref,
  );
  countdownWindow.webContents.send(
    "countdown-background-color",
    countdownBackgroundColorPref,
  );
}

/** Set the countdown time display format and refresh the window.
 * @param format The selected format for remaining time.
 */
function setCountdownFormat(format: "compact" | "clock" | "seconds"): void {
  countdownFormatPref = format;
  saveSettings();
  updateCountdownWindow();
}

/** Change whether the countdown window shows its menu button.
 * @param visible Whether the menu button should be visible.
 */
function setCountdownMenuButtonVisible(visible: boolean): void {
  countdownMenuButtonVisiblePref = visible;
  saveSettings();
  sendCountdownWindowPreferences();
}

/** Build the submenu for starting a timer with a preset duration.
 */
function buildNewInMenu(): Electron.MenuItemConstructorOptions {
  return {
    label: "New in",
    submenu: [
      { label: "5 seconds", click: () => startTimer(5) },
      { label: "10 seconds", click: () => startTimer(10) },
      { label: "30 seconds", click: () => startTimer(30) },
      { label: "1 minute", click: () => startTimer(60) },
      { label: "2 minutes", click: () => startTimer(120) },
      { label: "5 minutes", click: () => startTimer(300) },
      { label: "10 minutes", click: () => startTimer(600) },
      { label: "30 minutes", click: () => startTimer(1800) },
      { label: "1 hour", click: () => startTimer(3600) },
      { type: "separator" },
      {
        label: "Custom…",
        click: () => {
          mainWindow?.show();
          mainWindow?.focus();
          updateTrayMenu();
        },
      },
    ],
  };
}

/** Show the native menu for countdown display and window controls.
 */
function showCountdownWindowMenu(): void {
  if (!countdownWindow || countdownWindow.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    buildNewInMenu(),
    { type: "separator" },
    { label: "Remaining time format", enabled: false },
    {
      label: "Compact (2m, 1m, < 1m)",
      type: "radio",
      checked: countdownFormatPref === "compact",
      click: () => setCountdownFormat("compact"),
    },
    {
      label: "Clock (00:01:51)",
      type: "radio",
      checked: countdownFormatPref === "clock",
      click: () => setCountdownFormat("clock"),
    },
    {
      label: "Total seconds (111s)",
      type: "radio",
      checked: countdownFormatPref === "seconds",
      click: () => setCountdownFormat("seconds"),
    },
    { type: "separator" },
    {
      label: "Show menu button",
      type: "checkbox",
      checked: countdownMenuButtonVisiblePref,
      click: (item) => setCountdownMenuButtonVisible(item.checked),
    },
    { type: "separator" },
    {
      label: "Show main window",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        updateTrayMenu();
      },
    },
    { label: "Hide countdown window", click: destroyCountdownWindow },
  ]);
  menu.popup({ window: countdownWindow });
}

/** Resize the floating countdown window to match its rendered content.
 * @param width Requested window width in screen-independent pixels.
 * @param height Requested window height in screen-independent pixels.
 */
function resizeCountdownWindow(width: number, height: number): void {
  if (!countdownWindow || countdownWindow.isDestroyed()) return;
  if (
    countdownWindow.getContentSize()[0] === width &&
    countdownWindow.getContentSize()[1] === height
  )
    return;
  countdownWindowWidth = width;
  countdownWindowHeight = height;
  countdownWindow.setContentSize(width, height);
  rememberCountdownWindowPosition();
  scheduleCountdownWindowPositionSave();
}

/** Build the default position at the lower-right of a display work area.
 * @param display The display on which to position the countdown window.
 */
function defaultCountdownWindowPosition(
  display: Electron.Display = screen.getPrimaryDisplay(),
): CountdownWindowPosition {
  const area = display.workArea;
  const width = Math.min(countdownWindowWidth, area.width);
  const height = Math.min(countdownWindowHeight, area.height);
  return {
    displayId: String(display.id),
    displayLabel: display.label,
    displayBounds: { ...display.bounds },
    x: area.x + Math.max(0, area.width - width),
    y: area.y + Math.max(0, area.height - height),
    width,
    height,
  };
}

/** Check that a saved countdown window fits inside a display work area.
 * @param position The saved countdown window bounds.
 * @param display The display that should contain the window.
 */
function countdownPositionFits(
  position: CountdownWindowPosition,
  display: Electron.Display,
): boolean {
  const area = display.workArea;
  return (
    position.x >= area.x &&
    position.y >= area.y &&
    position.x + position.width <= area.x + area.width &&
    position.y + position.height <= area.y + area.height
  );
}

/** Resolve the saved monitor and return a usable countdown window position.
 */
function getRestoredCountdownWindowPosition(): CountdownWindowPosition {
  const displays = screen.getAllDisplays();
  const saved = countdownWindowPosition;
  let display = saved
    ? displays.find((item) => String(item.id) === saved.displayId)
    : undefined;
  if (!display && saved?.displayLabel) {
    const matches = displays.filter(
      (item) => item.label === saved.displayLabel,
    );
    if (matches.length === 1) display = matches[0];
  }
  if (!display && saved?.displayBounds) {
    const bounds = saved.displayBounds;
    const matches = displays.filter(
      (item) =>
        item.bounds.x === bounds.x &&
        item.bounds.y === bounds.y &&
        item.bounds.width === bounds.width &&
        item.bounds.height === bounds.height,
    );
    if (matches.length === 1) display = matches[0];
  }

  if (
    saved &&
    display &&
    countdownPositionFits({ ...saved, displayId: String(display.id) }, display)
  ) {
    countdownWindowWidth = saved.width;
    countdownWindowHeight = saved.height;
    return {
      ...saved,
      displayId: String(display.id),
      displayLabel: display.label,
      displayBounds: { ...display.bounds },
    };
  }
  return defaultCountdownWindowPosition();
}

/** Update saved display metadata from the current native window bounds.
 */
function rememberCountdownWindowPosition(): void {
  if (!countdownWindow || countdownWindow.isDestroyed()) return;
  const bounds = countdownWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  countdownWindowPosition = {
    displayId: String(display.id),
    displayLabel: display.label,
    displayBounds: { ...display.bounds },
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
}

/** Persist countdown window position after move/resize activity settles.
 */
function scheduleCountdownWindowPositionSave(): void {
  if (countdownPositionSaveTimer) clearTimeout(countdownPositionSaveTimer);
  countdownPositionSaveTimer = setTimeout(() => {
    countdownPositionSaveTimer = null;
    rememberCountdownWindowPosition();
    saveSettings();
  }, 250);
}

/** Persist the countdown window's latest position immediately.
 */
function saveCountdownWindowPositionNow(): void {
  if (countdownPositionSaveTimer) clearTimeout(countdownPositionSaveTimer);
  countdownPositionSaveTimer = null;
  rememberCountdownWindowPosition();
  saveSettings();
}

/** Move a countdown window back onto an available display after removal.
 */
function handleCountdownDisplayRemoved(): void {
  if (!countdownWindow || countdownWindow.isDestroyed()) return;
  const bounds = countdownWindow.getBounds();
  const display = screen.getDisplayMatching(bounds);
  const current: CountdownWindowPosition = {
    displayId: String(display.id),
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };
  if (!countdownPositionFits(current, display)) {
    const fallback = defaultCountdownWindowPosition();
    countdownWindow.setBounds({
      x: fallback.x,
      y: fallback.y,
      width: fallback.width,
      height: fallback.height,
    });
  }
  saveCountdownWindowPositionNow();
}

/** Create and show the floating countdown window if needed. */
function createCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.show();
    countdownWindow.focus();
    countdownWindow.moveTop();
    updateCountdownWindow();
    sendCountdownWindowPreferences();
    sendCountdownWindowState();
    return;
  }

  const restoredPosition = getRestoredCountdownWindowPosition();
  countdownWindowPosition = restoredPosition;
  countdownWindowWidth = restoredPosition.width;
  countdownWindowHeight = restoredPosition.height;

  countdownWindow = new BrowserWindow({
    width: restoredPosition.width,
    height: restoredPosition.height,
    x: restoredPosition.x,
    y: restoredPosition.y,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "countdown-preload.js"),
    },
  });

  countdownWindow.loadFile(path.join(__dirname, "countdown.html"));

  countdownWindow.on("move", scheduleCountdownWindowPositionSave);
  countdownWindow.on("moved", scheduleCountdownWindowPositionSave);
  countdownWindow.on("resize", scheduleCountdownWindowPositionSave);

  countdownWindow.once("ready-to-show", () => {
    if (countdownWindow) {
      updateCountdownWindow();
      countdownWindow.show();
      countdownWindow.setBounds({
        x: restoredPosition.x,
        y: restoredPosition.y,
        width: restoredPosition.width,
        height: restoredPosition.height,
      });
      countdownWindow.focus();
      sendCountdownWindowPreferences();
      // On Linux, the window may appear behind other windows or without focus.
      countdownWindow.moveTop();
      if (process.platform === "linux") {
        countdownWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
      }
      sendCountdownWindowState();
      setTimeout(saveCountdownWindowPositionNow, 150);
    }
  });

  countdownWindow.on("closed", () => {
    countdownWindow = null;
    sendCountdownWindowState();
  });
}

/** Close the floating countdown window and persist its hidden state. */
function destroyCountdownWindow(): void {
  if (countdownWindow) {
    saveCountdownWindowPositionNow();
    countdownWindow.close();
    countdownWindow = null;
  }
  sendCountdownWindowState();
  saveSettings();
}

/** Toggle the floating countdown window's visibility. */
function toggleCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    destroyCountdownWindow();
  } else {
    createCountdownWindow();
    saveSettings();
  }
}

/** Notify the main renderer whether the countdown window exists. */
function sendCountdownWindowState(): void {
  const visible = !!(countdownWindow && !countdownWindow.isDestroyed());
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("countdown-window-state", visible);
  }
  updateTrayMenu();
}

/** Rebuild the tray menu to match the main window's visibility. */
function updateTrayMenu(): void {
  if (!tray) return;
  const isCountdownVisible = !!(
    countdownWindow && !countdownWindow.isDestroyed()
  );

  const contextMenu = Menu.buildFromTemplate([
    {
      label: "Show main window",
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
        updateTrayMenu();
      },
    },
    {
      label: "Show countdown windows",
      type: "checkbox",
      checked: isCountdownVisible,
      click: () => toggleCountdownWindow(),
    },
    { type: "separator" },
    {
      label: "Quit",
      click: requestQuit,
    },
  ]);

  tray.setContextMenu(contextMenu);
}

/** Confirm and quit the application according to the saved preference. */
async function requestQuit(): Promise<void> {
  if (confirmQuitPref) {
    const options: Electron.MessageBoxOptions = {
      type: "question",
      buttons: ["Cancel", "Quit"],
      defaultId: 0,
      cancelId: 0,
      title: "Confirm quit",
      message: "Are you sure you want to quit the app?",
    };
    const result = mainWindow
      ? await dialog.showMessageBox(mainWindow, options)
      : await dialog.showMessageBox(options);
    if (result.response !== 1) return;
  }
  isQuitting = true;
  app.quit();
}

/** Refresh the tray icon and tooltip from the current timer state. */
function updateTrayIcon(): void {
  if (!tray) return;

  let icon: Electron.NativeImage;
  let tooltipText: string;

  if (timerState.isAlerting) {
    // Use a red icon while blinking.
    icon = createTextIcon("!", isBlinking);
    tooltipText = "⏰ Time is up!";
  } else if (timerState.isPaused && timerState.seconds > 0) {
    // Show "p" when the timer is paused.
    icon = createTextIcon("p", false, trayIconColorPref);
    tooltipText = `Timer paused: ${formatTimeForTooltip(timerState.seconds)}`;
  } else if (timerState.isRunning && timerState.seconds > 0) {
    // Show the remaining time.
    const text = formatTimeForTray(timerState.seconds);
    icon = createTextIcon(text, false, trayIconColorPref);
    tooltipText = `Timer: ${formatTimeForTooltip(timerState.seconds)}`;
  } else {
    // Show a dash when the timer is not running.
    icon = createTextIcon("—", false, trayIconColorPref);
    tooltipText = "Timer is not running";
  }

  tray.setImage(icon);
  tray.setToolTip(tooltipText);
}

/** Start blinking the tray icon to indicate a timer alert. */
function startBlinking(): void {
  if (blinkInterval) return;

  isBlinking = false;
  blinkInterval = setInterval(() => {
    isBlinking = !isBlinking;
    updateTrayIcon();
  }, 500); // Blink every 500 ms.
}

/** Stop tray-icon blinking and render the current non-alert state. */
function stopBlinking(): void {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
  }
  isBlinking = false;
  updateTrayIcon();
}

/** Broadcast timer state and refresh the tray and countdown displays. */
function sendTimerUpdateToRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send("timer-update", {
      seconds: remainingSeconds,
      isRunning: timerInterval !== null && !isPaused,
      isPaused: isPaused && timerInterval !== null,
      durationSeconds: timerDurationSeconds,
    });
  }

  // Update the tray state.
  timerState = {
    seconds: remainingSeconds,
    isRunning: timerInterval !== null && !isPaused,
    isAlerting: timerState.isAlerting,
    isPaused: isPaused && timerInterval !== null,
    durationSeconds: timerDurationSeconds,
  };

  updateTrayIcon();
  updateCountdownWindow();
}

/** Start a timer for the requested duration.
 * @param seconds Initial timer duration in seconds.
 */
function startTimer(seconds: number): void {
  if (timerInterval) {
    clearInterval(timerInterval);
  }

  remainingSeconds = seconds;
  timerDurationSeconds = seconds;
  isPaused = false;
  lastUpdateTime = Date.now();
  timerEndTime = lastUpdateTime + seconds * 1000;

  timerInterval = setInterval(() => {
    if (!isPaused) {
      const currentTime = Date.now();
      const elapsedMs = currentTime - lastUpdateTime;
      const elapsedSeconds = Math.floor(elapsedMs / 1000);

      if (elapsedSeconds > 0) {
        remainingSeconds = Math.max(
          0,
          Math.floor((timerEndTime - currentTime) / 1000),
        );
        lastUpdateTime = currentTime;

        sendTimerUpdateToRenderer();

        if (remainingSeconds <= 0) {
          stopTimer();
          // Notify the renderer that the timer has finished.
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send("timer-finished", timerDurationSeconds);
          }
        }
      }
    }
  }, 100); // Check every 100 ms for accuracy.

  sendTimerUpdateToRenderer();
  saveSettings();
}

/** Pause the active timer or resume it from its saved remaining duration. */
function pauseResumeTimer(): void {
  if (!timerInterval) return;

  if (isPaused) {
    // Recalculate timerEndTime when resuming.
    const currentTime = Date.now();
    timerEndTime = currentTime + remainingSeconds * 1000;
    lastUpdateTime = currentTime;
  }

  isPaused = !isPaused;
  sendTimerUpdateToRenderer();
  saveSettings();
}

/** Stop the active timer and clear its remaining duration. */
function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  remainingSeconds = 0;
  isPaused = false;
  lastUpdateTime = 0;
  timerEndTime = 0;

  sendTimerUpdateToRenderer();
  saveSettings();
}

/** Adjust an active timer's remaining time.
 * @param seconds Signed number of seconds to add or subtract.
 */
function adjustTimerTime(seconds: number): void {
  if (!timerInterval) return;

  // Refresh the remaining time while the timer is running.
  if (!isPaused) {
    const currentTime = Date.now();
    remainingSeconds = Math.max(
      0,
      Math.floor((timerEndTime - currentTime) / 1000),
    );
    lastUpdateTime = currentTime;
  }

  remainingSeconds += seconds;

  // Keep the time from becoming negative.
  if (remainingSeconds < 0) {
    remainingSeconds = 0;
  }
  remainingSeconds = Math.min(MAX_TIMER_SECONDS, remainingSeconds);
  timerDurationSeconds = Math.min(
    MAX_TIMER_SECONDS,
    Math.max(0, timerDurationSeconds + seconds),
  );

  // Update timerEndTime.
  const currentTime = Date.now();
  timerEndTime = currentTime + remainingSeconds * 1000;
  lastUpdateTime = currentTime;

  sendTimerUpdateToRenderer();
  saveSettings();
}

/** Create the main application window and install its lifecycle handlers. */
function createWindow(): void {
  const appIcon = createAppIcon();

  // Get the primary display.
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const { x, y } = primaryDisplay.workArea;

  // Center the window on the primary display.
  const windowWidth = 800;
  const windowHeight = 900;
  const windowX = x + Math.floor((width - windowWidth) / 2);
  const windowY = y + Math.floor((height - windowHeight) / 2);

  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, "preload.js"),
    },
    show: false, // Start the app minimized to the tray.
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.webContents.once("did-finish-load", () => {
    if (
      pendingStartupTimerFinished &&
      mainWindow &&
      !mainWindow.isDestroyed()
    ) {
      pendingStartupTimerFinished = false;
      mainWindow.webContents.send(
        "timer-finished-on-startup",
        timerDurationSeconds,
      );
    }
  });

  // Hide the window after it loads.
  mainWindow.once("ready-to-show", () => {
    if (mainWindow) {
      mainWindow.hide();
    }
  });

  // Hide the window to the tray when it is closed.
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on("minimize", () => {
    mainWindow?.hide();
  });

  mainWindow.on("show", updateTrayMenu);
  mainWindow.on("hide", updateTrayMenu);
}

/** Create the system tray icon and its click handlers. */
function createTray(): void {
  // Start with a dash icon.
  tray = new Tray(createTextIcon("—", false, trayIconColorPref));

  updateTrayMenu();
  updateTrayIcon();

  // Left-click the tray icon to show or hide the window.
  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    updateTrayMenu();
  });

  // Double-click the tray icon to show the window.
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
    updateTrayMenu();
  });
}

// Initialize the application.
/** Create the app windows, restore state, and register IPC handlers. */
function initializeApp(): void {
  createWindow();
  createTray();
  screen.on("display-removed", handleCountdownDisplayRemoved);

  // Restore state from settings.json.
  // Restore after creating the window and tray so the timer can update both.
  restoreSettings();

  registerIpcHandlers({
    isMainWindowSender,
    isSettingsWindowSender,
    isAlertWindowSender,
    isCountdownWindowSender,
    getUiSettings: () => ({
      advancedControlsVisible,
      instructionsVisible,
      notificationMode,
      alarmSoundEnabled,
      alarmSound,
      countdownFormat: countdownFormatPref,
      countdownFontSize: countdownFontSizePref,
      countdownMenuButtonVisible: countdownMenuButtonVisiblePref,
      countdownBackgroundColor: countdownBackgroundColorPref,
      trayIconColor: trayIconColorPref,
      mainWindowBackgroundColor: mainWindowBackgroundColorPref,
      sectionHeaderBackgroundColor: sectionHeaderBackgroundColorPref,
      sectionBackgroundColor: sectionBackgroundColorPref,
      confirmQuit: confirmQuitPref,
    }),
    setUiSettings: (settings) => {
      if (typeof settings.advancedControlsVisible === "boolean")
        advancedControlsVisible = settings.advancedControlsVisible;
      if (typeof settings.instructionsVisible === "boolean")
        instructionsVisible = settings.instructionsVisible;
      if (settings.notificationMode)
        notificationMode = settings.notificationMode;
      if (typeof settings.alarmSoundEnabled === "boolean")
        alarmSoundEnabled = settings.alarmSoundEnabled;
      if (settings.alarmSound) alarmSound = settings.alarmSound;
      if (settings.countdownFormat)
        countdownFormatPref = settings.countdownFormat;
      if (typeof settings.countdownFontSize === "number")
        countdownFontSizePref = settings.countdownFontSize;
      if (typeof settings.countdownMenuButtonVisible === "boolean")
        countdownMenuButtonVisiblePref = settings.countdownMenuButtonVisible;
      if (settings.countdownBackgroundColor)
        countdownBackgroundColorPref = settings.countdownBackgroundColor;
      if (settings.trayIconColor) trayIconColorPref = settings.trayIconColor;
      if (settings.mainWindowBackgroundColor) mainWindowBackgroundColorPref = settings.mainWindowBackgroundColor;
      if (settings.sectionHeaderBackgroundColor) sectionHeaderBackgroundColorPref = settings.sectionHeaderBackgroundColor;
      if (settings.sectionBackgroundColor) sectionBackgroundColorPref = settings.sectionBackgroundColor;
      if (typeof settings.confirmQuit === "boolean") confirmQuitPref = settings.confirmQuit;
      updateCountdownWindow();
      updateTrayIcon();
      saveSettings();
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send("ui-colors-updated", {
        mainWindowBackgroundColor: mainWindowBackgroundColorPref,
        sectionHeaderBackgroundColor: sectionHeaderBackgroundColorPref,
        sectionBackgroundColor: sectionBackgroundColorPref,
      });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("alert-preferences-updated", {
          notificationMode,
          alarmSoundEnabled,
          alarmSound,
        });
      }
    },
    setAlertWindowMode,
    openSettingsWindow,
    dismissAlertWindow: () => closeAlertWindow(true),
    getTimerState: () => ({
      seconds: remainingSeconds,
      durationSeconds: timerDurationSeconds,
      isRunning: !!timerInterval && !isPaused,
      isPaused,
    }),
    setAlerting: (alerting) => {
      timerState.isAlerting = alerting;
      if (alerting) startBlinking();
      else stopBlinking();
      updateTrayIcon();
    },
    startTimer,
    stopTimer,
    pauseResumeTimer,
    adjustTimerTime,
    toggleCountdownWindow,
    closeCountdownWindow: destroyCountdownWindow,
    showCountdownWindowMenu,
    resizeCountdownWindow,
    minimizeWindow: () => {
      mainWindow?.hide();
      updateTrayMenu();
    },
    clickTray: () => {
      if (!tray || !mainWindow) return;
      if (mainWindow.isVisible()) mainWindow.hide();
      else {
        mainWindow.show();
        mainWindow.focus();
      }
      updateTrayMenu();
    },
    requestQuit,
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// Enforce the single-instance lock when enabled.
if (ALLOW_ONLY_ONE_INSTANCE) {
  const gotTheLock = app.requestSingleInstanceLock();
  ownsInstanceLock = gotTheLock;

  if (!gotTheLock) {
    // Quit if another instance already holds the lock.
    app.quit();
  } else {
    // Handle attempts to launch another instance.
    app.on("second-instance", () => {
      // Show the existing window when another launch is requested.
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      initializeApp();
    });
  }
} else {
  // Start without checking the lock when multiple instances are allowed.
  app.whenReady().then(() => {
    initializeApp();
  });
}

app.on("window-all-closed", () => {
  // Keep the app running after all windows are closed.
  // The app continues running in the tray.
});

app.on("before-quit", () => {
  isQuitting = true;
  if (countdownWindow && !countdownWindow.isDestroyed())
    saveCountdownWindowPositionNow();
  if (ownsInstanceLock) saveSettings();
});
