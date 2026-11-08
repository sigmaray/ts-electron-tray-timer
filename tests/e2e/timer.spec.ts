import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import { spawn } from "node:child_process";

test.describe("Timer Application", () => {
  let electronApp: ElectronApplication;
  let window: Page;
  let settingsPath: string;

  test.beforeEach(async ({}, testInfo) => {
    settingsPath = path.join(
      os.tmpdir(),
      `electron-tray-timer-test-${process.pid}-${testInfo.testId}.json`,
    );
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 1,
        timer: null,
        countdownWindowVisible: false,
      }),
    );
    // Launch the Electron application.
    const electronPath = require("electron");
    const mainPath = path.join(__dirname, "../../dist/main.js");

    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [mainPath],
      env: {
        ...process.env,
        NODE_ENV: "test",
        TIMER_SETTINGS_PATH: settingsPath,
      },
    });

    // Get the app's first window.
    window = await electronApp.firstWindow();

    // Wait for the app to load.
    await window.waitForLoadState("domcontentloaded");

    // The app starts hidden in the tray, so show its window for testing.
    await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].show();
      }
    });

    // Wait for the main UI elements.
    await window.waitForSelector("#timerDisplay", { timeout: 10000 });
    await window.waitForSelector("#secondsInput", { timeout: 10000 });

    // Wait for the app to initialize.
  });

  test.afterEach(async () => {
    // Close the Electron app after the tests.
    if (electronApp) {
      await electronApp.close();
    }
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
  });

  test.beforeEach(async () => {
    // Ensure the window is visible before each test.
    if (window) {
      // Show the window explicitly because the app starts hidden in the tray.
      await electronApp.evaluate(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].show();
          windows[0].focus();
        }
      });
      await window.bringToFront();

      // Reset the timer if it is running.
      const stopBtn = window.locator("#stopBtn");
      const isStopEnabled = await stopBtn.isEnabled().catch(() => false);
      if (isStopEnabled) {
        await stopBtn.click();
        await expect(window.locator("#timerDisplay")).toContainText("0s");
      }
    }
  });

  test("должен отображать начальное состояние", async () => {
    // Check that the timer shows 0 seconds (00:00).
    const timerText = await window.locator("#timerDisplay").textContent();
    expect(timerText).toContain("0s");
    expect(timerText).toContain("(00:00)");

    // Check that the start button is enabled.
    await expect(window.locator("#startBtn")).toBeEnabled();

    // Check that the pause and stop buttons are disabled.
    await expect(window.locator("#pauseBtn")).toBeDisabled();
    await expect(window.locator("#stopBtn")).toBeDisabled();
    await expect(window.locator("#status")).toHaveText("Timer is not set");
    await expect(window.locator("#advancedControlsToggle")).not.toBeChecked();
    await expect(window.locator("#instructionsToggle")).not.toBeChecked();
    await expect(window.locator(".visibility-toggles")).toBeVisible();
    const sectionsInOrder = await window.evaluate(() => {
      const timer = document.querySelector(".timer-section")!;
      const toggles = document.querySelector(".visibility-toggles")!;
      const advanced = document.querySelector("#advancedControls")!;
      const instructions = document.querySelector("#instructions")!;
      const follows = (first: Element, second: Element) =>
        (first.compareDocumentPosition(second) &
          Node.DOCUMENT_POSITION_FOLLOWING) !==
        0;
      return (
        follows(timer, toggles) &&
        follows(toggles, advanced) &&
        follows(advanced, instructions)
      );
    });
    expect(sectionsInOrder).toBe(true);
    await expect(window.locator("#advancedControls")).toBeHidden();
    await expect(window.locator("#timeAdjustDescription")).toBeHidden();
    await expect(window.locator("#instructions")).toBeHidden();
  });

  test("должен запускать таймер с заданным временем", async () => {
    // Set a short five-second duration for this test.
    await window.fill("#secondsInput", "5s");

    // Start the timer.
    await window.click("#startBtn");

    // Check that the start button is disabled.
    await expect(window.locator("#startBtn")).toBeDisabled();

    // Check that the pause and stop buttons are enabled.
    await expect(window.locator("#pauseBtn")).toBeEnabled();
    await expect(window.locator("#stopBtn")).toBeEnabled();

    // Check that the input is disabled.
    await expect(window.locator("#secondsInput")).toBeDisabled();

    // Check that the timer has started counting down.
    await expect(window.locator("#timerDisplay")).not.toContainText(
      "0s (00:00)",
    );
  });

  test("должен останавливать таймер", async () => {
    // Start the timer.
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Stop the timer.
    await window.click("#stopBtn");

    // Check that the timer is stopped.
    await expect(window.locator("#timerDisplay")).toContainText("0s");
    await expect(window.locator("#timerDisplay")).toContainText("(00:00)");

    // Check that the start button is enabled.
    await expect(window.locator("#startBtn")).toBeEnabled();

    // Check that the input is enabled again.
    await expect(window.locator("#secondsInput")).toBeEnabled();
  });

  test("должен ставить таймер на паузу и возобновлять", async () => {
    // Start the timer.
    await window.fill("#secondsInput", "30s");
    await window.click("#startBtn");

    // Pause the timer.
    await window.click("#pauseBtn");

    // Check that the button now says "Resume".
    await expect(window.locator("#pauseBtn")).toHaveText("Resume");

    // Record the displayed time while paused.
    const pausedTime = await window.locator("#timerDisplay").textContent();

    // Wait briefly and verify that the time stays unchanged.
    await expect(window.locator("#timerDisplay")).toHaveText(pausedTime!, {
      timeout: 1_500,
    });

    // Resume the timer.
    await window.click("#pauseBtn");

    // Check that the button now says "Pause".
    await expect(window.locator("#pauseBtn")).toHaveText("Pause");

    // Wait briefly and verify that the time changes.
    await expect(window.locator("#timerDisplay")).not.toHaveText(pausedTime!, {
      timeout: 2_000,
    });
  });

  test("должен изменять время через кнопки input когда таймер не запущен", async () => {
    // Ensure that the timer is stopped.
    const stopBtn = window.locator("#stopBtn");
    if (await stopBtn.isEnabled()) {
      await stopBtn.click();
      await expect(window.locator("#secondsInput")).toBeEnabled();
    }

    // Set the initial value.
    await window.fill("#secondsInput", "1m");

    // The buttons should be enabled while the timer is stopped.
    await expect(window.locator("#inputAdjustPlus1m")).toBeEnabled();

    // Add one minute.
    await window.click("#inputAdjustPlus1m");
    await expect(window.locator("#secondsInput")).toHaveValue("2m");

    // Add five more minutes.
    await window.click("#inputAdjustPlus5m");
    await expect(window.locator("#secondsInput")).toHaveValue("7m");

    // Subtract two minutes.
    await window.click("#inputAdjustMinus1m");
    await window.click("#inputAdjustMinus1m");
    await expect(window.locator("#secondsInput")).toHaveValue("5m");
  });

  test("должен блокировать кнопки input когда таймер запущен", async () => {
    // Start the timer.
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // The input adjustment buttons should be disabled.
    await expect(window.locator("#inputAdjustPlus1m")).toBeDisabled();
    await expect(window.locator("#inputAdjustMinus1m")).toBeDisabled();
  });

  test("должен изменять время запущенного таймера через кнопки изменения времени", async () => {
    await window.locator("#advancedControlsToggle").check();
    // Start a 30-second timer.
    await window.fill("#secondsInput", "30s");
    await window.click("#startBtn");

    // Record the current time.
    const initialTime = await window.locator("#timerDisplay").textContent();

    // Add one minute (60 seconds).
    await window.click("#adjustPlus1m");

    // The displayed time should increase.
    await expect(window.locator("#timerDisplay")).not.toHaveText(initialTime!);

    // Subtract 30 seconds.
    await window.click("#adjustMinus1m");
  });

  test("должен использовать quick links для установки времени", async () => {
    // Quick links should be enabled while the timer is stopped.
    const quickLink = window.locator('.quick-link[data-time="5m"]');
    await expect(quickLink).toBeVisible();

    // Click a quick link.
    await quickLink.click();

    // Check that the input value changed.
    await expect(window.locator("#secondsInput")).toHaveValue("5m");
  });

  test("должен блокировать quick links когда таймер запущен", async () => {
    // Start the timer.
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Quick links should look disabled (reduced opacity or no pointer events).
    const quickLink = window.locator('.quick-link[data-time="5m"]');
    const pointerEvents = await quickLink.evaluate(
      (el) => globalThis.getComputedStyle(el).pointerEvents,
    );
    const opacity = await quickLink.evaluate(
      (el) => globalThis.getComputedStyle(el).opacity,
    );

    // Verify that pointer events are disabled or opacity is reduced.
    const isDisabled = pointerEvents === "none" || parseFloat(opacity) < 1;
    expect(isDisabled).toBe(true);

    // Clicking the link should not change the input value.
    const currentValue = await window.locator("#secondsInput").inputValue();
    await quickLink.click({ force: true });
    await expect(window.locator("#secondsInput")).toHaveValue(currentValue);
  });

  test("должен правильно парсить различные форматы времени", async () => {
    // Test several duration formats.
    const formats = [
      { input: "60s", expected: "60s" },
      { input: "1m", expected: "1m" },
      { input: "1h", expected: "1h" },
      { input: "90s", expected: "90s" },
    ];

    for (const format of formats) {
      await window.fill("#secondsInput", format.input);
      await window.click("#startBtn");

      // Verify that the timer started by checking the start button.
      await expect(window.locator("#startBtn")).toBeDisabled();

      // Stop the timer before the next case.
      await window.click("#stopBtn");
    }
  });

  test("должен показывать статус таймера", async () => {
    // Check the initial status.
    const status = window.locator("#status");

    // Start the timer.
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Check the "Timer started" status.
    await expect(status).toContainText("Timer started");

    // Pause the timer.
    await window.click("#pauseBtn");
    await expect(status).toContainText("Timer paused");

    // Stop the timer.
    await window.click("#stopBtn");
    await expect(status).toContainText("Timer stopped");
  });

  test("должен блокировать кнопки изменения времени когда таймер не запущен", async () => {
    await window.locator("#advancedControlsToggle").check();
    // Running-timer adjustment buttons should be disabled.
    await expect(window.locator("#adjustPlus1m")).toBeDisabled();
    await expect(window.locator("#adjustMinus1m")).toBeDisabled();

    // Start the timer.
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // The buttons should now be enabled.
    await expect(window.locator("#adjustPlus1m")).toBeEnabled();
    await expect(window.locator("#adjustMinus1m")).toBeEnabled();
  });

  test("должен работать с большими значениями времени", async () => {
    // Set a long duration (two hours).
    await window.fill("#secondsInput", "2h");
    await window.click("#startBtn");

    // Verify that the timer started.
    await expect(window.locator("#startBtn")).toBeDisabled();

    // Verify that the display shows a nonzero duration.
    const timerText = await window.locator("#timerDisplay").textContent();
    expect(timerText).not.toContain("0s (00:00)");

    // Stop the timer.
    await window.click("#stopBtn");
  });

  test("должен сворачивать окно в трей", async () => {
    // Ensure that the window is visible; beforeEach should show it.
    const isVisibleBefore = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0 && !windows[0].isVisible()) {
        windows[0].show();
        windows[0].focus();
      }
      return windows.length > 0 && windows[0].isVisible();
    });
    expect(isVisibleBefore).toBe(true);

    // Simulate a tray-icon click to hide the window.
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          // Simulate a tray-icon click event.
          tray.emit("click");
        }
      }
    });

    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        ),
      )
      .toBe(false);
  });

  test("должен показывать окно из трея", async () => {
    // Hide the window to the tray first.
    await window.evaluate(() => {
      document.defaultView?.electronAPI?.minimizeWindow();
    });
    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        ),
      )
      .toBe(false);

    // Verify that the window is hidden.
    const isVisibleBefore = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length > 0 && windows[0].isVisible();
    });
    expect(isVisibleBefore).toBe(false);

    // Simulate a tray-icon click by emitting the click event directly.
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          // Simulate a tray-icon click event.
          tray.emit("click");
        }
      }
    });

    await expect
      .poll(() =>
        electronApp.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows()[0]?.isVisible(),
        ),
      )
      .toBe(true);

    // Verify that the window is visible again.
    const isVisibleAfter = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length > 0 && windows[0].isVisible();
    });
    expect(isVisibleAfter).toBe(true);

    // Ensure that the UI elements are available.
    await window.waitForSelector("#timerDisplay", { timeout: 5000 });
  });

  test("должен сохранять состояние при сворачивании и разворачивании", async () => {
    // Set a duration and start the timer.
    await window.fill("#secondsInput", "30s");
    await window.click("#startBtn");
    // Record the timer state.
    const timerTextBefore = await window.locator("#timerDisplay").textContent();

    // Hide the app using the tray icon.
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          tray.emit("click");
        }
      }
    });
    // Show the app again using the tray icon.
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          tray.emit("click");
        }
      }
    });
    // Wait for the UI elements to load.
    await window.waitForSelector("#timerDisplay", { timeout: 5000 });

    // Verify that the timer is still running.
    const isRunningAfter = await window.locator("#startBtn").isDisabled();

    // Verify that the timer keeps counting down.
    expect(isRunningAfter).toBe(true);
    await expect
      .poll(() => window.locator("#timerDisplay").textContent(), {
        timeout: 3_000,
      })
      .not.toBe(timerTextBefore);

    // Stop the timer.
    await window.click("#stopBtn");
  });

  test("сохраняет настройки видимости блоков и восстанавливает их после перезапуска", async () => {
    const advancedToggle = window.locator("#advancedControlsToggle");
    const instructionsToggle = window.locator("#instructionsToggle");

    await advancedToggle.check();
    await expect(window.locator("#advancedControls")).toBeVisible();
    await expect(window.locator("#timeAdjustDescription")).toBeHidden();
    await expect(window.locator("#instructions")).toBeHidden();

    await instructionsToggle.check();
    await expect(window.locator("#instructions")).toBeVisible();
    await expect(window.locator("#timeAdjustDescription")).toBeVisible();
    await instructionsToggle.uncheck();
    await expect(window.locator("#instructions")).toBeHidden();
    await expect(window.locator("#timeAdjustDescription")).toBeHidden();
    await instructionsToggle.check();
    await expect(window.locator("#timeAdjustDescription")).toBeVisible();
    await advancedToggle.uncheck();
    await expect(window.locator("#advancedControls")).toBeHidden();
    await expect(window.locator("#timeAdjustDescription")).toBeHidden();
    await expect(instructionsToggle).toBeChecked();
    await advancedToggle.check();

    await expect
      .poll(() => JSON.parse(fs.readFileSync(settingsPath, "utf8")))
      .toMatchObject({
        advancedControlsVisible: true,
        instructionsVisible: true,
      });

    await electronApp.close();
    const electronPath = require("electron");
    const mainPath = path.join(__dirname, "../../dist/main.js");
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [mainPath],
      env: {
        ...process.env,
        NODE_ENV: "test",
        TIMER_SETTINGS_PATH: settingsPath,
      },
    });
    window = await electronApp.firstWindow();
    await window.waitForLoadState("domcontentloaded");
    await electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.show(),
    );
    await expect(window.locator("#advancedControlsToggle")).toBeChecked();
    await expect(window.locator("#instructionsToggle")).toBeChecked();
    await expect(window.locator("#advancedControls")).toBeVisible();
    await expect(window.locator("#timeAdjustDescription")).toBeVisible();
    await expect(window.locator("#instructions")).toBeVisible();
  });
});

