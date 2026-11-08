import { parseDurationInput } from "./time.js";

let remainingSeconds: number = 0;
let audioContext: AudioContext | null = null;
let audioInterval: NodeJS.Timeout | null = null;
let notification: Notification | null = null;
let isPaused: boolean = false;
let isRunning: boolean = false;
let timerDurationSeconds = 0;

function formatDurationLabel(seconds: number): string {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const remaining = safeSeconds % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (remaining || parts.length === 0) parts.push(`${remaining}s`);
  return parts.join(" ");
}

function setStatus(
  message: string,
  state: "running" | "paused" | "stopped" | "error" | "neutral",
): void {
  const status = document.getElementById("status");
  if (!status) return;
  status.textContent = message;
  status.dataset.state = state;
}

function sendTimerUpdate(): void {
  const electronAPI = window.electronAPI;
  if (electronAPI) {
    electronAPI.updateTimerState({
      seconds: remainingSeconds,
      isRunning: isRunning,
      isAlerting: notification !== null,
      isPaused: isPaused,
    });
  }
}

function formatTime(seconds: number): { main: string; secondary: string } {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const totalMins = Math.floor(seconds / 60);

  // Формируем строку с часами, минутами и секундами
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

  const main = parts.join(" ");
  const secondary = `(${String(totalMins).padStart(2, "0")}:${String(secs).padStart(2, "0")})`;

  return { main, secondary };
}

function updateDisplay(): void {
  const display = document.getElementById("timerDisplay");
  if (display) {
    const formatted = formatTime(remainingSeconds);
    display.innerHTML = `<div class="timer-display-main">${formatted.main}</div><div class="timer-display-secondary">${formatted.secondary}</div>`;
  }
}

function adjustTime(seconds: number): void {
  // Кнопки работают только если таймер запущен (включая паузу)
  if (!isRunning && !isPaused) return;

  const electronAPI = window.electronAPI;
  if (electronAPI) {
    electronAPI.adjustTimerTime(seconds);
  }
}

function updateTimeAdjustButtons(): void {
  // Кнопки активны только если таймер запущен (включая паузу)
  const isActive = isRunning || isPaused;

  const buttons = [
    "adjustMinus1h",
    "adjustMinus10m",
    "adjustMinus5m",
    "adjustMinus1m",
    "adjustPlus1m",
    "adjustPlus5m",
    "adjustPlus10m",
    "adjustPlus1h",
  ];

  buttons.forEach((buttonId) => {
    const button = document.getElementById(buttonId) as HTMLButtonElement;
    if (button) {
      button.disabled = !isActive;
    }
  });

  // Обновляем состояние кнопок изменения input
  updateInputAdjustButtons();
}

function adjustInputTime(seconds: number): void {
  // Кнопки работают только если таймер НЕ запущен
  if (isRunning || isPaused) return;

  const input = document.getElementById("secondsInput") as HTMLInputElement;
  if (!input) return;

  const currentValue = input.value.trim();
  const currentSeconds = parseDurationInput(currentValue);

  if (currentSeconds === null) {
    // Если не удалось распарсить, устанавливаем минимальное значение
    if (seconds > 0) {
      input.value = formatTimeInput(seconds);
    }
    return;
  }

  const newSeconds = currentSeconds + seconds;

  // Не позволяем времени стать отрицательным
  if (newSeconds < 0) {
    return;
  }

  input.value = formatTimeInput(newSeconds);
}

function formatTimeInput(seconds: number): string {
  if (seconds <= 0) {
    return "1s"; // Минимальное значение
  }
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const remainingSeconds = seconds % 3600;
    if (remainingSeconds === 0) {
      return `${hours}h`;
    } else {
      const minutes = Math.floor(remainingSeconds / 60);
      if (minutes === 0) {
        return `${hours}h`;
      } else {
        return `${hours}h ${minutes}m`;
      }
    }
  }
}

function updateInputAdjustButtons(): void {
  // Кнопки активны только если таймер НЕ запущен
  const isActive = !isRunning && !isPaused;

  const buttons = [
    "inputAdjustMinus10m",
    "inputAdjustMinus5m",
    "inputAdjustMinus1m",
    "inputAdjustPlus1m",
    "inputAdjustPlus5m",
    "inputAdjustPlus10m",
  ];

  buttons.forEach((buttonId) => {
    const button = document.getElementById(buttonId) as HTMLButtonElement;
    if (button) {
      button.disabled = !isActive;
    }
  });

  // Обновляем состояние quick-links
  updateQuickLinks();
}

