import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import ipcHandlersModule from "../../dist/ipc-handlers.js";
import settingsModule from "../../dist/settings.js";
import storageModule from "../../dist/settings-storage.js";
import timeModule from "../../dist/time.js";

const { registerIpcHandlers } = ipcHandlersModule;
const { resolveCountdownWindowPosition } = settingsModule;
const { writeSettingsAtomically } = storageModule;
const { MAX_TIMER_SECONDS } = timeModule;

/** Store IPC handlers so tests can invoke them with controlled sender payloads. */
class IpcHandlerRegistry {
  /** Create isolated handler maps for one test case. */
  constructor() {
    this.listeners = new Map();
    this.handlers = new Map();
  }

  /** Register an asynchronous IPC handler.
   * @param channel IPC channel name.
   * @param handler Handler function registered for the channel.
   */
  handle(channel, handler) {
    this.handlers.set(channel, handler);
  }

  /** Register a one-way IPC listener.
   * @param channel IPC channel name.
   * @param listener Listener function registered for the channel.
   */
  on(channel, listener) {
    this.listeners.set(channel, listener);
  }
}

/** Build a sender object tagged with the renderer role under test.
 * @param role Renderer role used by the sender authorization checks.
 */
function createSender(role) {
  return { role };
}

/** Check whether an IPC sender represents the main window.
 * @param sender Sender object supplied by the fake IPC registry.
 */
function isMainWindowSender(sender) {
  return sender.role === "main";
}

/** Check whether an IPC sender represents the settings window.
 * @param sender Sender object supplied by the fake IPC registry.
 */
function isSettingsWindowSender(sender) {
  return sender.role === "settings";
}

/** Check whether an IPC sender represents the alert window.
 * @param sender Sender object supplied by the fake IPC registry.
 */
function isAlertWindowSender(sender) {
  return sender.role === "alert";
}

/** Check whether an IPC sender represents the countdown window.
 * @param sender Sender object supplied by the fake IPC registry.
 */
function isCountdownWindowSender(sender) {
  return sender.role === "countdown";
}

/** Provide a no-op callback for IPC dependencies not exercised by a test. */
function noOperation() {}

/** Return an empty preference snapshot for IPC handler tests. */
function getEmptyUiSettings() {
  return {};
}

/** Return an idle timer snapshot for IPC handler tests. */
function getIdleTimerState() {
  return { seconds: 0, durationSeconds: 0, isRunning: false, isPaused: false };
}

/** Create fake main-process dependencies and collect selected operations.
 * @param calls Arrays used to capture validated timer and settings updates.
 */
function createIpcDependencies(calls) {
  /** Capture a timer start accepted by the IPC validation layer.
   * @param seconds Validated timer duration in seconds.
   */
  function startTimer(seconds) {
    calls.startedTimers.push(seconds);
  }

  /** Capture settings accepted by the IPC validation layer.
   * @param settings Validated partial settings update.
   */
  function setUiSettings(settings) {
    calls.settingsUpdates.push(settings);
  }

  return {
    isMainWindowSender,
    isSettingsWindowSender,
    isAlertWindowSender,
    isCountdownWindowSender,
    getUiSettings: getEmptyUiSettings,
    setUiSettings,
    setAlertWindowMode: noOperation,
    openSettingsWindow: noOperation,
    dismissAlertWindow: noOperation,
    getTimerState: getIdleTimerState,
    setAlerting: noOperation,
    startTimer,
    stopTimer: noOperation,
    pauseResumeTimer: noOperation,
    adjustTimerTime: noOperation,
    toggleCountdownWindow: noOperation,
    closeCountdownWindow: noOperation,
    showCountdownWindowMenu: noOperation,
    resizeCountdownWindow: noOperation,
    minimizeWindow: noOperation,
    clickTray: noOperation,
    requestQuit: noOperation,
  };
}

/** Create a temporary directory for a settings file test.
 */
function createTemporaryDirectory() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "timer-settings-test-"));
}

/** Remove a temporary directory after a settings file test.
 * @param directory Temporary directory to remove recursively.
 */
function removeTemporaryDirectory(directory) {
  fs.rmSync(directory, { recursive: true, force: true });
}

/** Confirm atomic writes create a new file and replace a previous value.
 */
function writesSettingsAtomically() {
  const directory = createTemporaryDirectory();
  const filePath = path.join(directory, "settings.json");

  try {
    writeSettingsAtomically(filePath, "first settings");
    assert.equal(fs.readFileSync(filePath, "utf8"), "first settings");
    writeSettingsAtomically(filePath, "updated settings");
    assert.equal(fs.readFileSync(filePath, "utf8"), "updated settings");
    assert.deepEqual(fs.readdirSync(directory), ["settings.json"]);
  } finally {
    removeTemporaryDirectory(directory);
  }
}

/** Confirm a failed rename preserves the last complete settings file.
 */
