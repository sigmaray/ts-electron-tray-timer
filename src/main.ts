import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, dialog, screen } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
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
let countdownWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

// Экспортируем tray для тестирования (только в development режиме)
if (process.env.NODE_ENV === 'test' || process.env.ELECTRON_DISABLE_SANDBOX) {
  (global as any).__tray__ = () => tray;
}

// Константа для управления разрешением только одного экземпляра приложения
const ALLOW_ONLY_ONE_INSTANCE = process.env.ALLOW_ONLY_ONE_INSTANCE !== 'false';

let timerState: { seconds: number; isRunning: boolean; isAlerting: boolean; isPaused?: boolean } = {
  seconds: 0,
  isRunning: false,
  isAlerting: false,
  isPaused: false
};
let blinkInterval: NodeJS.Timeout | null = null;
let isBlinking = false;

// Переменные для таймера в main процессе
let timerInterval: NodeJS.Timeout | null = null;
let remainingSeconds: number = 0;
let isPaused: boolean = false;
let lastUpdateTime: number = 0;
let timerEndTime: number = 0; // Время когда таймер должен закончиться
let isRestoringSettings = false;

type PersistedTimer =
  | {
      secondsLeft: number;
      isPaused: true;
      savedAt: number;
    }
  | {
      secondsLeft: number;
      isPaused: false;
      timerEndTimestamp: number;
      savedAt: number;
    };

type PersistedSettings = {
  version: number;
  timer: PersistedTimer | null;
  countdownWindowVisible: boolean;
};

const SETTINGS_VERSION = 1;
const SETTINGS_FILE_NAME = 'settings.json';

function getSettingsPath(): string {
  const baseDir = app.isPackaged ? path.dirname(app.getPath('exe')) : app.getAppPath();
  return path.join(baseDir, SETTINGS_FILE_NAME);
}

function loadSettings(): PersistedSettings | null {
  try {
    const raw = fs.readFileSync(getSettingsPath(), 'utf8');
    const parsed = JSON.parse(raw) as PersistedSettings;
    if (!parsed || typeof parsed !== 'object') return null;
    if (typeof parsed.version !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

function saveSettings(): void {
  if (isRestoringSettings) return;

  const countdownWindowVisible = !!(countdownWindow && !countdownWindow.isDestroyed());

  let timer: PersistedTimer | null = null;
  if (timerInterval && remainingSeconds > 0) {
    if (isPaused) {
      timer = { secondsLeft: remainingSeconds, isPaused: true, savedAt: Date.now() };
    } else {
      timer = {
        secondsLeft: remainingSeconds,
        isPaused: false,
        timerEndTimestamp: timerEndTime,
        savedAt: Date.now(),
      };
    }
  }

  const settings: PersistedSettings = {
    version: SETTINGS_VERSION,
    timer,
    countdownWindowVisible,
  };

  try {
    fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings.json:', err);
  }
}

function restoreSettings(): void {
  const settings = loadSettings();
  if (!settings) return;

  isRestoringSettings = true;

  // На старте считаем, что "alerting" состояние не нужно восстанавливать.
  timerState.isAlerting = false;
  stopBlinking();

  try {
    if (settings.timer && settings.timer.secondsLeft > 0) {
      if (settings.timer.isPaused) {
        // startTimer создаёт таймер-interval, а мы потом переводим его в paused.
        startTimer(settings.timer.secondsLeft);
        isPaused = true;
        sendTimerUpdateToRenderer();
      } else {
        const now = Date.now();
        const endTs =
          typeof settings.timer.timerEndTimestamp === 'number'
            ? settings.timer.timerEndTimestamp
            : now + settings.timer.secondsLeft * 1000;
        const secondsLeft = Math.max(0, Math.floor((endTs - now) / 1000));
        if (secondsLeft > 0) {
          startTimer(secondsLeft);
        }
      }
    }

    if (settings.countdownWindowVisible) {
      createCountdownWindow();
    }
  } finally {
    isRestoringSettings = false;
    saveSettings();
  }
}

function formatTimeForCountdownWindow(seconds: number): string {
  if (seconds <= 0) return '—';
  if (seconds < 60) return '< 1м';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (hours > 0) parts.push(`${hours}ч`);
  parts.push(`${minutes}м`);
  return parts.join(' ');
}

function getCountdownText(): string {
  return formatTimeForCountdownWindow(remainingSeconds);
}

function updateCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    const text = getCountdownText();
    countdownWindow.webContents.send('countdown-update', text);
  }
}

function createCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    countdownWindow.show();
    countdownWindow.focus();
    countdownWindow.moveTop();
    updateCountdownWindow();
    sendCountdownWindowState();
    return;
  }

  const primaryDisplay = screen.getPrimaryDisplay();
  const { width: screenWidth, height: screenHeight } = primaryDisplay.workAreaSize;
  const { x: screenX, y: screenY } = primaryDisplay.workArea;

  const windowWidth = 280;
  const windowHeight = 70;
  const x = screenX + screenWidth - windowWidth;
  const y = screenY + screenHeight - windowHeight;

  countdownWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    transparent: true,
    resizable: false,
    show: false,
    skipTaskbar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  countdownWindow.loadFile(path.join(__dirname, 'countdown.html'));

  countdownWindow.once('ready-to-show', () => {
    if (countdownWindow) {
      updateCountdownWindow();
      countdownWindow.show();
      countdownWindow.focus();
      // На Linux окно может оказаться под другими или без фокуса
      countdownWindow.moveTop();
      if (process.platform === 'linux') {
        countdownWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
      }
      sendCountdownWindowState();
    }
  });

  countdownWindow.on('closed', () => {
    countdownWindow = null;
    sendCountdownWindowState();
  });
}