function updateQuickLinks(): void {
  // Ссылки активны только если таймер НЕ запущен
  const isActive = !isRunning && !isPaused;

  const quickLinks = document.querySelectorAll(".quick-link");
  quickLinks.forEach((link) => {
    const linkElement = link as HTMLElement;
    if (isActive) {
      linkElement.style.opacity = "1";
      linkElement.style.cursor = "pointer";
      linkElement.style.pointerEvents = "auto";
    } else {
      linkElement.style.opacity = "0.5";
      linkElement.style.cursor = "not-allowed";
      linkElement.style.pointerEvents = "none";
    }
  });
}

function startTimer(): void {
  const input = document.getElementById("secondsInput") as HTMLInputElement;
  if (!input) return;

  const seconds = parseDurationInput(input.value);

  if (seconds === null || seconds < 1) {
    setStatus("Enter a valid duration (for example: 500, 1m, 1h, 1d)", "error");
    return;
  }
  timerDurationSeconds = seconds;

  const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
  const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
  const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;

  if (startBtn) startBtn.disabled = true;
  if (stopBtn) stopBtn.disabled = false;
  if (pauseBtn) pauseBtn.disabled = false;
  input.disabled = true;
  setStatus("Timer started...", "running");

  // Отправляем команду в main процесс
  const electronAPI = window.electronAPI;
  if (electronAPI) {
    electronAPI.startTimer(seconds);
  }
}

function pauseResumeTimer(): void {
  if (!isRunning && !isPaused) return;

  const electronAPI = window.electronAPI;
  if (electronAPI) {
    electronAPI.pauseResumeTimer();
  }
}

