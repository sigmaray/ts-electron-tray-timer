import { contextBridge, ipcRenderer } from 'electron';

// Предоставляем безопасный API для renderer процесса
contextBridge.exposeInMainWorld('electronAPI', {
  updateTimerState: (state: { seconds: number; isRunning: boolean; isAlerting: boolean }) => {
    ipcRenderer.send('timer-state-update', state);
  }
});

