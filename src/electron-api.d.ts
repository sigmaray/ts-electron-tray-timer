interface TimerState {
  seconds: number;
  durationSeconds: number;
  isRunning: boolean;
  isPaused: boolean;
}

interface ElectronAPI {
  getTimerState(): Promise<TimerState>;
  getUiSettings(): Promise<{
    advancedControlsVisible: boolean;
    instructionsVisible: boolean;
  }>;
  setUiSettings(settings: {
    advancedControlsVisible?: boolean;
    instructionsVisible?: boolean;
  }): void;
  updateTimerState(state: {
    seconds: number;
    isRunning: boolean;
    isAlerting: boolean;
    isPaused?: boolean;
  }): void;
  minimizeWindow(): void;
  clickTray(): void;
  closeApp(): void;
  startTimer(seconds: number): void;
  stopTimer(): void;
  pauseResumeTimer(): void;
  adjustTimerTime(seconds: number): void;
  onTimerUpdate(callback: (state: TimerState) => void): void;
  onTimerFinished(callback: (durationSeconds: number) => void): void;
  onStartupTimerFinished(callback: (durationSeconds: number) => void): void;
  removeTimerUpdateListener(): void;
  removeTimerFinishedListener(): void;
  toggleCountdownWindow(): void;
  onCountdownWindowState(callback: (visible: boolean) => void): void;
}

declare global {
  interface Window {
    electronAPI?: ElectronAPI;
    webkitAudioContext?: typeof AudioContext;
    startTimer?: () => void;
    stopTimer?: () => void;
  }
}

export {};
