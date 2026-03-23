import { contextBridge, ipcRenderer } from 'electron';

// Предоставляем безопасный API для renderer процесса
contextBridge.exposeInMainWorld('electronAPI', {
  updateTimerState: (state: { seconds: number; isRunning: boolean; isAlerting: boolean; isPaused?: boolean }) => {
    ipcRenderer.send('timer-state-update', state);
  },
  minimizeWindow: () => {
    ipcRenderer.send('minimize-window');
  },
  clickTray: () => {
    ipcRenderer.send('tray-click');
  },
  closeApp: () => {
    ipcRenderer.send('close-app');
  },
  // Команды таймера
  startTimer: (seconds: number) => {
    ipcRenderer.send('timer-start', seconds);
  },
  stopTimer: () => {
    ipcRenderer.send('timer-stop');
  },
  pauseResumeTimer: () => {
    ipcRenderer.send('timer-pause-resume');
  },
  adjustTimerTime: (seconds: number) => {
    ipcRenderer.send('timer-adjust', seconds);
  },
  // Слушатели событий от main процесса
  onTimerUpdate: (callback: (state: { seconds: number; isRunning: boolean; isPaused: boolean }) => void) => {
    ipcRenderer.on('timer-update', (_event, state) => callback(state));
  },
  onTimerFinished: (callback: () => void) => {
    ipcRenderer.on('timer-finished', () => callback());
  },
  // Удаление слушателей
  removeTimerUpdateListener: () => {
    ipcRenderer.removeAllListeners('timer-update');
  },
  removeTimerFinishedListener: () => {
    ipcRenderer.removeAllListeners('timer-finished');
  },
  // Окно отсчёта времени
  toggleCountdownWindow: () => {
    ipcRenderer.send('countdown-window-toggle');
  },
  closeCountdownWindow: () => {
    ipcRenderer.send('countdown-window-close');
  },
  onCountdownWindowState: (callback: (visible: boolean) => void) => {
    ipcRenderer.on('countdown-window-state', (_event, visible: boolean) => callback(visible));
  },
  onCountdownUpdate: (callback: (text: string) => void) => {
    ipcRenderer.on('countdown-update', (_event, text: string) => callback(text));
  }
});

