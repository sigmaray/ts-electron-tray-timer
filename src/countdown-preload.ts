import { contextBridge, ipcRenderer } from "electron";

// The floating countdown window can only observe its display and close itself.
contextBridge.exposeInMainWorld("electronAPI", {
  /** Requests that the floating countdown window be closed. */
  closeCountdownWindow: () => ipcRenderer.send("countdown-window-close"),
  /** Opens the native countdown window menu. */
  showCountdownWindowMenu: () => ipcRenderer.send("countdown-window-menu"),
  /** Requests a content-sized floating countdown window.
   * @param width Rendered widget width in screen-independent pixels.
   * @param height Rendered widget height in screen-independent pixels.
   */
  resizeCountdownWindow: (width: number, height: number) =>
    ipcRenderer.send("countdown-window-resize", width, height),
  /** Subscribes to formatted countdown text updates.
   * @param callback The handler invoked with the current countdown text.
   */
  onCountdownUpdate: (callback: (text: string) => void) => {
    ipcRenderer.on("countdown-update", (_event, text: string) =>
      callback(text),
    );
  },
  /** Subscribes to countdown menu button visibility changes.
   * @param callback The handler invoked with the current visibility setting.
   */
  onCountdownMenuButtonVisibility: (callback: (visible: boolean) => void) => {
    ipcRenderer.on("countdown-menu-button-visibility", (_event, visible) =>
      callback(visible),
    );
  },
  /** Subscribes to countdown font size changes.
   * @param callback The handler invoked with the font size in points.
   */
  onCountdownFontSize: (callback: (size: number) => void) => {
    ipcRenderer.on("countdown-font-size", (_event, size) => callback(size));
  },
  /** Subscribes to countdown background color changes.
   * @param callback The handler invoked with a hexadecimal color value.
   */
  onCountdownBackgroundColor: (callback: (color: string) => void) => {
    ipcRenderer.on("countdown-background-color", (_event, color) =>
      callback(color),
    );
  },
});