test("shows a missed timer alert once after restart", async () => {
  const electronPath = require("electron");
  const mainPath = path.join(__dirname, "../../dist/main.js");
  const isolatedSettingsPath = path.join(
    os.tmpdir(),
    `electron-tray-timer-expired-${process.pid}.json`,
  );
  const userDataPath = path.join(
    os.tmpdir(),
    `electron-tray-timer-expired-user-${process.pid}`,
  );
  const launchWithSettings = () =>
    electron.launch({
      executablePath: electronPath,
      args: [mainPath, `--user-data-dir=${userDataPath}`],
      env: {
        ...process.env,
        NODE_ENV: "test",
        ALLOW_ONLY_ONE_INSTANCE: "false",
        TIMER_SETTINGS_PATH: isolatedSettingsPath,
      },
    });

  fs.writeFileSync(
    isolatedSettingsPath,
    JSON.stringify({
      version: 1,
      timer: {
        secondsLeft: 30,
        isPaused: false,
        timerEndTimestamp: Date.now() - 5_000,
        savedAt: Date.now() - 35_000,
      },
      countdownWindowVisible: false,
    }),
  );

  try {
    const firstApp = await launchWithSettings();
    const firstWindow = await firstApp.firstWindow();
    firstWindow.on("dialog", (dialog) => void dialog.accept());
    await firstWindow.waitForSelector("#dismissAlertBtn", {
      state: "visible",
      timeout: 10_000,
    });
    expect(
      JSON.parse(fs.readFileSync(isolatedSettingsPath, "utf8")).timer,
    ).toBeNull();
    await firstApp.close();

    const secondApp = await launchWithSettings();
    const secondWindow = await secondApp.firstWindow();
    let unexpectedDialogs = 0;
    secondWindow.on("dialog", (dialog) => {
      unexpectedDialogs++;
      void dialog.accept();
    });
    await secondWindow.waitForSelector("#timerDisplay");
    await expect(secondWindow.locator("#dismissAlertBtn")).toBeHidden();
    await expect.poll(() => unexpectedDialogs, { timeout: 1_000 }).toBe(0);
    await secondApp.close();
  } finally {
    if (fs.existsSync(isolatedSettingsPath))
      fs.unlinkSync(isolatedSettingsPath);
    fs.rmSync(userDataPath, { recursive: true, force: true });
  }
});

