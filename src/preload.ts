import { contextBridge, ipcRenderer } from 'electron';

// Предоставляем безопасный API для renderer процесса
contextBridge.exposeInMainWorld('electronAPI', {
  updateTimerState: (state: { seconds: number; isRunning: boolean; isAlerting: boolean; isPaused?: boolean }) => {
    ipcRenderer.send('timer-state-update', state);
  },
  minimizeWindow: () => {
    ipcRenderer.send('minimize-window');
  },
  closeApp: () => {
    ipcRenderer.send('close-app');
  }
});