function destroyCountdownWindow(): void {
  if (countdownWindow) {
    countdownWindow.close();
    countdownWindow = null;
  }
  sendCountdownWindowState();
  saveSettings();
}

function toggleCountdownWindow(): void {
  if (countdownWindow && !countdownWindow.isDestroyed()) {
    destroyCountdownWindow();
  } else {
    createCountdownWindow();
    saveSettings();
  }
}

function sendCountdownWindowState(): void {
  const visible = !!(countdownWindow && !countdownWindow.isDestroyed());
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('countdown-window-state', visible);
  }
}

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
      click: async () => {
        const result = await dialog.showMessageBox(mainWindow || null as any, {
          type: 'question',
          buttons: ['Отмена', 'Закрыть'],
          defaultId: 0,
          cancelId: 0,
          title: 'Подтверждение',
          message: 'Вы уверены, что хотите закрыть приложение?'
        });

        if (result.response === 1) {
          app.isQuitting = true;
          app.quit();
        }
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
  } else {
    // Всегда используем фиолетовый фон (активный таймер и неактивный)
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
  if (seconds < 60) return `${seconds}s`;
  
  const mins = Math.floor(seconds / 60);
  if (mins < 60) {
    return `${mins}m`;
  }
  
  // Для больших значений показываем в часах с одной десятичной цифрой
  const hours = seconds / 3600;
  return `${hours.toFixed(1)}h`;
}

function formatTimeForTooltip(seconds: number): string {
  if (seconds <= 0) return '0s';
  
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  
  const parts: string[] = [];
  if (hours > 0) {
    parts.push(`${hours}h`);
  }
  if (minutes > 0) {
    parts.push(`${minutes}m`);
  }
  if (secs > 0 || parts.length === 0) {
    parts.push(`${secs}s`);
  }
  
  return parts.join(' ');
}

