/** Describes the timer values reported to renderer windows.
 */
interface TimerState {
  seconds: number;
  durationSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
}

/** Defines the IPC operations available to the main renderer window.
 */
interface ElectronAPI {
  /** Retrieves the current timer snapshot.
   */
  getTimerState(): Promise<TimerState>;
  /** Retrieves user interface visibility preferences.
   */
  getUiSettings(): Promise<{
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
  }>;
  /** Saves visibility preferences for the main window.
   * @param settings The visibility preferences to update.
   */
  setUiSettings(settings: {
    confirmQuit?: boolean;
    advancedControlsVisible?: boolean;
    instructionsVisible?: boolean;
    notificationMode?: "window" | "system" | "both";
    alarmSoundEnabled?: boolean;
    alarmSound?: "classic" | "digital" | "gentle";
    countdownFormat?: "compact" | "clock" | "seconds";
    countdownFontSize?: number;
    countdownMenuButtonVisible?: boolean;
    countdownBackgroundColor?: string;
    trayIconColor?: string;
    mainWindowBackgroundColor?: string;
    sectionHeaderBackgroundColor?: string;
    sectionBackgroundColor?: string;
  }): void;
  /** Subscribes to main-window color preference updates.
   * @param callback The handler that applies the updated colors.
   */
  onUiColorsUpdated(
    callback: (colors: {
      mainWindowBackgroundColor: string;
      sectionHeaderBackgroundColor: string;
      sectionBackgroundColor: string;
    }) => void,
  ): void;
  /** Opens the separate application settings window. */
  openSettingsWindow(): void;
  /** Sets or clears the always-on-top completion window.
   * @param mode The selected alert mode, or null when dismissing the alert.
   */
  setAlertWindowMode(mode: "window" | "system" | "both" | null): void;
  /** Requests dismissal of the timer completion window. */
  dismissTimerAlert(): void;
  /** Subscribes to dismissal from the separate timer completion window.
   * @param callback The handler invoked when the alert window is dismissed.
   */
  onTimerAlertDismissed(callback: () => void): void;
  /** Subscribes to completion preference updates from the settings window.
   * @param callback The handler invoked with the new alert preferences.
   */
  onAlertPreferencesUpdated(
    callback: (settings: {
      notificationMode: "window" | "system" | "both";
      alarmSoundEnabled: boolean;
      alarmSound: "classic" | "digital" | "gentle";
    }) => void,
  ): void;
  /** Reports renderer-side alert and timer state to the main process.
   * @param state The current timer state and alert flags.
   */
  updateTimerState(state: {
    seconds: number;
    isRunning: boolean;
    isAlerting: boolean;
    isPaused?: boolean;
  }): void;
  /** Minimizes the main application window.
   */
  minimizeWindow(): void;
  /** Notifies the main process that the tray icon was clicked.
   */
  clickTray(): void;
  /** Requests application shutdown.
   */
  closeApp(): void;
  /** Starts a timer for the requested duration.
   * @param seconds The timer duration in seconds.
   */
  startTimer(seconds: number): void;
  /** Stops the active timer.
   */
  stopTimer(): void;
  /** Toggles the active timer between running and paused states.
   */
  pauseResumeTimer(): void;
  /** Adjusts the active timer's remaining duration.
   * @param seconds The signed adjustment in seconds.
   */
  adjustTimerTime(seconds: number): void;
  /** Subscribes to timer snapshot updates.
   * @param callback The handler invoked with each timer snapshot.
   */
  onTimerUpdate(callback: (state: TimerState) => void): void;
  /** Subscribes to timer completion events.
   * @param callback The handler invoked with the completed duration in seconds.
   */
  onTimerFinished(callback: (durationSeconds: number) => void): void;
  /** Subscribes to a completion event recovered during application startup.
   * @param callback The handler invoked with the completed duration in seconds.
   */
  onStartupTimerFinished(callback: (durationSeconds: number) => void): void;
  /** Removes timer snapshot subscriptions.
   */
  removeTimerUpdateListener(): void;
  /** Removes timer completion subscriptions.
   */
  removeTimerFinishedListener(): void;
  /** Shows or hides the floating countdown window.
   */
  toggleCountdownWindow(): void;
  /** Subscribes to floating countdown window visibility changes.
   * @param callback The handler invoked with the window visibility.
   */
  onCountdownWindowState(callback: (visible: boolean) => void): void;
}

declare global {
  /** Describes APIs exposed to browser windows by preload scripts. */
  interface Window {
    electronAPI?: ElectronAPI;
    webkitAudioContext?: typeof AudioContext;
    startTimer?: () => void;
    stopTimer?: () => void;
  }
}

export {};
