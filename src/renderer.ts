let timerInterval: NodeJS.Timeout | null = null;
let remainingSeconds: number = 0;
let audioContext: AudioContext | null = null;
let audioInterval: NodeJS.Timeout | null = null;
let notification: Notification | null = null;
let isPaused: boolean = false;

// Типы для electronAPI
interface ElectronAPI {
  updateTimerState: (state: { seconds: number; isRunning: boolean; isAlerting: boolean; isPaused?: boolean }) => void;
  minimizeWindow: () => void;
  closeApp: () => void;
}

function sendTimerUpdate(): void {
  const electronAPI = (window as any).electronAPI as ElectronAPI | undefined;
  if (electronAPI) {
    electronAPI.updateTimerState({
      seconds: remainingSeconds,
      isRunning: timerInterval !== null && !isPaused,
      isAlerting: notification !== null,
      isPaused: isPaused && timerInterval !== null
    });
  }
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function updateDisplay(): void {
  const display = document.getElementById('timerDisplay');
  if (display) {
    display.textContent = formatTime(remainingSeconds);
  }
}

function adjustTime(seconds: number): void {
  // Кнопки работают только если таймер запущен (включая паузу)
  if (!timerInterval) return;
  
  remainingSeconds += seconds;
  
  // Не позволяем времени стать отрицательным
  if (remainingSeconds < 0) {
    remainingSeconds = 0;
  }
  
  updateDisplay();
  sendTimerUpdate();
}

function updateTimeAdjustButtons(): void {
  // Кнопки активны только если таймер запущен (включая паузу)
  const isActive = timerInterval !== null;
  
  const buttons = [
    'adjustMinus1h', 'adjustMinus10m', 'adjustMinus5m', 'adjustMinus1m',
    'adjustPlus1m', 'adjustPlus5m', 'adjustPlus10m', 'adjustPlus1h'
  ];
  
  buttons.forEach(buttonId => {
    const button = document.getElementById(buttonId) as HTMLButtonElement;
    if (button) {
      button.disabled = !isActive;
    }
  });
}

function parseTimeInput(inputValue: string): number | null {
  const trimmed = inputValue.trim();
  if (!trimmed) return null;

  // Пробуем распарсить как число (секунды)
  const numberMatch = trimmed.match(/^(\d+)$/);
  if (numberMatch) {
    const seconds = parseInt(numberMatch[1], 10);
    return seconds > 0 ? seconds : null;
  }

  // Парсим форматы с суффиксами: 1m, 1h, 1d
  const timeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*([smhd])$/i);
  if (timeMatch) {
    const value = parseFloat(timeMatch[1]);
    const unit = timeMatch[2].toLowerCase();

    if (value <= 0 || isNaN(value)) return null;

    switch (unit) {
      case 's':
        return Math.floor(value);
      case 'm':
        return Math.floor(value * 60);
      case 'h':
        return Math.floor(value * 3600);
      case 'd':
        return Math.floor(value * 86400); // 24 * 60 * 60
      default:
        return null;
    }
  }

  return null;
}

function startTimer(): void {
  const input = document.getElementById('secondsInput') as HTMLInputElement;
  if (!input) return;

  const seconds = parseTimeInput(input.value);

  if (seconds === null || seconds < 1) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = 'Введите корректное время! (например: 500, 1m, 1h, 1d)';
    }
    return;
  }

  remainingSeconds = seconds;
  isPaused = false;
  updateDisplay();

  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const status = document.getElementById('status');

  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = false;
  input.disabled = true;
  if (status) status.textContent = 'Таймер запущен...';

  timerInterval = setInterval(() => {
    if (!isPaused) {
      remainingSeconds--;
      updateDisplay();
      sendTimerUpdate();

      if (remainingSeconds <= 0) {
        stopTimer();
        showNotification();
        playAlarmSound();
        sendTimerUpdate();
      }
    }
  }, 1000);

  // Обновляем иконку трея сразу после создания интервала
  sendTimerUpdate();
  // Обновляем состояние кнопок изменения времени после установки интервала
  updateTimeAdjustButtons();
}

function pauseResumeTimer(): void {
  if (!timerInterval) return;

  isPaused = !isPaused;

  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const status = document.getElementById('status');

  if (pauseBtn) {
    pauseBtn.textContent = isPaused ? 'Возобновить' : 'Пауза';
  }

  if (status) {
    status.textContent = isPaused ? 'Таймер на паузе' : 'Таймер запущен...';
  }

  updateTimeAdjustButtons();
  sendTimerUpdate();
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  remainingSeconds = 0;
  isPaused = false;
  updateDisplay();

  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const pauseBtn = document.getElementById('pauseBtn') as HTMLButtonElement;
  const input = document.getElementById('secondsInput') as HTMLInputElement;
  const status = document.getElementById('status');

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (pauseBtn) {
    pauseBtn.disabled = true;
    pauseBtn.textContent = 'Пауза';
  }
  if (input) input.disabled = false;
  if (status) status.textContent = 'Таймер остановлен';
  updateTimeAdjustButtons();

  // Останавливаем звук если он играет
  stopAlarmSound();
  // Закрываем уведомление если оно активно
  if (notification) {
    notification.close();
    notification = null;
  }
  updateDismissButton();
  sendTimerUpdate();
}

