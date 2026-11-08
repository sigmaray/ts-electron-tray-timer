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

  // Format the time as hours, minutes, and seconds.
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
  // These controls work only while a timer is active, including when paused.
  if (!isRunning && !isPaused) return;

  const electronAPI = window.electronAPI;
  if (electronAPI) {
    electronAPI.adjustTimerTime(seconds);
  }
}

function updateTimeAdjustButtons(): void {
  // Enable these controls only while a timer is active, including when paused.
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

  // Update the input adjustment buttons.
  updateInputAdjustButtons();
}

function adjustInputTime(seconds: number): void {
  // These controls work only while the timer is stopped.
  if (isRunning || isPaused) return;

  const input = document.getElementById("secondsInput") as HTMLInputElement;
  if (!input) return;

  const currentValue = input.value.trim();
  const currentSeconds = parseDurationInput(currentValue);

  if (currentSeconds === null) {
    // Use the minimum value when parsing fails.
    if (seconds > 0) {
      input.value = formatTimeInput(seconds);
    }
    return;
  }

  const newSeconds = currentSeconds + seconds;

  // Keep the time from becoming negative.
  if (newSeconds < 0) {
    return;
  }

  input.value = formatTimeInput(newSeconds);
}

function formatTimeInput(seconds: number): string {
  if (seconds <= 0) {
    return "1s"; // Minimum value.
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
  // Enable these buttons only while the timer is stopped.
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

  // Update the quick links.
  updateQuickLinks();
}

function updateQuickLinks(): void {
  // Enable links only while the timer is stopped.
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

  // Send the command to the main process.
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

  // The onTimerUpdate listener will refresh the UI.

  // Stop the alarm sound if it is playing.
  stopAlarmSound();
  // Close the notification if one is active.
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
  // Request permission to show notifications.
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

      // Stop the alarm when the notification is closed.
      notification.onclose = () => {
        stopAlarmSound();
        notification = null;
        updateDismissButton();
        sendTimerUpdate();
      };

      // Stop the alarm when the notification is clicked.
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

  // Show an alert if notifications are unavailable.
  alert(`⏰ The ${durationLabel} timer has finished!`);
  stopAlarmSound();
  // Use a placeholder notification to show the dismiss button.
  notification = {} as Notification;
  updateDismissButton();
  sendTimerUpdate();
}

function playAlarmSound(): void {
  // Play an alarm tone using the Web Audio API.
  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    audioContext = new AudioContextClass();

    function playBeep(): void {
      if (!audioContext) return;

      const oscillator = audioContext.createOscillator();
      const gainNode = audioContext.createGain();

      oscillator.connect(gainNode);
      gainNode.connect(audioContext.destination);

      oscillator.frequency.value = 800; // Frequency in hertz.
      oscillator.type = "sine";

      gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
      gainNode.gain.exponentialRampToValueAtTime(
        0.01,
        audioContext.currentTime + 0.5,
      );

      oscillator.start(audioContext.currentTime);
      oscillator.stop(audioContext.currentTime + 0.5);
    }

    // Play a tone every 0.6 seconds.
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
      // Ignore errors while closing.
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

// Initialize the page after it loads.
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

  // Request notification permission when the page loads.
  if (Notification.permission === "default") {
    Notification.requestPermission();
  }

  // Initialize the time-adjustment buttons.
  updateTimeAdjustButtons();
  updateInputAdjustButtons();

  // Subscribe to updates from the main process.
  const electronAPI = window.electronAPI;
  if (electronAPI) {
    // Listen for timer updates.
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

      // Update the button states.
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

      // Update the input adjustment buttons, including quick links.
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

    // Countdown window state.
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

  // Handle Enter in the input field.
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

  // Attach button handlers.
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

  // Time-adjustment button handlers.
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

  // Input time-adjustment button handlers.
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

  // Quick-link handlers.
  const quickLinks = document.querySelectorAll(".quick-link");
  quickLinks.forEach((link) => {
    link.addEventListener("click", (e) => {
      e.preventDefault();
      // Ignore changes while the timer is running or paused.
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

  // Initialize the quick-link state.
  updateQuickLinks();

  // App control button handlers.
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

// Expose functions globally for optional external access.
window.startTimer = startTimer;
window.stopTimer = stopTimer;
