import { contextBridge, ipcRenderer } from "electron";

// The floating countdown window can only observe its display and close itself.
contextBridge.exposeInMainWorld("electronAPI", {
  /** Requests that the floating countdown window be closed. */
  closeCountdownWindow: () => ipcRenderer.send("countdown-window-close"),
  /** Subscribes to formatted countdown text updates.
   * @param callback The handler invoked with the current countdown text.
   */
  onCountdownUpdate: (callback: (text: string) => void) => {
    ipcRenderer.on("countdown-update", (_event, text: string) =>
      callback(text),
    );
  },
});
