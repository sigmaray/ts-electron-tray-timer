import { contextBridge, ipcRenderer } from 'electron';

// The floating countdown window can only observe its display and close itself.
contextBridge.exposeInMainWorld('electronAPI', {
  closeCountdownWindow: () => ipcRenderer.send('countdown-window-close'),
  onCountdownUpdate: (callback: (text: string) => void) => {
    ipcRenderer.on('countdown-update', (_event, text: string) => callback(text));
  },
});
