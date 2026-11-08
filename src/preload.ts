import { contextBridge, ipcRenderer } from "electron";

// Expose a limited API to the renderer process.
contextBridge.exposeInMainWorld("electronAPI", {
  /** Retrieves the current timer snapshot from the main process. */
  getTimerState: () =>
    ipcRenderer.invoke("timer-state-get") as Promise<{
      seconds: number;
      isRunning: boolean;
      isPaused: boolean;
      durationSeconds: number;
    }>,
  /** Retrieves the saved user interface visibility preferences. */
  getUiSettings: () =>
    ipcRenderer.invoke("ui-settings-get") as Promise<{
      advancedControlsVisible: boolean;
      instructionsVisible: boolean;
    }>,
  /** Updates saved user interface visibility preferences.
   * @param settings The visibility preferences to update.
   */
  setUiSettings: (settings: {
    advancedControlsVisible?: boolean;
    instructionsVisible?: boolean;
  }) => {
    ipcRenderer.send("ui-settings-set", settings);
  },
  /** Reports renderer timer and alert state to the main process.
   * @param state The current timer state and alert flags.
   */
  updateTimerState: (state: {
    seconds: number;
    isRunning: boolean;
    isAlerting: boolean;
    isPaused?: boolean;
  }) => {
    ipcRenderer.send("timer-state-update", state);
  },
  /** Minimizes the main application window. */
  minimizeWindow: () => {
    ipcRenderer.send("minimize-window");
  },
  /** Notifies the main process that the tray icon was clicked. */
  clickTray: () => {
    ipcRenderer.send("tray-click");
  },
  /** Requests application shutdown. */
  closeApp: () => {
    ipcRenderer.send("close-app");
  },
  // Timer commands.
  /** Starts a timer for the requested duration.
   * @param seconds The timer duration in seconds.
   */
  startTimer: (seconds: number) => {
    ipcRenderer.send("timer-start", seconds);
  },
  /** Stops the active timer. */
  stopTimer: () => {
    ipcRenderer.send("timer-stop");
  },
  /** Toggles the active timer between running and paused states. */
  pauseResumeTimer: () => {
    ipcRenderer.send("timer-pause-resume");
  },
  /** Adjusts the active timer's remaining duration.
   * @param seconds The signed adjustment in seconds.
   */
  adjustTimerTime: (seconds: number) => {
    ipcRenderer.send("timer-adjust", seconds);
  },
  // Listen for events from the main process.
  /** Subscribes to timer snapshot updates.
   * @param callback The handler invoked with each timer snapshot.
   */
  onTimerUpdate: (
    callback: (state: {
      seconds: number;
      isRunning: boolean;
      isPaused: boolean;
      durationSeconds: number;
    }) => void,
  ) => {
    ipcRenderer.on("timer-update", (_event, state) => callback(state));
  },
  /** Subscribes to timer completion events.
   * @param callback The handler invoked with the completed duration in seconds.
   */
  onTimerFinished: (callback: (durationSeconds: number) => void) => {
    ipcRenderer.on("timer-finished", (_event, durationSeconds: number) =>
      callback(durationSeconds),
    );
  },
  /** Subscribes to completion recovered during application startup.
   * @param callback The handler invoked with the completed duration in seconds.
   */
  onStartupTimerFinished: (callback: (durationSeconds: number) => void) => {
    ipcRenderer.on(
      "timer-finished-on-startup",
      (_event, durationSeconds: number) => callback(durationSeconds),
    );
  },
  // Remove event listeners.
  /** Removes timer snapshot subscriptions. */
  removeTimerUpdateListener: () => {
    ipcRenderer.removeAllListeners("timer-update");
  },
  /** Removes timer completion subscriptions. */
  removeTimerFinishedListener: () => {
    ipcRenderer.removeAllListeners("timer-finished");
  },
  // Countdown window.
  /** Shows or hides the floating countdown window. */
  toggleCountdownWindow: () => {
    ipcRenderer.send("countdown-window-toggle");
  },
  /** Closes the floating countdown window. */
  closeCountdownWindow: () => {
    ipcRenderer.send("countdown-window-close");
  },
  /** Subscribes to floating countdown window visibility changes.
   * @param callback The handler invoked with the window visibility.
   */
  onCountdownWindowState: (callback: (visible: boolean) => void) => {
    ipcRenderer.on("countdown-window-state", (_event, visible: boolean) =>
      callback(visible),
    );
  },
  /** Subscribes to text updates for the floating countdown display.
   * @param callback The handler invoked with the formatted countdown text.
   */
  onCountdownUpdate: (callback: (text: string) => void) => {
    ipcRenderer.on("countdown-update", (_event, text: string) =>
      callback(text),
    );
  },
});
