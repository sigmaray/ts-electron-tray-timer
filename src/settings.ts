import { MAX_TIMER_SECONDS } from "./time";

/** Timer state persisted between application launches. */
export type PersistedTimer =
  | {
      secondsLeft: number;
      durationSeconds?: number;
      isPaused: true;
      savedAt: number;
    }
  | {
      secondsLeft: number;
      durationSeconds?: number;
      isPaused: false;
      timerEndTimestamp: number;
      savedAt: number;
    };

/** Versioned application preferences and optional in-progress timer state. */
export type PersistedSettings = {
  version: 1;
  timer: PersistedTimer | null;
  countdownWindowVisible: boolean;
  countdownWindowPosition?: CountdownWindowPosition;
  advancedControlsVisible?: boolean;
  instructionsVisible?: boolean;
  notificationMode?: "window" | "system" | "both";
  alarmSoundEnabled?: boolean;
  alarmSound?: "classic" | "digital" | "gentle";
  countdownFormat?: "compact" | "clock" | "seconds";
  countdownFontSize?: number;
  countdownMenuButtonVisible?: boolean;
  countdownBackgroundColor?: string;
};

/** Screen-space bounds of a display used to identify it after restart.
 */
export type CountdownDisplayBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Saved screen position and size of the floating countdown window.
 */