function updateTrayIcon(): void {
  if (!tray) return;
  
  let icon: Electron.NativeImage;
  let tooltipText: string;
  
  if (timerState.isAlerting) {
    // Мигание: красная иконка
    icon = createTextIcon('!', isBlinking);
    tooltipText = '⏰ Время истекло!';
  } else if (timerState.isPaused && timerState.seconds > 0) {
    // Таймер на паузе - показываем "p"
    icon = createTextIcon('p', false);
    tooltipText = `Таймер на паузе: ${formatTimeForTooltip(timerState.seconds)}`;
  } else if (timerState.isRunning && timerState.seconds > 0) {
    // Показываем оставшиеся секунды
    const text = formatTimeForTray(timerState.seconds);
    icon = createTextIcon(text, false);
    tooltipText = `Таймер: ${formatTimeForTooltip(timerState.seconds)}`;
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

function sendTimerUpdateToRenderer(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('timer-update', {
      seconds: remainingSeconds,
      isRunning: timerInterval !== null && !isPaused,
      isPaused: isPaused && timerInterval !== null
    });
  }
  
  // Обновляем состояние для трея
  timerState = {
    seconds: remainingSeconds,
    isRunning: timerInterval !== null && !isPaused,
    isAlerting: timerState.isAlerting,
    isPaused: isPaused && timerInterval !== null
  };

  updateTrayIcon();
  updateCountdownWindow();
}

function startTimer(seconds: number): void {
  if (timerInterval) {
    clearInterval(timerInterval);
  }
  
  remainingSeconds = seconds;
  isPaused = false;
  lastUpdateTime = Date.now();
  timerEndTime = lastUpdateTime + (seconds * 1000);
  
  timerInterval = setInterval(() => {
    if (!isPaused) {
      const currentTime = Date.now();
      const elapsedMs = currentTime - lastUpdateTime;
      const elapsedSeconds = Math.floor(elapsedMs / 1000);
      
      if (elapsedSeconds > 0) {
        remainingSeconds = Math.max(0, Math.floor((timerEndTime - currentTime) / 1000));
        lastUpdateTime = currentTime;
        
        sendTimerUpdateToRenderer();
        
        if (remainingSeconds <= 0) {
          stopTimer();
          // Отправляем сигнал о завершении таймера
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('timer-finished');
          }
        }
      }
    }
  }, 100); // Проверяем каждые 100мс для точности
  
  sendTimerUpdateToRenderer();
  saveSettings();
}

function pauseResumeTimer(): void {
  if (!timerInterval) return;
  
  if (isPaused) {
    // Возобновляем - пересчитываем timerEndTime
    const currentTime = Date.now();
    timerEndTime = currentTime + (remainingSeconds * 1000);
    lastUpdateTime = currentTime;
  }
  
  isPaused = !isPaused;
  sendTimerUpdateToRenderer();
  saveSettings();
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  
  remainingSeconds = 0;
  isPaused = false;
  lastUpdateTime = 0;
  timerEndTime = 0;
  
  sendTimerUpdateToRenderer();
  saveSettings();
}

function adjustTimerTime(seconds: number): void {
  if (!timerInterval) return;
  
  // Если таймер работает, обновляем оставшееся время
  if (!isPaused) {
    const currentTime = Date.now();
    remainingSeconds = Math.max(0, Math.floor((timerEndTime - currentTime) / 1000));
    lastUpdateTime = currentTime;
  }
  
  remainingSeconds += seconds;
  
  // Не позволяем времени стать отрицательным
  if (remainingSeconds < 0) {
    remainingSeconds = 0;
  }
  
  // Обновляем timerEndTime
  const currentTime = Date.now();
  timerEndTime = currentTime + (remainingSeconds * 1000);
  lastUpdateTime = currentTime;
  
  sendTimerUpdateToRenderer();
  saveSettings();
}

function createAppIcon(): Electron.NativeImage {
  const size = 256; // Большой размер для иконки приложения
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext('2d');
  
  // Градиентный фон (фиолетовый)
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, '#667eea');
  gradient.addColorStop(1, '#764ba2');
  
  // Рисуем закругленный прямоугольник
  const radius = size * 0.15;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(radius, 0);
  ctx.lineTo(size - radius, 0);
  ctx.quadraticCurveTo(size, 0, size, radius);
  ctx.lineTo(size, size - radius);
  ctx.quadraticCurveTo(size, size, size - radius, size);
  ctx.lineTo(radius, size);
  ctx.quadraticCurveTo(0, size, 0, size - radius);
  ctx.lineTo(0, radius);
  ctx.quadraticCurveTo(0, 0, radius, 0);
  ctx.closePath();
  ctx.fill();
  
  // Рисуем иконку таймера (часы)
  ctx.strokeStyle = '#FFFFFF';
  ctx.fillStyle = '#FFFFFF';
  ctx.lineWidth = size * 0.03;
  
  // Циферблат
  const centerX = size / 2;
  const centerY = size / 2;
  const clockRadius = size * 0.3;
  
  ctx.beginPath();
  ctx.arc(centerX, centerY, clockRadius, 0, 2 * Math.PI);
  ctx.stroke();
  
  // Стрелки часов (показывают 12:00)
  const hourLength = clockRadius * 0.5;
  const minuteLength = clockRadius * 0.7;
  
  // Часовая стрелка (12)
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(centerX, centerY - hourLength);
  ctx.lineWidth = size * 0.04;
  ctx.stroke();
  
  // Минутная стрелка (12)
  ctx.beginPath();
  ctx.moveTo(centerX, centerY);
  ctx.lineTo(centerX, centerY - minuteLength);
  ctx.lineWidth = size * 0.025;
  ctx.stroke();
  
  // Центральная точка
  ctx.beginPath();
  ctx.arc(centerX, centerY, size * 0.02, 0, 2 * Math.PI);
  ctx.fill();
  
  // Конвертируем canvas в buffer
  const buffer = canvas.toBuffer('image/png');
  return nativeImage.createFromBuffer(buffer);
}

