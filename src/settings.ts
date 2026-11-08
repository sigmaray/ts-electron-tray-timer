import { MAX_TIMER_SECONDS } from "./time";

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

export type PersistedSettings = {
  version: 1;
  timer: PersistedTimer | null;
  countdownWindowVisible: boolean;
  advancedControlsVisible?: boolean;
  instructionsVisible?: boolean;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

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
  const timer = parseTimer(value.timer);
  if (timer === undefined) return null;

  return {
    version: 1,
    timer,
    countdownWindowVisible: value.countdownWindowVisible,
    ...(typeof value.advancedControlsVisible === "boolean"
      ? { advancedControlsVisible: value.advancedControlsVisible }
      : {}),
    ...(typeof value.instructionsVisible === "boolean"
      ? { instructionsVisible: value.instructionsVisible }
      : {}),
  };
}
