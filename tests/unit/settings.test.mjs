import { test } from "node:test";
import assert from "node:assert/strict";
import settingsModule from "../../dist/settings.js";
import timeModule from "../../dist/time.js";

const { parsePersistedSettings } = settingsModule;
const { parseDurationInput, MAX_TIMER_SECONDS } = timeModule;

test("accepts a valid paused timer and optional UI preferences", () => {
  const settings = parsePersistedSettings(
    JSON.stringify({
      version: 1,
      timer: {
        secondsLeft: 120,
        durationSeconds: 300,
        isPaused: true,
        savedAt: 1000,
      },
      countdownWindowVisible: false,
      advancedControlsVisible: true,
    }),
  );

  assert.equal(settings?.timer?.isPaused, true);
  assert.equal(settings?.timer?.durationSeconds, 300);
  assert.equal(settings?.advancedControlsVisible, true);
});

test("accepts a valid running timer", () => {
  const settings = parsePersistedSettings(
    JSON.stringify({
      version: 1,
      timer: {
        secondsLeft: 120,
        isPaused: false,
        timerEndTimestamp: 2000,
        savedAt: 1000,
      },
      countdownWindowVisible: true,
    }),
  );

  assert.equal(settings?.timer?.isPaused, false);
  assert.equal(settings?.countdownWindowVisible, true);
});

test("rejects malformed timer and preference values", () => {
  const malformedTimer = parsePersistedSettings(
    JSON.stringify({
      version: 1,
      timer: { secondsLeft: "120", isPaused: true, savedAt: 1000 },
      countdownWindowVisible: false,
    }),
  );
  const malformedPreference = parsePersistedSettings(
    JSON.stringify({
      version: 1,
      timer: null,
      countdownWindowVisible: false,
      instructionsVisible: "yes",
    }),
  );

  assert.equal(malformedTimer, null);
  assert.equal(malformedPreference, null);
});

test("returns null for invalid JSON and unsupported settings versions", () => {
  assert.equal(parsePersistedSettings("{"), null);
  assert.equal(
    parsePersistedSettings(
      JSON.stringify({
        version: 2,
        timer: null,
        countdownWindowVisible: false,
      }),
    ),
    null,
  );
});

test("parses complete duration strings and rejects typos and excessive values", () => {
  assert.equal(parseDurationInput("1h 30m 5s"), 5405);
  assert.equal(parseDurationInput("1m typo"), null);
  assert.equal(parseDurationInput("999999999999999999999999d"), null);
  assert.equal(parseDurationInput(String(MAX_TIMER_SECONDS + 1)), null);
});
