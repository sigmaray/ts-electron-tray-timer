let timerInterval: NodeJS.Timeout | null = null;
let remainingSeconds: number = 0;
let audioContext: AudioContext | null = null;
let audioInterval: NodeJS.Timeout | null = null;
let notification: Notification | null = null;

// Типы для electronAPI
interface ElectronAPI {
  updateTimerState: (state: { seconds: number; isRunning: boolean; isAlerting: boolean }) => void;
}

function sendTimerUpdate(): void {
  const electronAPI = (window as any).electronAPI as ElectronAPI | undefined;
  if (electronAPI) {
    electronAPI.updateTimerState({
      seconds: remainingSeconds,
      isRunning: timerInterval !== null,
      isAlerting: notification !== null
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

function startTimer(): void {
  const input = document.getElementById('secondsInput') as HTMLInputElement;
  if (!input) return;

  const seconds = parseInt(input.value, 10);

  if (isNaN(seconds) || seconds < 1) {
    const status = document.getElementById('status');
    if (status) {
      status.textContent = 'Введите корректное время!';
    }
    return;
  }

  remainingSeconds = seconds;
  updateDisplay();

  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const status = document.getElementById('status');

  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  input.disabled = true;
  if (status) status.textContent = 'Таймер запущен...';

  sendTimerUpdate();

  timerInterval = setInterval(() => {
    remainingSeconds--;
    updateDisplay();
    sendTimerUpdate();

    if (remainingSeconds <= 0) {
      stopTimer();
      showNotification();
      playAlarmSound();
      sendTimerUpdate();
    }
  }, 1000);
}

function stopTimer(): void {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }

  remainingSeconds = 0;
  updateDisplay();

  const startBtn = document.getElementById('startBtn') as HTMLButtonElement;
  const stopBtn = document.getElementById('stopBtn') as HTMLButtonElement;
  const input = document.getElementById('secondsInput') as HTMLInputElement;
  const status = document.getElementById('status');

  if (startBtn) startBtn.disabled = false;
  if (stopBtn) stopBtn.disabled = true;
  if (input) input.disabled = false;
  if (status) status.textContent = 'Таймер остановлен';

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
  const dismissBtn = document.getElementById('dismissAlertBtn');

  if (startBtn) {
    startBtn.addEventListener('click', startTimer);
  }

  if (stopBtn) {
    stopBtn.addEventListener('click', stopTimer);
  }

  if (dismissBtn) {
    dismissBtn.addEventListener('click', dismissNotification);
  }
});

// Экспортируем функции для глобального доступа (на случай если нужно)
(window as any).startTimer = startTimer;
(window as any).stopTimer = stopTimer;

