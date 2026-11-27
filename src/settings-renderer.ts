/** Saved preferences for completion notifications and alarm sound.
 */
type AlertSettings = {
  notificationMode: "window" | "system" | "both";
  alarmSoundEnabled: boolean;
  alarmSound: "classic" | "digital" | "gentle";
};

let previewContext: AudioContext | null = null;
let previewInterval: number | null = null;

/** Plays the selected alarm pattern briefly for preview.
 * @param sound The sound pattern selected in the settings window.
 */
function previewSound(sound: AlertSettings["alarmSound"]): void {
  if (previewInterval !== null) window.clearInterval(previewInterval);
  if (previewContext) void previewContext.close();
  previewContext = new AudioContext();
  const context = previewContext;
  const tone = {
    classic: {
      frequency: 800,
      type: "sine" as OscillatorType,
      duration: 0.5,
      repeat: 600,
    },
    digital: {
      frequency: 1100,
      type: "square" as OscillatorType,
      duration: 0.18,
      repeat: 360,
    },
    gentle: {
      frequency: 520,
      type: "sine" as OscillatorType,
      duration: 0.8,
      repeat: 1100,
    },
  }[sound];

  /** Plays one note of the selected preview pattern.
   */
  function playNote(): void {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.connect(gain);
    gain.connect(context.destination);
    oscillator.frequency.value = tone.frequency;
    oscillator.type = tone.type;
    gain.gain.setValueAtTime(0.25, context.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.01,
      context.currentTime + tone.duration,
    );
    oscillator.start();
    oscillator.stop(context.currentTime + tone.duration);
  }

  playNote();
  previewInterval = window.setInterval(playNote, tone.repeat);
  window.setTimeout(() => {
    if (previewInterval !== null) window.clearInterval(previewInterval);
    previewInterval = null;
    void context.close();
    if (previewContext === context) previewContext = null;
  }, 2500);
}

/** Initializes the settings controls and persists every changed preference.
 */
async function initializeSettingsWindow(): Promise<void> {
  const api = window.electronAPI;
  const status = document.getElementById("settingsStatus");
  if (!api) return;

  const settings = await api.getUiSettings().catch(() => ({
    advancedControlsVisible: false,
    instructionsVisible: false,
    notificationMode: "window" as const,
    alarmSoundEnabled: true,
    alarmSound: "classic" as const,
  }));
  const notificationMode = document.querySelector<HTMLInputElement>(
    `input[name="notificationMode"][value="${settings.notificationMode}"]`,
  );
  const soundEnabled = document.querySelector<HTMLInputElement>(
    `input[name="alarmSoundEnabled"][value="${settings.alarmSoundEnabled ? "yes" : "no"}"]`,
  );
  if (notificationMode) notificationMode.checked = true;
  if (soundEnabled) soundEnabled.checked = true;
  const soundOptions = document.getElementById("alarmSoundOptions");
  if (soundOptions) soundOptions.hidden = !settings.alarmSoundEnabled;
  const soundSelect = document.getElementById(
    "alarmSound",
  ) as HTMLSelectElement;
  soundSelect.value = settings.alarmSound;

  /** Saves a partial preference update and reflects its status in the window.
   * @param update The preference values changed by the user.
   */
  function save(update: {
    notificationMode?: AlertSettings["notificationMode"];
    alarmSoundEnabled?: boolean;
    alarmSound?: AlertSettings["alarmSound"];
  }): void {
    api!.setUiSettings(update);
    if (status) status.textContent = "Settings are saved automatically.";
  }

  document
    .querySelectorAll<HTMLInputElement>('input[name="notificationMode"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked)
          save({
            notificationMode: input.value as AlertSettings["notificationMode"],
          });
      });
    });
  document
    .querySelectorAll<HTMLInputElement>('input[name="alarmSoundEnabled"]')
    .forEach((input) => {
      input.addEventListener("change", () => {
        if (input.checked) {
          const enabled = input.value === "yes";
          if (soundOptions) soundOptions.hidden = !enabled;
          save({ alarmSoundEnabled: enabled });
        }
      });
    });
  soundSelect.addEventListener("change", () => {
    save({ alarmSound: soundSelect.value as AlertSettings["alarmSound"] });
  });
  document.getElementById("soundTestBtn")?.addEventListener("click", () => {
    previewSound(soundSelect.value as AlertSettings["alarmSound"]);
  });
  document.getElementById("settingsClose")?.addEventListener("click", () => {
    window.close();
  });
}

document.addEventListener("DOMContentLoaded", () => {
  void initializeSettingsWindow();
});