export type CountdownWindowPosition = {
  displayId: string;
  displayLabel?: string;
  displayBounds?: CountdownDisplayBounds;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Check whether an unknown JSON value is a non-null object record.
 * @param value The value to inspect.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Validate a non-negative integer that can be represented exactly.
 * @param value The value to validate.
 */
function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Validate saved screen bounds before using them for display matching.
 * @param value Untrusted display bounds from persisted settings.
 */
function parseDisplayBounds(
  value: unknown,
): CountdownDisplayBounds | undefined {
  if (
    !isRecord(value) ||
    !Number.isSafeInteger(value.x) ||
    !Number.isSafeInteger(value.y) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    Number(value.width) <= 0 ||
    Number(value.height) <= 0
  )
    return undefined;
  return {
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
  };
}

/** Parse a saved countdown position, returning undefined when invalid.
 * @param value Untrusted countdown window position from the settings file.
 */
function parseCountdownWindowPosition(
  value: unknown,
): CountdownWindowPosition | undefined {
  if (
    !isRecord(value) ||
    typeof value.displayId !== "string" ||
    value.displayId.length > 64 ||
    !Number.isSafeInteger(value.x) ||
    !Number.isSafeInteger(value.y) ||
    !Number.isSafeInteger(value.width) ||
    !Number.isSafeInteger(value.height) ||
    Number(value.width) < 100 ||
    Number(value.width) > 800 ||
    Number(value.height) < 30 ||
    Number(value.height) > 200
  )
    return undefined;
  return {
    displayId: value.displayId,
    ...(typeof value.displayLabel === "string" &&
    value.displayLabel.length <= 256
      ? { displayLabel: value.displayLabel }
      : {}),
    ...(parseDisplayBounds(value.displayBounds)
      ? { displayBounds: parseDisplayBounds(value.displayBounds) }
      : {}),
    x: Number(value.x),
    y: Number(value.y),
    width: Number(value.width),
    height: Number(value.height),
  };
}

/** Parse a persisted timer, returning undefined when its data is invalid.
 * @param value Untrusted timer data from the settings file.
 */
function parseTimer(value: unknown): PersistedTimer | null | undefined {
  if (value === null) return null;
  if (
    !isRecord(value) ||
    !isNonNegativeSafeInteger(value.secondsLeft) ||
    value.secondsLeft === 0 ||
    value.secondsLeft > MAX_TIMER_SECONDS
  )
    return undefined;
  if (typeof value.savedAt !== "number" || !Number.isFinite(value.savedAt))
    return undefined;
  if (
    value.durationSeconds !== undefined &&
    (!isNonNegativeSafeInteger(value.durationSeconds) ||
      value.durationSeconds > MAX_TIMER_SECONDS)
  )
    return undefined;

  if (value.isPaused === true) {
    return {
      secondsLeft: value.secondsLeft,
      ...(typeof value.durationSeconds === "number"
        ? { durationSeconds: value.durationSeconds }
        : {}),
      isPaused: true,
      savedAt: value.savedAt as number,
    };
  }

  if (
    value.isPaused === false &&
    typeof value.timerEndTimestamp === "number" &&
    Number.isFinite(value.timerEndTimestamp)
  ) {
    return {
      secondsLeft: value.secondsLeft,
      ...(typeof value.durationSeconds === "number"
        ? { durationSeconds: value.durationSeconds }
        : {}),
      isPaused: false,
      timerEndTimestamp: value.timerEndTimestamp as number,
      savedAt: value.savedAt as number,
    };
  }

  return undefined;
}

/** Parse and validate serialized application settings.
 * @param raw The raw JSON contents read from the settings file.
 */
export function parsePersistedSettings(raw: string): PersistedSettings | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }

  if (
    !isRecord(value) ||
    value.version !== 1 ||
    typeof value.countdownWindowVisible !== "boolean"
  )
    return null;
  if (
    value.advancedControlsVisible !== undefined &&
    typeof value.advancedControlsVisible !== "boolean"
  )
    return null;
  if (
    value.instructionsVisible !== undefined &&
    typeof value.instructionsVisible !== "boolean"
  )
    return null;
  if (
    value.notificationMode !== undefined &&
    value.notificationMode !== "window" &&
    value.notificationMode !== "system" &&
    value.notificationMode !== "both"
  )
    return null;
  if (
    value.alarmSoundEnabled !== undefined &&
    typeof value.alarmSoundEnabled !== "boolean"
  )
    return null;
  if (
    value.alarmSound !== undefined &&
    value.alarmSound !== "classic" &&
    value.alarmSound !== "digital" &&
    value.alarmSound !== "gentle"
  )
    return null;
  if (
    value.countdownFormat !== undefined &&
    value.countdownFormat !== "compact" &&
    value.countdownFormat !== "clock" &&
    value.countdownFormat !== "seconds"
  )
    return null;
  if (
    value.countdownFontSize !== undefined &&
    (!Number.isInteger(value.countdownFontSize) ||
      Number(value.countdownFontSize) < 8 ||
      Number(value.countdownFontSize) > 32)
  )
    return null;
  if (
    value.countdownMenuButtonVisible !== undefined &&
    typeof value.countdownMenuButtonVisible !== "boolean"
  )
    return null;
  if (
    value.countdownBackgroundColor !== undefined &&
    (typeof value.countdownBackgroundColor !== "string" ||
      !/^#[0-9a-fA-F]{6}$/.test(value.countdownBackgroundColor))
  )
    return null;
  const timer = parseTimer(value.timer);
  if (timer === undefined) return null;
  const countdownWindowPosition = parseCountdownWindowPosition(
    value.countdownWindowPosition,
  );

  return {
    version: 1,
    timer,
    countdownWindowVisible: value.countdownWindowVisible,
    ...(countdownWindowPosition ? { countdownWindowPosition } : {}),
    ...(typeof value.advancedControlsVisible === "boolean"
      ? { advancedControlsVisible: value.advancedControlsVisible }
      : {}),
    ...(typeof value.instructionsVisible === "boolean"
      ? { instructionsVisible: value.instructionsVisible }
      : {}),
    ...(value.notificationMode === "window" ||
    value.notificationMode === "system" ||
    value.notificationMode === "both"
      ? { notificationMode: value.notificationMode }
      : {}),
    ...(typeof value.alarmSoundEnabled === "boolean"
      ? { alarmSoundEnabled: value.alarmSoundEnabled }
      : {}),
    ...(value.alarmSound === "classic" ||
    value.alarmSound === "digital" ||
    value.alarmSound === "gentle"
      ? { alarmSound: value.alarmSound }
      : {}),
    ...(value.countdownFormat === "compact" ||
    value.countdownFormat === "clock" ||
    value.countdownFormat === "seconds"
      ? { countdownFormat: value.countdownFormat }
      : {}),
    ...(typeof value.countdownFontSize === "number"
      ? { countdownFontSize: value.countdownFontSize }
      : {}),
    ...(typeof value.countdownMenuButtonVisible === "boolean"
      ? { countdownMenuButtonVisible: value.countdownMenuButtonVisible }
      : {}),
    ...(typeof value.countdownBackgroundColor === "string"
      ? {
          countdownBackgroundColor:
            value.countdownBackgroundColor.toLowerCase(),
        }
      : {}),
  };
}
