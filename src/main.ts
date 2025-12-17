import { app, BrowserWindow, Tray, Menu, nativeImage } from 'electron';
import * as path from 'path';

// Расширяем тип app для свойства isQuitting
declare global {
  namespace Electron {
    interface App {
      isQuitting?: boolean;
    }
  }
}

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

function getTrayIcon(): Electron.NativeImage {
  // Сначала пробуем загрузить иконку из файлов (dist/assets/icon.png)
  const iconPath = path.join(__dirname, 'assets', 'icon.png');
  try {
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  } catch {
    // игнорируем и переходим к запасному варианту
  }

  // Запасная иконка: простая фиолетовая плашка 32x32
  const size = 32;
  const data = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const idx = i * 4;
    // BGRA
    data[idx] = 0xed; // B
    data[idx + 1] = 0x3a; // G
    data[idx + 2] = 0x7c; // R
    data[idx + 3] = 0xff; // A
  }
  return nativeImage.createFromBuffer(data, { width: size, height: size });
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Обработка закрытия окна - сворачиваем в tray вместо закрытия
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('minimize', () => {
    mainWindow?.hide();
  });
}

function createTray(): void {
  tray = new Tray(getTrayIcon());

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Показать',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Выход',
      click: () => {
        app.isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setToolTip('Electron Tray App');
  tray.setContextMenu(contextMenu);

  // Двойной клик по иконке также показывает окно
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
});

app.on('window-all-closed', () => {
  // Не закрываем приложение при закрытии всех окон
  // Оно будет работать в tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
});