function createWindow(): void {
  const appIcon = createAppIcon();
  
  // Получаем основной монитор
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;
  const { x, y } = primaryDisplay.workArea;
  
  // Вычисляем позицию для центрирования окна на основном мониторе
  const windowWidth = 800;
  const windowHeight = 900;
  const windowX = x + Math.floor((width - windowWidth) / 2);
  const windowY = y + Math.floor((height - windowHeight) / 2);
  
  mainWindow = new BrowserWindow({
    width: windowWidth,
    height: windowHeight,
    x: windowX,
    y: windowY,
    icon: appIcon,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
    show: false, // Всегда запускаем приложение свернутым
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));

  // Скрываем окно после загрузки
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.hide();
    }
  });

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

// Функция инициализации приложения
function initializeApp(): void {
  createWindow();
  createTray();

  // Восстанавливаем состояние из settings.json.
  // Важно: делаем это после createTray/createWindow, чтобы старт таймера мог обновить UI/трей.
  restoreSettings();

  // Обработчик обновлений состояния таймера (для обратной совместимости с уведомлениями)
  ipcMain.on('timer-state-update', (_event, state: { seconds: number; isRunning: boolean; isAlerting: boolean; isPaused?: boolean }) => {
    timerState.isAlerting = state.isAlerting;
    
    if (state.isAlerting) {
      startBlinking();
    } else {
      stopBlinking();
    }
    
    updateTrayIcon();
  });

  // Обработчики команд таймера от renderer
  ipcMain.on('timer-start', (_event, seconds: number) => {
    startTimer(seconds);
  });

  ipcMain.on('timer-stop', () => {
    stopTimer();
  });

  ipcMain.on('timer-pause-resume', () => {
    pauseResumeTimer();
  });

  ipcMain.on('timer-adjust', (_event, seconds: number) => {
    adjustTimerTime(seconds);
  });

  // Окно отсчёта времени
  ipcMain.on('countdown-window-toggle', () => {
    toggleCountdownWindow();
  });
  ipcMain.on('countdown-window-close', () => {
    destroyCountdownWindow();
  });

  // Обработчик сворачивания окна в трей
  ipcMain.on('minimize-window', () => {
    if (mainWindow) {
      mainWindow.hide();
      updateTrayMenu();
    }
  });

  // Обработчик эмуляции клика по иконке трея (для тестов)
  ipcMain.on('tray-click', () => {
    if (tray && mainWindow) {
      // Эмулируем клик по трею - вызываем ту же логику, что и при реальном клике
      if (mainWindow.isVisible()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
      updateTrayMenu();
    }
  });

  // Обработчик закрытия приложения
  ipcMain.on('close-app', () => {
    app.isQuitting = true;
    app.quit();
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// Обеспечиваем, что только один экземпляр приложения может быть запущен (если включено)
if (ALLOW_ONLY_ONE_INSTANCE) {
  const gotTheLock = app.requestSingleInstanceLock();

  if (!gotTheLock) {
    // Если другой экземпляр уже запущен, закрываем этот
    app.quit();
  } else {
    // Обрабатываем попытку запуска второго экземпляра
    app.on('second-instance', () => {
      // Если пользователь пытается запустить второй экземпляр, показываем существующее окно
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
      }
    });

    app.whenReady().then(() => {
      initializeApp();
    });
  }
} else {
  // Если разрешено несколько экземпляров, запускаем приложение без проверки блокировки
  app.whenReady().then(() => {
    initializeApp();
  });
}

app.on('window-all-closed', () => {
  // Не закрываем приложение при закрытии всех окон
  // Оно будет работать в tray
});

app.on('before-quit', () => {
  app.isQuitting = true;
  saveSettings();
});