test("restores a paused timer without firing a completion alert", async () => {
  const electronPath = require("electron");
  const mainPath = path.join(__dirname, "../../dist/main.js");
  const settingsPath = path.join(
    os.tmpdir(),
    `electron-tray-timer-paused-${process.pid}.json`,
  );
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      version: 1,
      timer: {
        secondsLeft: 600,
        durationSeconds: 900,
        isPaused: true,
        savedAt: Date.now(),
      },
      countdownWindowVisible: false,
    }),
  );

  const app = await electron.launch({
    executablePath: electronPath,
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ALLOW_ONLY_ONE_INSTANCE: "false",
      TIMER_SETTINGS_PATH: settingsPath,
    },
  });

  try {
    const appWindow = await app.firstWindow();
    appWindow.on("dialog", (dialog) => {
      throw new Error(
        `Paused timer unexpectedly opened a dialog: ${dialog.message()}`,
      );
    });
    await appWindow.waitForSelector("#timerDisplay");
    await expect(appWindow.locator("#status")).toHaveText("Timer paused");
    await expect(appWindow.locator("#pauseBtn")).toHaveText("Resume");
    await expect(appWindow.locator("#timerDisplay")).toContainText("10m");
    await expect(appWindow.locator("#dismissAlertBtn")).toBeHidden();
  } finally {
    await app.close();
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
  }
});

