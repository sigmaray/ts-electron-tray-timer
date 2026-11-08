/** Maximum duration accepted for a timer, in seconds. */
export const MAX_TIMER_SECONDS = 31_536_000;

const UNIT_SECONDS: Record<string, number> = {
  s: 1,
  m: 60,
  h: 3600,
  d: 86_400,
};

/** Parse a complete duration expression, returning seconds or null when invalid.
 * @param input The user-entered duration in seconds or unit form such as `2h 5m`.
 */
export function parseDurationInput(input: string): number | null {
  const value = input.trim();
  if (!value) return null;

  if (/^\d+$/.test(value)) {
    const seconds = Number(value);
    return Number.isSafeInteger(seconds) &&
      seconds > 0 &&
      seconds <= MAX_TIMER_SECONDS
      ? seconds
      : null;
  }

  const tokenPattern = /(\d+(?:\.\d+)?)\s*([smhd])/gi;
  let cursor = 0;
  let totalSeconds = 0;
  let foundToken = false;
  let match: RegExpExecArray | null;

  while ((match = tokenPattern.exec(value)) !== null) {
    if (value.slice(cursor, match.index).trim() !== "") return null;
    const amount = Number(match[1]);
    const unitSeconds = UNIT_SECONDS[match[2].toLowerCase()];
    if (!Number.isFinite(amount) || amount <= 0) return null;

    totalSeconds += Math.floor(amount * unitSeconds);
    if (!Number.isSafeInteger(totalSeconds) || totalSeconds > MAX_TIMER_SECONDS)
      return null;
    foundToken = true;
    cursor = tokenPattern.lastIndex;
  }

  if (!foundToken || value.slice(cursor).trim() !== "" || totalSeconds <= 0)
    return null;
  return totalSeconds;
}
