import { app, BrowserWindow, Tray, Menu, dialog, screen } from "electron";
import * as path from "path";
import * as fs from "fs";
import {
  parsePersistedSettings,
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

const SETTINGS_VERSION = 1 as const;
const SETTINGS_FILE_NAME = "settings.json";
let settingsPathOverride: string | null = null;
let ownsInstanceLock = !ALLOW_ONLY_ONE_INSTANCE;

/** Resolve the settings path, preferring writable portable storage when enabled. */
function getSettingsPath(): string {
  if (process.env.TIMER_SETTINGS_PATH) return process.env.TIMER_SETTINGS_PATH;
  if (settingsPathOverride) return settingsPathOverride;

  const userDataPath = path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
  const portableMarkerPath = path.join(process.resourcesPath, "portable-mode");
  if (!app.isPackaged || !fs.existsSync(portableMarkerPath)) return userDataPath;

  try {
    fs.accessSync(process.resourcesPath, fs.constants.W_OK);
    const portableSettingsPath = path.join(
      process.resourcesPath,
      SETTINGS_FILE_NAME,
    );

    // Preserve settings from an earlier non-portable installation on first launch.
    if (!fs.existsSync(portableSettingsPath) && fs.existsSync(userDataPath)) {
      fs.copyFileSync(userDataPath, portableSettingsPath);
    }
    return portableSettingsPath;
  } catch {
    // App bundles and AppImages may be read-only; keep settings in the OS location.
    return userDataPath;
  }
}

/** Read and validate persisted settings, returning null when unavailable. */
function loadSettings(): PersistedSettings | null {
  try {
    return parsePersistedSettings(fs.readFileSync(getSettingsPath(), "utf8"));
  } catch {
    return null;
  }
}

/** Persist current UI preferences and active timer state. */
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
    advancedControlsVisible,
    instructionsVisible,
  };

  try {
    fs.writeFileSync(
      getSettingsPath(),
      JSON.stringify(settings, null, 2),
      "utf8",
    );
  } catch (err) {
    const userDataPath = path.join(app.getPath("userData"), SETTINGS_FILE_NAME);
    const isPortablePath =
      !process.env.TIMER_SETTINGS_PATH && getSettingsPath() !== userDataPath;

    if (isPortablePath) {
      try {
        settingsPathOverride = userDataPath;
        fs.writeFileSync(
          userDataPath,
          JSON.stringify(settings, null, 2),
          "utf8",
        );
        return;
      } catch (fallbackError) {
        console.error("Failed to save settings.json:", fallbackError);
        return;
      }
    }

    console.error("Failed to save settings.json:", err);
  }
}

/** Restore saved preferences and restart or pause the saved timer. */
function restoreSettings(): void {
  const settings = loadSettings();
  if (!settings) return;

  isRestoringSettings = true;
  advancedControlsVisible = settings.advancedControlsVisible === true;
  instructionsVisible = settings.instructionsVisible === true;

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
  if (seconds <= 0) return "—";
  if (seconds < 60) return "< 1m";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
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
  }
}

/** Create and show the floating countdown window if needed. */
function createCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.show();
    countdownWindow.focus();
    countdownWindow.moveTop();
    updateCountdownWindow();
    sendCountdownWindowState();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } =
    primaryDisplay.workAreaSize;
  const { x: screenX, y: screenY } = primaryDisplay.workArea;

  const windowWidth = 280;
  const windowHeight = 70;
  const x = screenX + screenWidth - windowWidth;
  const y = screenY + screenHeight - windowHeight;

  countdownWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
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

  countdownWindow.once("ready-to-show", () => {
    if (countdownWindow) {
      updateCountdownWindow();
      countdownWindow.show();
      countdownWindow.focus();
      // On Linux, the window may appear behind other windows or without focus.
      countdownWindow.moveTop();
      if (process.platform === "linux") {
        countdownWindow.setVisibleOnAllWorkspaces(true, {
          visibleOnFullScreen: true,
        });
      }
      sendCountdownWindowState();
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
}

/** Rebuild the tray menu to match the main window's visibility. */
function updateTrayMenu(): void {
  if (!tray) return;
  const isVisible = mainWindow?.isVisible() ?? false;
  const toggleLabel = isVisible ? "Minimize to tray" : "Show";

  const contextMenu = Menu.buildFromTemplate([
    {
      label: toggleLabel,
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
        updateTrayMenu();
      },
    },
    {
      label: "Quit",
      click: async () => {
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

        if (result.response === 1) {
          isQuitting = true;
          app.quit();
        }
      },
    },
  ]);

  tray.setContextMenu(contextMenu);
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
    icon = createTextIcon("p", false);
    tooltipText = `Timer paused: ${formatTimeForTooltip(timerState.seconds)}`;
  } else if (timerState.isRunning && timerState.seconds > 0) {
    // Show the remaining time.
    const text = formatTimeForTray(timerState.seconds);
    icon = createTextIcon(text, false);
    tooltipText = `Timer: ${formatTimeForTooltip(timerState.seconds)}`;
  } else {
    // Show a dash when the timer is not running.
    icon = createTextIcon("—", false);
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
  tray = new Tray(createTextIcon("—", false));

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

  // Restore state from settings.json.
  // Restore after creating the window and tray so the timer can update both.
  restoreSettings();

  registerIpcHandlers({
    isMainWindowSender,
    isCountdownWindowSender,
    getUiSettings: () => ({ advancedControlsVisible, instructionsVisible }),
    setUiSettings: (settings) => {
      if (typeof settings.advancedControlsVisible === "boolean")
        advancedControlsVisible = settings.advancedControlsVisible;
      if (typeof settings.instructionsVisible === "boolean")
        instructionsVisible = settings.instructionsVisible;
      saveSettings();
    },
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
  if (ownsInstanceLock) saveSettings();
});
