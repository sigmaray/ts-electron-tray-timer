/** Saved preferences for completion notifications and alarm sound.
 */
type AlertSettings = {
  confirmQuit: boolean;
  notificationMode: "window" | "system" | "both";
  alarmSoundEnabled: boolean;
  alarmSound: "classic" | "digital" | "gentle";
  countdownFormat: "compact" | "clock" | "seconds";
  countdownFontSize: number;
  countdownMenuButtonVisible: boolean;
  countdownBackgroundColor: string;
  trayIconColor: string;
  mainWindowBackgroundColor: string;
  sectionHeaderBackgroundColor: string;
  sectionBackgroundColor: string;
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

/** Initializes the settings controls and stages preference changes until applied.
 */
async function initializeSettingsWindow(): Promise<void> {
  const api = window.electronAPI;
  const status = document.getElementById("settingsStatus");
  if (!api) return;

  const settings = await api.getUiSettings().catch(() => ({
    confirmQuit: true,
    advancedControlsVisible: false,
    instructionsVisible: false,
    notificationMode: "window" as const,
    alarmSoundEnabled: true,
    alarmSound: "classic" as const,
    countdownFormat: "compact" as const,
    countdownFontSize: 15,
    countdownMenuButtonVisible: true,
    countdownBackgroundColor: "#5b7fa6",
    trayIconColor: "#5b7fa6",
    mainWindowBackgroundColor: "#f8f9fa",
    sectionHeaderBackgroundColor: "#0d6efd",
    sectionBackgroundColor: "#ffffff",
  }));
  const pending: Partial<AlertSettings> = {};
  const confirmQuit = document.getElementById(
    "confirmQuit",
  ) as HTMLInputElement;
  confirmQuit.checked = settings.confirmQuit;
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
  const countdownFormat = document.getElementById(
    "countdownFormat",
  ) as HTMLSelectElement;
  const countdownFontSize = document.getElementById(
    "countdownFontSize",
  ) as HTMLInputElement;
  const countdownFontSizeValue = document.getElementById(
    "countdownFontSizeValue",
  );
  const countdownMenuButtonVisible = document.getElementById(
    "countdownMenuButtonVisible",
  ) as HTMLInputElement;
  const countdownBackgroundColor = document.getElementById(
    "countdownBackgroundColor",
  ) as HTMLInputElement;
  countdownFormat.value = settings.countdownFormat;
  countdownFontSize.value = String(settings.countdownFontSize);
  if (countdownFontSizeValue)
    countdownFontSizeValue.textContent = `${settings.countdownFontSize} pt`;
  countdownMenuButtonVisible.checked = settings.countdownMenuButtonVisible;
  countdownBackgroundColor.value = settings.countdownBackgroundColor;
  const colorPairs = [
    ["trayIconColor", "trayIconColorHex"],
    ["countdownBackgroundColor", "countdownBackgroundColorHex"],
    ["mainWindowBackgroundColor", "mainWindowBackgroundColorHex"],
    ["sectionHeaderBackgroundColor", "sectionHeaderBackgroundColorHex"],
    ["sectionBackgroundColor", "sectionBackgroundColorHex"],
  ] as const;
  for (const [pickerId, hexId] of colorPairs) {
    const picker = document.getElementById(pickerId) as HTMLInputElement;
    const hex = document.getElementById(hexId) as HTMLInputElement;
    picker.value = settings[pickerId];
    hex.value = picker.value;
    picker.addEventListener("input", () => {
      hex.value = picker.value;
      hex.setCustomValidity("");
      save({ [pickerId]: picker.value } as Partial<AlertSettings>);
    });
    hex.addEventListener("input", () => {
      const value = hex.value.trim();
      if (/^#[0-9a-fA-F]{6}$/.test(value)) {
        picker.value = value.toLowerCase();
        hex.setCustomValidity("");
        save({ [pickerId]: picker.value } as Partial<AlertSettings>);
      } else hex.setCustomValidity("Enter a color in #RRGGBB format.");
    });
    hex.addEventListener("blur", () => {
      if (/^#[0-9a-fA-F]{6}$/.test(hex.value.trim())) hex.value = picker.value;
    });
  }

  /** Stages a partial preference update and reflects its status in the window.
   * @param update The preference values changed by the user.
   */
  function save(update: {
    notificationMode?: AlertSettings["notificationMode"];
    confirmQuit?: boolean;
    alarmSoundEnabled?: boolean;
    alarmSound?: AlertSettings["alarmSound"];
    countdownFormat?: AlertSettings["countdownFormat"];
    countdownFontSize?: number;
    countdownMenuButtonVisible?: boolean;
    countdownBackgroundColor?: string;
    trayIconColor?: string;
    mainWindowBackgroundColor?: string;
    sectionHeaderBackgroundColor?: string;
    sectionBackgroundColor?: string;
  }): void {
    Object.assign(pending, update);
    if (status) status.textContent = "Unsaved changes.";
  }

  /** Applies staged preferences, reporting invalid colors before saving.
   * @param closeAfterSave Whether to close the settings window after saving.
   */
  function applySettings(closeAfterSave: boolean): void {
    const invalidHex = colorPairs
      .map(([, hexId]) => document.getElementById(hexId) as HTMLInputElement)
      .find((hex) => !/^#[0-9a-fA-F]{6}$/.test(hex.value.trim()));
    if (invalidHex) {
      invalidHex.setCustomValidity("Enter a color in #RRGGBB format.");
      invalidHex.reportValidity();
      invalidHex.focus();
      return;
    }
    if (Object.keys(pending).length) api!.setUiSettings(pending);
    if (status) status.textContent = "Settings applied.";
    if (closeAfterSave) window.close();
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
  confirmQuit.addEventListener("change", () =>
    save({ confirmQuit: confirmQuit.checked }),
  );
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
  countdownFormat.addEventListener("change", () => {
    save({
      countdownFormat:
        countdownFormat.value as AlertSettings["countdownFormat"],
    });
  });
  countdownFontSize.addEventListener("input", () => {
    if (countdownFontSizeValue)
      countdownFontSizeValue.textContent = `${countdownFontSize.value} pt`;
  });
  countdownFontSize.addEventListener("change", () => {
    save({ countdownFontSize: Number(countdownFontSize.value) });
  });
  countdownMenuButtonVisible.addEventListener("change", () => {
    save({ countdownMenuButtonVisible: countdownMenuButtonVisible.checked });
  });
  document.getElementById("resetColors")?.addEventListener("click", () => {
    const defaults = ["#5b7fa6", "#5b7fa6", "#f8f9fa", "#0d6efd", "#ffffff"];
    colorPairs.forEach(([pickerId, hexId], index) => {
      const picker = document.getElementById(pickerId) as HTMLInputElement;
      const hex = document.getElementById(hexId) as HTMLInputElement;
      picker.value = defaults[index];
      hex.value = defaults[index];
      hex.setCustomValidity("");
      save({ [pickerId]: defaults[index] } as Partial<AlertSettings>);
    });
  });
  document.getElementById("soundTestBtn")?.addEventListener("click", () => {
    previewSound(soundSelect.value as AlertSettings["alarmSound"]);
  });
  document.getElementById("settingsClose")?.addEventListener("click", () => {
    window.close();
  });
  document
    .getElementById("settingsApply")
    ?.addEventListener("click", () => applySettings(false));
  document
    .getElementById("settingsSave")
    ?.addEventListener("click", () => applySettings(true));
}

document.addEventListener("DOMContentLoaded", () => {
  void initializeSettingsWindow();
});