function preservesSettingsWhenRenameFails() {
  const directory = createTemporaryDirectory();
  const filePath = path.join(directory, "settings.json");
  const originalRename = fs.renameSync;
  fs.writeFileSync(filePath, "previous complete settings");

  try {
    /** Simulate the filesystem rejecting the atomic replacement step. */
    function simulateRenameFailure() {
      throw new Error("simulated rename failure");
    }

    /** Attempt the update whose rename operation is configured to fail. */
    function attemptFailedSettingsWrite() {
      writeSettingsAtomically(filePath, "partial replacement");
    }

    fs.renameSync = simulateRenameFailure;
    assert.throws(attemptFailedSettingsWrite, /simulated rename failure/);
  } finally {
    fs.renameSync = originalRename;
  }

  try {
    assert.equal(
      fs.readFileSync(filePath, "utf8"),
      "previous complete settings",
    );
    assert.deepEqual(fs.readdirSync(directory), ["settings.json"]);
  } finally {
    removeTemporaryDirectory(directory);
  }
}

/** Resolve the saved countdown position using current display metadata.
 */
function restoresCountdownPositionOnMatchingDisplay() {
  const saved = {
    displayId: "old-id",
    displayLabel: "External display",
    displayBounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    x: 3500,
    y: 900,
    width: 280,
    height: 70,
  };
  const currentDisplay = {
    id: "new-id",
    label: "External display",
    bounds: { x: 1920, y: 0, width: 1920, height: 1080 },
    workArea: { x: 1920, y: 0, width: 1920, height: 1040 },
  };
  const fallback = {
    displayId: "primary",
    x: 100,
    y: 100,
    width: 280,
    height: 70,
  };

  assert.deepEqual(
    resolveCountdownWindowPosition(saved, [currentDisplay], fallback),
    {
      ...saved,
      displayId: "new-id",
      displayBounds: currentDisplay.bounds,
    },
  );
}

/** Use the fallback when a saved position is off-screen or its display is gone.
 */
function fallsBackForUnavailableCountdownDisplay() {
  const fallback = {
    displayId: "primary",
    x: 100,
    y: 100,
    width: 280,
    height: 70,
  };
  const display = {
    id: "primary",
    label: "Built-in display",
    bounds: { x: 0, y: 0, width: 1920, height: 1080 },
    workArea: { x: 0, y: 0, width: 1920, height: 1040 },
  };
  const offScreen = {
    displayId: "primary",
    x: 1800,
    y: 1000,
    width: 280,
    height: 70,
  };
  const missingDisplay = { ...offScreen, displayId: "disconnected" };

  assert.deepEqual(
    resolveCountdownWindowPosition(offScreen, [display], fallback),
    fallback,
  );
  assert.deepEqual(
    resolveCountdownWindowPosition(missingDisplay, [display], fallback),
    fallback,
  );
}

/** Confirm IPC accepts bounded timer values only from the main window.
 */
function validatesTimerStartIpcPayloads() {
  const registry = new IpcHandlerRegistry();
  const calls = { startedTimers: [], settingsUpdates: [] };
  registerIpcHandlers(createIpcDependencies(calls), registry);
  const timerStart = registry.listeners.get("timer-start");

  timerStart({ sender: createSender("main") }, 15);
  timerStart({ sender: createSender("main") }, 0);
  timerStart({ sender: createSender("main") }, 1.5);
  timerStart({ sender: createSender("main") }, MAX_TIMER_SECONDS + 1);
  timerStart({ sender: createSender("untrusted") }, 30);

  assert.deepEqual(calls.startedTimers, [15]);
}

/** Confirm IPC sanitizes preference values and rejects unauthorized senders.
 */
function validatesSettingsIpcPayloads() {
  const registry = new IpcHandlerRegistry();
  const calls = { startedTimers: [], settingsUpdates: [] };
  registerIpcHandlers(createIpcDependencies(calls), registry);
  const updateSettings = registry.listeners.get("ui-settings-set");

  updateSettings({ sender: createSender("untrusted") }, { confirmQuit: false });
  updateSettings(
    { sender: createSender("settings") },
    {
      confirmQuit: true,
      countdownFontSize: 80,
      sectionBackgroundColor: "#AABBCC",
      notificationMode: "unknown",
      unknownPreference: true,
    },
  );

  assert.deepEqual(calls.settingsUpdates, [
    { confirmQuit: true, sectionBackgroundColor: "#aabbcc" },
  ]);
}

test("atomically writes new and updated settings", writesSettingsAtomically);
test(
  "preserves prior settings when the atomic rename fails",
  preservesSettingsWhenRenameFails,
);
test(
  "restores countdown position when the saved display can be matched",
  restoresCountdownPositionOnMatchingDisplay,
);
test(
  "uses the fallback position when the display is missing or bounds do not fit",
  fallsBackForUnavailableCountdownDisplay,
);
test(
  "validates timer start IPC payloads and sender authorization",
  validatesTimerStartIpcPayloads,
);
test(
  "validates settings IPC payloads and sender authorization",
  validatesSettingsIpcPayloads,
);