function stopTimer(): void {
  const electronAPI = window.electronAPI;
  if (electronAPI) {
    electronAPI.stopTimer();
  }

  // UI обновится через слушатель onTimerUpdate

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

function showNotification(durationSeconds: number): void {
  const durationLabel = formatDurationLabel(durationSeconds);
  const notificationBody = `The ${durationLabel} timer has finished.`;
  // Запрашиваем разрешение на уведомления
  if (Notification.permission === "default") {
    void Notification.requestPermission().catch(() => {});
  }

  if (Notification.permission === "granted") {
    try {
      notification = new Notification("⏰ Time is up!", {
        body: notificationBody,
        requireInteraction: true,
        tag: "timer-alert",
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
      return;
    } catch {
      // Continue with the in-window fallback if the system notification API fails.
    }
  }

  // Если уведомления не разрешены, показываем alert
  alert(`⏰ The ${durationLabel} timer has finished!`);
  stopAlarmSound();
  // Создаем фиктивное уведомление для показа кнопки
  notification = {} as Notification;
  updateDismissButton();
  sendTimerUpdate();
}

function playAlarmSound(): void {
  // Создаем звуковой сигнал с помощью Web Audio API
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();

    function playBeep(): void {
      if (!audioContext) return;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Частота в Гц
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.5,
      );

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
    console.error("Error playing sound:", e);
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
  const dismissBtn = document.getElementById(
    "dismissAlertBtn",
  ) as HTMLButtonElement;
  if (dismissBtn) {
    dismissBtn.style.display = notification !== null ? "block" : "none";
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

  setStatus("Alert dismissed", "neutral");
}

// Инициализация при загрузке страницы
document.addEventListener("DOMContentLoaded", () => {
  setStatus("Timer is not set", "stopped");

  const advancedControlsToggle = document.getElementById(
    "advancedControlsToggle",
  ) as HTMLInputElement | null;
  const instructionsToggle = document.getElementById(
    "instructionsToggle",
  ) as HTMLInputElement | null;
  const advancedControls = document.getElementById("advancedControls");
  const timeAdjustDescription = document.getElementById(
    "timeAdjustDescription",
  );
  const instructions = document.getElementById("instructions");
  const applyVisibilitySettings = (settings: {
    advancedControlsVisible: boolean;
    instructionsVisible: boolean;
  }) => {
    if (advancedControlsToggle)
      advancedControlsToggle.checked = settings.advancedControlsVisible;
    if (instructionsToggle)
      instructionsToggle.checked = settings.instructionsVisible;
    if (advancedControls)
      advancedControls.hidden = !settings.advancedControlsVisible;
    if (timeAdjustDescription)
      timeAdjustDescription.hidden = !settings.instructionsVisible;
    if (instructions) instructions.hidden = !settings.instructionsVisible;
  };

  const settingsApi = window.electronAPI;
  if (settingsApi) {
    settingsApi
      .getUiSettings()
      .then(applyVisibilitySettings)
      .catch(() => {
        applyVisibilitySettings({
          advancedControlsVisible: false,
          instructionsVisible: false,
        });
      });
  }

  advancedControlsToggle?.addEventListener("change", () => {
    const enabled = advancedControlsToggle.checked;
    if (advancedControls) advancedControls.hidden = !enabled;
    settingsApi?.setUiSettings({ advancedControlsVisible: enabled });
  });
  instructionsToggle?.addEventListener("change", () => {
    const enabled = instructionsToggle.checked;
    if (instructions) instructions.hidden = !enabled;
    if (timeAdjustDescription) timeAdjustDescription.hidden = !enabled;
    settingsApi?.setUiSettings({ instructionsVisible: enabled });
  });

  // Запрашиваем разрешение на уведомления при загрузке
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Инициализируем состояние кнопок изменения времени
  updateTimeAdjustButtons();
  updateInputAdjustButtons();

  // Подключаем слушатели обновлений от main процесса
  const electronAPI = window.electronAPI;
  if (electronAPI) {
    // Слушаем обновления таймера
    const applyTimerState = (state: {
      seconds: number;
      isRunning: boolean;
      isPaused: boolean;
      durationSeconds: number;
    }) => {
      remainingSeconds = state.seconds;
      isRunning = state.isRunning;
      isPaused = state.isPaused;
      timerDurationSeconds = state.durationSeconds || timerDurationSeconds;

      updateDisplay();
      updateTimeAdjustButtons();

      // Обновляем UI кнопок
      const startBtn = document.getElementById("startBtn") as HTMLButtonElement;
      const stopBtn = document.getElementById("stopBtn") as HTMLButtonElement;
      const pauseBtn = document.getElementById("pauseBtn") as HTMLButtonElement;
      const input = document.getElementById("secondsInput") as HTMLInputElement;
      const status = document.getElementById("status");

      if (startBtn) startBtn.disabled = state.isRunning || state.isPaused;
      if (stopBtn) stopBtn.disabled = !state.isRunning && !state.isPaused;
      if (pauseBtn) {
        pauseBtn.disabled = !state.isRunning && !state.isPaused;
        pauseBtn.textContent = state.isPaused ? "Resume" : "Pause";
      }
      if (input) input.disabled = state.isRunning || state.isPaused;
      if (status) {
        setStatus(
          state.isPaused
            ? "Timer paused"
            : state.isRunning
              ? "Timer started..."
              : timerDurationSeconds > 0
                ? `Timer stopped (${formatDurationLabel(timerDurationSeconds)})`
                : "Timer is not set",
          state.isPaused ? "paused" : state.isRunning ? "running" : "stopped",
        );
      }

      // Обновляем состояние кнопок изменения input (включая quick-links)
      updateInputAdjustButtons();
    };
    electronAPI.onTimerUpdate(applyTimerState);
    // Subscribe first, then fetch a snapshot so startup restoration cannot be missed.
    electronAPI
      .getTimerState()
      .then(applyTimerState)
      .catch(() => {});

    const handleTimerFinished = (durationSeconds: number) => {
      if (Number.isFinite(durationSeconds) && durationSeconds > 0)
        timerDurationSeconds = durationSeconds;
      stopTimer();
      showNotification(timerDurationSeconds);
      playAlarmSound();
      setStatus(
        `Timer stopped (${formatDurationLabel(timerDurationSeconds)})`,
        "stopped",
      );
      sendTimerUpdate();
    };
    // Both a live completion and a missed completion on startup use the same UX.
    electronAPI.onTimerFinished(handleTimerFinished);
    electronAPI.onStartupTimerFinished(handleTimerFinished);

    // Состояние окна отсчёта времени
    electronAPI.onCountdownWindowState((visible: boolean) => {
      const btn = document.getElementById(
        "countdownWindowBtn",
      ) as HTMLButtonElement;
      if (btn) {
        btn.textContent = visible
          ? "Hide countdown window"
          : "Show countdown window";
      }
    });
  }

  // Обработка Enter в поле ввода
  const input = document.getElementById("secondsInput") as HTMLInputElement;
  if (input) {
    input.addEventListener("keypress", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        const startBtn = document.getElementById(
          "startBtn",
        ) as HTMLButtonElement;
        if (startBtn && !startBtn.disabled) {
          startTimer();
        }
      }
    });
  }

  // Подключаем обработчики кнопок
  const startBtn = document.getElementById("startBtn");
  const stopBtn = document.getElementById("stopBtn");
  const pauseBtn = document.getElementById("pauseBtn");
  const dismissBtn = document.getElementById("dismissAlertBtn");

  if (startBtn) {
    startBtn.addEventListener("click", startTimer);
  }

  if (stopBtn) {
    stopBtn.addEventListener("click", stopTimer);
  }

  if (pauseBtn) {
    pauseBtn.addEventListener("click", pauseResumeTimer);
  }

  if (dismissBtn) {
    dismissBtn.addEventListener("click", dismissNotification);
  }

  // Обработчики кнопок изменения времени
  const adjustButtons = [
    { id: "adjustMinus1h", seconds: -3600 },
    { id: "adjustMinus10m", seconds: -600 },
    { id: "adjustMinus5m", seconds: -300 },
    { id: "adjustMinus1m", seconds: -60 },
    { id: "adjustPlus1m", seconds: 60 },
    { id: "adjustPlus5m", seconds: 300 },
    { id: "adjustPlus10m", seconds: 600 },
    { id: "adjustPlus1h", seconds: 3600 },
  ];

  adjustButtons.forEach(({ id, seconds }) => {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener("click", () => adjustTime(seconds));
    }
  });

  // Обработчики кнопок изменения времени в input
  const inputAdjustButtons = [
    { id: "inputAdjustMinus10m", seconds: -600 },
    { id: "inputAdjustMinus5m", seconds: -300 },
    { id: "inputAdjustMinus1m", seconds: -60 },
    { id: "inputAdjustPlus1m", seconds: 60 },
    { id: "inputAdjustPlus5m", seconds: 300 },
    { id: "inputAdjustPlus10m", seconds: 600 },
  ];

  inputAdjustButtons.forEach(({ id, seconds }) => {
    const button = document.getElementById(id);
    if (button) {
      button.addEventListener("click", () => adjustInputTime(seconds));
    }
  });

  // Обработчики быстрых ссылок
  const quickLinks = document.querySelectorAll(".quick-link");
  quickLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      // Не работаем если таймер запущен или на паузе
      if (isRunning || isPaused) {
        return;
      }
      const timeValue = (link as HTMLElement).getAttribute("data-time");
      if (timeValue) {
        const input = document.getElementById(
          "secondsInput",
        ) as HTMLInputElement;
        if (input) {
          input.value = timeValue;
        }
      }
    });
  });

  // Обновляем состояние quick-links при инициализации
  updateQuickLinks();

  // Обработчики кнопок управления приложением
  const minimizeBtn = document.getElementById("minimizeBtn");
  const closeBtn = document.getElementById("closeBtn");
  const countdownWindowBtn = document.getElementById("countdownWindowBtn");

  if (minimizeBtn) {
    minimizeBtn.addEventListener("click", () => {
      const electronAPI = window.electronAPI;
      if (electronAPI) {
        electronAPI.minimizeWindow();
      }
    });
  }

  if (closeBtn) {
    closeBtn.addEventListener("click", () => {
      const confirmed = confirm("Are you sure you want to quit the app?");
      if (confirmed) {
        const electronAPI = window.electronAPI;
        if (electronAPI) {
          electronAPI.closeApp();
        }
      }
    });
  }

  if (countdownWindowBtn) {
    countdownWindowBtn.addEventListener("click", () => {
      const api = window.electronAPI;
      if (api) api.toggleCountdownWindow();
    });
  }
});

// Экспортируем функции для глобального доступа (на случай если нужно)
window.startTimer = startTimer;
window.stopTimer = stopTimer;