test("a second instance cannot overwrite the running instance settings", async () => {
  const electronPath = require("electron");
  const mainPath = path.join(__dirname, "../../dist/main.js");
  const settingsPath = path.join(
    os.tmpdir(),
    `electron-tray-timer-lock-${process.pid}.json`,
  );
  fs.writeFileSync(
    settingsPath,
    JSON.stringify({
      version: 1,
      timer: {
        secondsLeft: 600,
        durationSeconds: 900,
        isPaused: true,
        savedAt: Date.now(),
      },
      countdownWindowVisible: false,
      advancedControlsVisible: true,
      instructionsVisible: true,
    }),
  );

  const firstApp = await electron.launch({
    executablePath: electronPath,
    args: [mainPath],
    env: {
      ...process.env,
      NODE_ENV: "test",
      ALLOW_ONLY_ONE_INSTANCE: "true",
      TIMER_SETTINGS_PATH: settingsPath,
    },
  });

  try {
    const firstWindow = await firstApp.firstWindow();
    await firstWindow.waitForSelector("#timerDisplay");
    const secondProcess = spawn(electronPath, [mainPath], {
      env: {
        ...process.env,
        NODE_ENV: "test",
        ALLOW_ONLY_ONE_INSTANCE: "true",
        TIMER_SETTINGS_PATH: settingsPath,
      },
      stdio: "ignore",
    });
    const secondExitCode = await new Promise<number>((resolve, reject) => {
      const timeout = setTimeout(() => {
        secondProcess.kill();
        reject(
          new Error(
            "Second Electron instance did not exit after failing to acquire the lock",
          ),
        );
      }, 10_000);
      secondProcess.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      secondProcess.once("exit", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 0);
      });
    });

    expect(secondExitCode).toBe(0);
    expect(JSON.parse(fs.readFileSync(settingsPath, "utf8"))).toMatchObject({
      timer: { isPaused: true, durationSeconds: 900 },
      advancedControlsVisible: true,
      instructionsVisible: true,
    });
  } finally {
    await firstApp.close();
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
  }
});