function showNotification(): void {
  // Запрашиваем разрешение на уведомления
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  if (Notification.permission === 'granted') {
    notification = new Notification('⏰ Время истекло!', {
      body: 'Таймер завершил отсчет.',
      requireInteraction: true,
      tag: 'timer-alert'
    });

    // Останавливаем звук когда уведомление закрыто
    notification.onclose = () => {
      stopAlarmSound();
      notification = null;
      updateDismissButton();
      sendTimerUpdate();
    };

    // Останавливаем звук при клике на уведомление
    notification.onclick = () => {
      stopAlarmSound();
      if (window.focus) window.focus();
      notification?.close();
      updateDismissButton();
      sendTimerUpdate();
    };
    
    updateDismissButton();
    sendTimerUpdate();
    updateDismissButton();
  } else {
    // Если уведомления не разрешены, показываем alert
    alert('⏰ Время истекло!');
    stopAlarmSound();
    // Создаем фиктивное уведомление для показа кнопки
    notification = {} as Notification;
    updateDismissButton();
    sendTimerUpdate();
  }
}

function playAlarmSound(): void {
  // Создаем звуковой сигнал с помощью Web Audio API
  try {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContext = new AudioContextClass();

    function playBeep(): void {
      if (!audioContext) return;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Частота в Гц
      oscillator.type = 'sine';

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    }

    // Играем звук каждые 0.6 секунды
    playBeep();
    audioInterval = setInterval(() => {
      if (audioContext && notification) {
        playBeep();
      } else {
        stopAlarmSound();
      }
    }, 600);
  } catch (e) {
    console.error('Ошибка воспроизведения звука:', e);
  }
}

function stopAlarmSound(): void {
  if (audioInterval) {
    clearInterval(audioInterval);
    audioInterval = null;
  }
  if (audioContext) {
    audioContext.close().catch(() => {
      // Игнорируем ошибки при закрытии
    });
    audioContext = null;
  }
}

function updateDismissButton(): void {
  const dismissBtn = document.getElementById('dismissAlertBtn') as HTMLButtonElement;
  if (dismissBtn) {
    dismissBtn.style.display = notification !== null ? 'block' : 'none';
  }
}

function dismissNotification(): void {
  if (notification) {
    notification.close();
    notification = null;
  }
  stopAlarmSound();
  updateDismissButton();
  sendTimerUpdate();
  
  const status = document.getElementById('status');
  if (status) {
    status.textContent = 'Уведомление отключено';
  }
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', () => {
  // Запрашиваем разрешение на уведомления при загрузке
  if (Notification.permission === 'default') {
    Notification.requestPermission();
  }

  // Инициализируем состояние кнопок изменения времени
  updateTimeAdjustButtons();

  // Обработка Enter в поле ввода
  const input = document.getElementById('secondsInput') as HTMLInputElement;
  if (input) {
    input.addEventListener('keypress', (e: KeyboardEvent) => {
      if (e.key === 'Enter') {
        const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
        if (startBtn && !startBtn.disabled) {
          startTimer();
        }
      }
    });
  }

  // Подключаем обработчики кнопок
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');
  const pauseBtn = document.getElementById('pauseBtn');
  const dismissBtn = document.getElementById('dismissAlertBtn');

  if (startBtn) {
    startBtn.addEventListener('click', startTimer);
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', stopTimer);
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', pauseResumeTimer);
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', dismissNotification);
  }

  // Обработчики кнопок изменения времени
  const adjustButtons = [
    { id: 'adjustMinus1h', seconds: -3600 },
    { id: 'adjustMinus10m', seconds: -600 },
    { id: 'adjustMinus5m', seconds: -300 },
    { id: 'adjustMinus1m', seconds: -60 },
    { id: 'adjustPlus1m', seconds: 60 },
    { id: 'adjustPlus5m', seconds: 300 },
    { id: 'adjustPlus10m', seconds: 600 },
    { id: 'adjustPlus1h', seconds: 3600 }
  ];

  adjustButtons.forEach(({ id, seconds }) => {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener('click', () => adjustTime(seconds));
    }
  });

  // Обработчики быстрых ссылок
  const quickLinks = document.querySelectorAll('.quick-link');
  quickLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const timeValue = (link as HTMLElement).getAttribute('data-time');
      if (timeValue) {
        const input = document.getElementById('secondsInput') as HTMLInputElement;
        if (input) {
          input.value = timeValue;
        }
      }
    });
  });

  // Обработчики кнопок управления приложением
  const minimizeBtn = document.getElementById('minimizeBtn');
  const closeBtn = document.getElementById('closeBtn');

  if (minimizeBtn) {
    minimizeBtn.addEventListener('click', () => {
      const electronAPI = (window as any).electronAPI as ElectronAPI | undefined;
      if (electronAPI) {
        electronAPI.minimizeWindow();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener('click', () => {
      const confirmed = confirm('Вы уверены, что хотите закрыть приложение?');
      if (confirmed) {
        const electronAPI = (window as any).electronAPI as ElectronAPI | undefined;
        if (electronAPI) {
          electronAPI.closeApp();
        }
      }
    });
  }
});

// Экспортируем функции для глобального доступа (на случай если нужно)
(window as any).startTimer = startTimer;
(window as any).stopTimer = stopTimer;

