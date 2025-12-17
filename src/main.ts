import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } from 'electron';
import * as path from 'path';
import { createCanvas } from 'canvas';

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
let timerState: { seconds: number; isRunning: boolean; isAlerting: boolean } = {
  seconds: 0,
  isRunning: false,
  isAlerting: false
};
let blinkInterval: NodeJS.Timeout | null = null;
let isBlinking = false;

function updateTrayMenu(): void {
  if (!tray) return;
  const isVisible = mainWindow?.isVisible() ?? false;
  const toggleLabel = isVisible ? 'Свернуть в трей' : 'Показать';

  const contextMenu = Menu.buildFromTemplate([
    {
      label: toggleLabel,
      click: () => {
        if (!mainWindow) return;
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
        updateTrayMenu();
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

  tray.setContextMenu(contextMenu);
}

function createTextIcon(text: string, isBlinking: boolean = false): Electron.NativeImage {
  const size = 22; // Стандартный размер для трея
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Определяем цвет в зависимости от состояния
  let bgColor: string;
  let textColor: string = '#FFFFFF';
  
  if (isBlinking) {
    // Мигание: красный
    bgColor = '#FF0000';
  } else if (text === '—') {
    // Прочерк: серый
    bgColor = '#808080';
  } else {
    // Активный таймер: фиолетовый
    bgColor = '#7c3aed';
  }
  
  // Рисуем фон
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, size, size);
  
  // Рисуем текст
  ctx.fillStyle = textColor;
  ctx.font = 'bold 12px Arial';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, size / 2, size / 2);
  
  // Конвертируем canvas в buffer
  const buffer = canvas.toBuffer('image/png');
  return nativeImage.createFromBuffer(buffer);
}

function formatTimeForTray(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return String(seconds);
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, '0')}`;
}

function updateTrayIcon(): void {
  if (!tray) return;
  
  let icon: Electron.NativeImage;
  let tooltipText: string;
  
  if (timerState.isAlerting) {
    // Мигание: красная иконка
    icon = createTextIcon('!', isBlinking);
    tooltipText = '⏰ Время истекло!';
  } else if (timerState.isRunning && timerState.seconds > 0) {
    // Показываем оставшиеся секунды
    const text = formatTimeForTray(timerState.seconds);
    icon = createTextIcon(text, false);
    tooltipText = `Таймер: ${formatTimeForTray(timerState.seconds)}`;
  } else {
    // Прочерк когда таймер не запущен
    icon = createTextIcon('—', false);
    tooltipText = 'Таймер не запущен';
  }
  
  tray.setImage(icon);
  tray.setToolTip(tooltipText);
}

function startBlinking(): void {
  if (blinkInterval) return;
  
  isBlinking = false;
  blinkInterval = setInterval(() => {
    isBlinking = !isBlinking;
    updateTrayIcon();
  }, 500); // Мигание каждые 500мс
}

function stopBlinking(): void {
  if (blinkInterval) {
    clearInterval(blinkInterval);
    blinkInterval = null;
  }
  isBlinking = false;
  updateTrayIcon();
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
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

  mainWindow.on('show', updateTrayMenu);
  mainWindow.on('hide', updateTrayMenu);
}

function createTray(): void {
  // Начальная иконка с прочерком
  tray = new Tray(createTextIcon('—', false));


  updateTrayMenu();
  updateTrayIcon();

  // ЛКМ по иконке: показать/скрыть окно
  tray.on('click', () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
    updateTrayMenu();
  });

  // Двойной клик по иконке также показывает окно
  tray.on('double-click', () => {
    mainWindow?.show();
    mainWindow?.focus();
    updateTrayMenu();
  });
}

app.whenReady().then(() => {
  createWindow();
  createTray();

  // Обработчик обновлений состояния таймера
  ipcMain.on('timer-state-update', (_event, state: { seconds: number; isRunning: boolean; isAlerting: boolean }) => {
    timerState = state;
    
    if (state.isAlerting) {
      startBlinking();
    } else {
      stopBlinking();
    }
    
    updateTrayIcon();
  });

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

