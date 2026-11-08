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
    // Запускаем реальное Electron приложение
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

    // Получаем первое окно приложения
    window = await electronApp.firstWindow();

    // Ждем загрузки приложения
    await window.waitForLoadState("domcontentloaded");

    // Приложение запускается свернутым в трей, поэтому нужно явно показать окно для тестов
    await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0) {
        windows[0].show();
      }
    });

    // Ждем появления основных элементов
    await window.waitForSelector("#timerDisplay", { timeout: 10000 });
    await window.waitForSelector("#secondsInput", { timeout: 10000 });

    // Ждем инициализации приложения
  });

  test.afterEach(async () => {
    // Закрываем Electron приложение после всех тестов
    if (electronApp) {
      await electronApp.close();
    }
    if (fs.existsSync(settingsPath)) fs.unlinkSync(settingsPath);
  });

  test.beforeEach(async () => {
    // Перед каждым тестом убеждаемся, что окно видимо
    if (window) {
      // Явно показываем окно (приложение запускается свернутым в трей)
      await electronApp.evaluate(({ BrowserWindow }) => {
        const windows = BrowserWindow.getAllWindows();
        if (windows.length > 0) {
          windows[0].show();
          windows[0].focus();
        }
      });
      await window.bringToFront();

      // Сбрасываем состояние таймера, если он запущен
      const stopBtn = window.locator("#stopBtn");
      const isStopEnabled = await stopBtn.isEnabled().catch(() => false);
      if (isStopEnabled) {
        await stopBtn.click();
        await expect(window.locator("#timerDisplay")).toContainText("0s");
      }
    }
  });

  test("должен отображать начальное состояние", async () => {
    // Проверяем, что таймер показывает 0с (00:00)
    const timerText = await window.locator("#timerDisplay").textContent();
    expect(timerText).toContain("0s");
    expect(timerText).toContain("(00:00)");

    // Проверяем, что кнопка запуска активна
    await expect(window.locator("#startBtn")).toBeEnabled();

    // Проверяем, что кнопки паузы и остановки неактивны
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
    // Устанавливаем время 5 секунд для быстрого теста
    await window.fill("#secondsInput", "5s");

    // Запускаем таймер
    await window.click("#startBtn");

    // Проверяем, что кнопка запуска неактивна
    await expect(window.locator("#startBtn")).toBeDisabled();

    // Проверяем, что кнопки паузы и остановки активны
    await expect(window.locator("#pauseBtn")).toBeEnabled();
    await expect(window.locator("#stopBtn")).toBeEnabled();

    // Проверяем, что поле ввода заблокировано
    await expect(window.locator("#secondsInput")).toBeDisabled();

    // Проверяем, что таймер начал отсчет (не 0с (00:00))
    await expect(window.locator("#timerDisplay")).not.toContainText(
      "0s (00:00)",
    );
  });

  test("должен останавливать таймер", async () => {
    // Запускаем таймер
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Останавливаем таймер
    await window.click("#stopBtn");

    // Проверяем, что таймер остановлен
    await expect(window.locator("#timerDisplay")).toContainText("0s");
    await expect(window.locator("#timerDisplay")).toContainText("(00:00)");

    // Проверяем, что кнопка запуска активна
    await expect(window.locator("#startBtn")).toBeEnabled();

    // Проверяем, что поле ввода разблокировано
    await expect(window.locator("#secondsInput")).toBeEnabled();
  });

  test("должен ставить таймер на паузу и возобновлять", async () => {
    // Запускаем таймер
    await window.fill("#secondsInput", "30s");
    await window.click("#startBtn");

    // Ставим на паузу
    await window.click("#pauseBtn");

    // Проверяем, что кнопка показывает "Возобновить"
    await expect(window.locator("#pauseBtn")).toHaveText("Resume");

    // Запоминаем время на паузе
    const pausedTime = await window.locator("#timerDisplay").textContent();

    // Ждем немного - время не должно измениться
    await expect(window.locator("#timerDisplay")).toHaveText(pausedTime!, {
      timeout: 1_500,
    });

    // Возобновляем
    await window.click("#pauseBtn");

    // Проверяем, что кнопка показывает "Пауза"
    await expect(window.locator("#pauseBtn")).toHaveText("Pause");

    // Ждем немного - время должно измениться
    await expect(window.locator("#timerDisplay")).not.toHaveText(pausedTime!, {
      timeout: 2_000,
    });
  });

  test("должен изменять время через кнопки input когда таймер не запущен", async () => {
    // Убеждаемся, что таймер остановлен
    const stopBtn = window.locator("#stopBtn");
    if (await stopBtn.isEnabled()) {
      await stopBtn.click();
      await expect(window.locator("#secondsInput")).toBeEnabled();
    }

    // Устанавливаем начальное значение
    await window.fill("#secondsInput", "1m");

    // Кнопки должны быть активны когда таймер не запущен
    await expect(window.locator("#inputAdjustPlus1m")).toBeEnabled();

    // Добавляем 1 минуту
    await window.click("#inputAdjustPlus1m");
    await expect(window.locator("#secondsInput")).toHaveValue("2m");

    // Добавляем еще 5 минут
    await window.click("#inputAdjustPlus5m");
    await expect(window.locator("#secondsInput")).toHaveValue("7m");

    // Вычитаем 2 минуты
    await window.click("#inputAdjustMinus1m");
    await window.click("#inputAdjustMinus1m");
    await expect(window.locator("#secondsInput")).toHaveValue("5m");
  });

  test("должен блокировать кнопки input когда таймер запущен", async () => {
    // Запускаем таймер
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Кнопки input должны быть заблокированы
    await expect(window.locator("#inputAdjustPlus1m")).toBeDisabled();
    await expect(window.locator("#inputAdjustMinus1m")).toBeDisabled();
  });

  test("должен изменять время запущенного таймера через кнопки изменения времени", async () => {
    await window.locator("#advancedControlsToggle").check();
    // Запускаем таймер на 30 секунд
    await window.fill("#secondsInput", "30s");
    await window.click("#startBtn");

    // Запоминаем текущее время
    const initialTime = await window.locator("#timerDisplay").textContent();

    // Добавляем 1 минуту (60 секунд)
    await window.click("#adjustPlus1m");

    // Время должно увеличиться
    await expect(window.locator("#timerDisplay")).not.toHaveText(initialTime!);

    // Вычитаем 30 секунд
    await window.click("#adjustMinus1m");
  });

  test("должен использовать quick links для установки времени", async () => {
    // Quick links должны быть активны когда таймер не запущен
    const quickLink = window.locator('.quick-link[data-time="5m"]');
    await expect(quickLink).toBeVisible();

    // Кликаем на quick link
    await quickLink.click();

    // Проверяем, что значение в input изменилось
    await expect(window.locator("#secondsInput")).toHaveValue("5m");
  });

  test("должен блокировать quick links когда таймер запущен", async () => {
    // Запускаем таймер
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Quick links должны быть неактивны (opacity: 0.5 или pointer-events: none)
    const quickLink = window.locator('.quick-link[data-time="5m"]');
    const pointerEvents = await quickLink.evaluate(
      (el) => globalThis.getComputedStyle(el).pointerEvents,
    );
    const opacity = await quickLink.evaluate(
      (el) => globalThis.getComputedStyle(el).opacity,
    );

    // Проверяем, что либо pointer-events: none, либо opacity < 1
    const isDisabled = pointerEvents === "none" || parseFloat(opacity) < 1;
    expect(isDisabled).toBe(true);

    // Попытка кликнуть не должна изменить значение
    const currentValue = await window.locator("#secondsInput").inputValue();
    await quickLink.click({ force: true });
    await expect(window.locator("#secondsInput")).toHaveValue(currentValue);
  });

  test("должен правильно парсить различные форматы времени", async () => {
    // Тестируем разные форматы
    const formats = [
      { input: "60s", expected: "60s" },
      { input: "1m", expected: "1m" },
      { input: "1h", expected: "1h" },
      { input: "90s", expected: "90s" },
    ];

    for (const format of formats) {
      await window.fill("#secondsInput", format.input);
      await window.click("#startBtn");

      // Проверяем, что таймер запустился (кнопка запуска неактивна)
      await expect(window.locator("#startBtn")).toBeDisabled();

      // Останавливаем для следующего теста
      await window.click("#stopBtn");
    }
  });

  test("должен показывать статус таймера", async () => {
    // Проверяем начальный статус
    const status = window.locator("#status");

    // Запускаем таймер
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Проверяем статус "Таймер запущен..."
    await expect(status).toContainText("Timer started");

    // Ставим на паузу
    await window.click("#pauseBtn");
    await expect(status).toContainText("Timer paused");

    // Останавливаем
    await window.click("#stopBtn");
    await expect(status).toContainText("Timer stopped");
  });

  test("должен блокировать кнопки изменения времени когда таймер не запущен", async () => {
    await window.locator("#advancedControlsToggle").check();
    // Кнопки изменения времени запущенного таймера должны быть заблокированы
    await expect(window.locator("#adjustPlus1m")).toBeDisabled();
    await expect(window.locator("#adjustMinus1m")).toBeDisabled();

    // Запускаем таймер
    await window.fill("#secondsInput", "10s");
    await window.click("#startBtn");

    // Теперь кнопки должны быть активны
    await expect(window.locator("#adjustPlus1m")).toBeEnabled();
    await expect(window.locator("#adjustMinus1m")).toBeEnabled();
  });

  test("должен работать с большими значениями времени", async () => {
    // Устанавливаем большое время (2 часа)
    await window.fill("#secondsInput", "2h");
    await window.click("#startBtn");

    // Проверяем, что таймер запустился
    await expect(window.locator("#startBtn")).toBeDisabled();

    // Проверяем, что отображается время (не 0с (00:00))
    const timerText = await window.locator("#timerDisplay").textContent();
    expect(timerText).not.toContain("0s (00:00)");

    // Останавливаем
    await window.click("#stopBtn");
  });

  test("должен сворачивать окно в трей", async () => {
    // Убеждаемся, что окно видимо (перед тестом оно должно быть показано в beforeEach)
    const isVisibleBefore = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0 && !windows[0].isVisible()) {
        windows[0].show();
        windows[0].focus();
      }
      return windows.length > 0 && windows[0].isVisible();
    });
    expect(isVisibleBefore).toBe(true);

    // Эмулируем клик по иконке трея для сворачивания окна
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          // Эмулируем событие клика по трею
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
    // Сначала сворачиваем окно в трей
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

    // Проверяем, что окно скрыто
    const isVisibleBefore = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length > 0 && windows[0].isVisible();
    });
    expect(isVisibleBefore).toBe(false);

    // Эмулируем клик по иконке трея - вызываем событие 'click' напрямую
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          // Эмулируем событие клика по трею
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

    // Проверяем, что окно снова видимо
    const isVisibleAfter = await electronApp.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return windows.length > 0 && windows[0].isVisible();
    });
    expect(isVisibleAfter).toBe(true);

    // Убеждаемся, что элементы интерфейса доступны
    await window.waitForSelector("#timerDisplay", { timeout: 5000 });
  });

  test("должен сохранять состояние при сворачивании и разворачивании", async () => {
    // Устанавливаем время и запускаем таймер
    await window.fill("#secondsInput", "30s");
    await window.click("#startBtn");
    // Запоминаем состояние таймера
    const timerTextBefore = await window.locator("#timerDisplay").textContent();

    // Сворачиваем в трей через клик по иконке трея
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          tray.emit("click");
        }
      }
    });
    // Показываем окно обратно через клик по иконке трея
    await electronApp.evaluate(() => {
      const getTray = globalThis.__tray__;
      if (getTray) {
        const tray = getTray();
        if (tray) {
          tray.emit("click");
        }
      }
    });
    // Ждем загрузки элементов
    await window.waitForSelector("#timerDisplay", { timeout: 5000 });

    // Проверяем, что таймер продолжает работать
    const isRunningAfter = await window.locator("#startBtn").isDisabled();

    // Таймер должен продолжать работать (время должно измениться)
    expect(isRunningAfter).toBe(true);
    await expect
      .poll(() => window.locator("#timerDisplay").textContent(), {
        timeout: 3_000,
      })
      .not.toBe(timerTextBefore);

    // Останавливаем таймер
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
    // Запускаем новое Electron приложение для проверки начального состояния
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
      // Получаем первое окно приложения
      const testWindow = await testApp.firstWindow();

      // Ждем загрузки приложения
      await testWindow.waitForLoadState("domcontentloaded");

      await expect
        .poll(() =>
          testApp.evaluate(({ BrowserWindow }) =>
            BrowserWindow.getAllWindows()[0]?.isVisible(),
          ),
        )
        .toBe(false);
    } finally {
      // Закрываем тестовое приложение
      await testApp.close();
      if (fs.existsSync(isolatedSettingsPath))
        fs.unlinkSync(isolatedSettingsPath);
    }
  });
});