test.describe("Timer Application - Initial State", () => {
  test("должен запускаться свернутым в трей", async () => {
    // Launch a new Electron app to verify its initial state.
    const electronPath = require("electron");
    const mainPath = path.join(__dirname, "../../dist/main.js");
    const isolatedSettingsPath = path.join(
      os.tmpdir(),
      `electron-tray-timer-initial-${process.pid}.json`,
    );
    fs.writeFileSync(
      isolatedSettingsPath,
      JSON.stringify({
        version: 1,
        timer: null,
        countdownWindowVisible: false,
      }),
    );

    const testApp = await electron.launch({
      executablePath: electronPath,
      args: [mainPath],
      env: {
        ...process.env,
        NODE_ENV: "test",
        TIMER_SETTINGS_PATH: isolatedSettingsPath,
      },
    });

    try {
      // Get the app's first window.
      const testWindow = await testApp.firstWindow();

      // Wait for the app to load.
      await testWindow.waitForLoadState("domcontentloaded");

      await expect
        .poll(() =>
          testApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.isVisible(),
          ),
        )
        .toBe(false);
    } finally {
      // Close the test app.
      await testApp.close();
      if (fs.existsSync(isolatedSettingsPath))
        fs.unlinkSync(isolatedSettingsPath);
    }
  });
});
