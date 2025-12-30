import { test, expect, _electron as electron } from '@playwright/test';
import * as path from 'path';

test.describe('Timer Application', () => {
  let electronApp: any;
  let window: any;

  test.beforeAll(async () => {
    // Запускаем реальное Electron приложение
    const electronPath = require('electron');
    const mainPath = path.join(__dirname, '../../dist/main.js');
    
    electronApp = await electron.launch({
      executablePath: electronPath,
      args: [mainPath],
      env: {
        ...process.env,
        ELECTRON_DISABLE_SANDBOX: '1',
      },
    });

    // Получаем первое окно приложения
    window = await electronApp.firstWindow();
    
    // Ждем загрузки приложения
    await window.waitForLoadState('domcontentloaded');
    
    // Ждем появления основных элементов
    await window.waitForSelector('#timerDisplay', { timeout: 10000 });
    await window.waitForSelector('#secondsInput', { timeout: 10000 });
    
    // Ждем инициализации приложения
    await window.waitForTimeout(1000);
  });

  test.afterAll(async () => {
    // Закрываем Electron приложение после всех тестов
    if (electronApp) {
      await electronApp.close();
    }
  });

  test.beforeEach(async () => {
    // Перед каждым тестом убеждаемся, что окно видимо
    if (window) {
      await window.bringToFront();
      
      // Сбрасываем состояние таймера, если он запущен
      const stopBtn = window.locator('#stopBtn');
      const isStopEnabled = await stopBtn.isEnabled().catch(() => false);
      if (isStopEnabled) {
        await stopBtn.click();
        await window.waitForTimeout(300);
      }
    }
  });

  test('должен отображать начальное состояние', async () => {
    // Проверяем, что таймер показывает 00:00
    await expect(window.locator('#timerDisplay')).toHaveText('00:00');
    
    // Проверяем, что кнопка запуска активна
    await expect(window.locator('#startBtn')).toBeEnabled();
    
    // Проверяем, что кнопки паузы и остановки неактивны
    await expect(window.locator('#pauseBtn')).toBeDisabled();
    await expect(window.locator('#stopBtn')).toBeDisabled();
  });

  test('должен запускать таймер с заданным временем', async () => {
    // Устанавливаем время 5 секунд для быстрого теста
    await window.fill('#secondsInput', '5s');
    
    // Запускаем таймер
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Проверяем, что кнопка запуска неактивна
    await expect(window.locator('#startBtn')).toBeDisabled();
    
    // Проверяем, что кнопки паузы и остановки активны
    await expect(window.locator('#pauseBtn')).toBeEnabled();
    await expect(window.locator('#stopBtn')).toBeEnabled();
    
    // Проверяем, что поле ввода заблокировано
    await expect(window.locator('#secondsInput')).toBeDisabled();
    
    // Проверяем, что таймер начал отсчет (не 00:00)
    await window.waitForTimeout(500);
    const timerText = await window.locator('#timerDisplay').textContent();
    expect(timerText).not.toBe('00:00');
  });

  test('должен останавливать таймер', async () => {
    // Запускаем таймер
    await window.fill('#secondsInput', '10s');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Ждем немного
    await window.waitForTimeout(500);
    
    // Останавливаем таймер
    await window.click('#stopBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Проверяем, что таймер остановлен
    await expect(window.locator('#timerDisplay')).toHaveText('00:00');
    
    // Проверяем, что кнопка запуска активна
    await expect(window.locator('#startBtn')).toBeEnabled();
    
    // Проверяем, что поле ввода разблокировано
    await expect(window.locator('#secondsInput')).toBeEnabled();
  });

  test('должен ставить таймер на паузу и возобновлять', async () => {
    // Запускаем таймер
    await window.fill('#secondsInput', '30s');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(500);
    
    // Ставим на паузу
    await window.click('#pauseBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Проверяем, что кнопка показывает "Возобновить"
    await expect(window.locator('#pauseBtn')).toHaveText('Возобновить');
    
    // Запоминаем время на паузе
    const pausedTime = await window.locator('#timerDisplay').textContent();
    
    // Ждем немного - время не должно измениться
    await window.waitForTimeout(1000);
    await expect(window.locator('#timerDisplay')).toHaveText(pausedTime!);
    
    // Возобновляем
    await window.click('#pauseBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Проверяем, что кнопка показывает "Пауза"
    await expect(window.locator('#pauseBtn')).toHaveText('Пауза');
    
    // Ждем немного - время должно измениться
    await window.waitForTimeout(1500);
    const resumedTime = await window.locator('#timerDisplay').textContent();
    expect(resumedTime).not.toBe(pausedTime);
  });

  test('должен изменять время через кнопки input когда таймер не запущен', async () => {
    // Убеждаемся, что таймер остановлен
    const stopBtn = window.locator('#stopBtn');
    if (await stopBtn.isEnabled()) {
      await stopBtn.click();
      await window.waitForTimeout(300);
    }
    
    // Устанавливаем начальное значение
    await window.fill('#secondsInput', '1m');
    await window.waitForTimeout(100);
    
    // Кнопки должны быть активны когда таймер не запущен
    await expect(window.locator('#inputAdjustPlus1m')).toBeEnabled();
    
    // Добавляем 1 минуту
    await window.click('#inputAdjustPlus1m');
    await window.waitForTimeout(100);
    await expect(window.locator('#secondsInput')).toHaveValue('2m');
    
    // Добавляем еще 5 минут
    await window.click('#inputAdjustPlus5m');
    await window.waitForTimeout(100);
    await expect(window.locator('#secondsInput')).toHaveValue('7m');
    
    // Вычитаем 2 минуты
    await window.click('#inputAdjustMinus1m');
    await window.waitForTimeout(100);
    await window.click('#inputAdjustMinus1m');
    await window.waitForTimeout(100);
    await expect(window.locator('#secondsInput')).toHaveValue('5m');
  });

  test('должен блокировать кнопки input когда таймер запущен', async () => {
    // Запускаем таймер
    await window.fill('#secondsInput', '10s');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Кнопки input должны быть заблокированы
    await expect(window.locator('#inputAdjustPlus1m')).toBeDisabled();
    await expect(window.locator('#inputAdjustMinus1m')).toBeDisabled();
  });

  test('должен изменять время запущенного таймера через кнопки изменения времени', async () => {
    // Запускаем таймер на 30 секунд
    await window.fill('#secondsInput', '30s');
    await window.click('#startBtn');
    
    await window.waitForTimeout(500);
    
    // Запоминаем текущее время
    const initialTime = await window.locator('#timerDisplay').textContent();
    
    // Добавляем 1 минуту (60 секунд)
    await window.click('#adjustPlus1m');
    
    // Ждем обновления
    await window.waitForTimeout(200);
    
    // Время должно увеличиться
    const newTime = await window.locator('#timerDisplay').textContent();
    expect(newTime).not.toBe(initialTime);
    
    // Вычитаем 30 секунд
    await window.click('#adjustMinus1m');
    await window.waitForTimeout(200);
  });

  test('должен использовать quick links для установки времени', async () => {
    // Quick links должны быть активны когда таймер не запущен
    const quickLink = window.locator('.quick-link[data-time="5m"]');
    await expect(quickLink).toBeVisible();
    
    // Кликаем на quick link
    await quickLink.click();
    
    // Проверяем, что значение в input изменилось
    await expect(window.locator('#secondsInput')).toHaveValue('5m');
  });

  test('должен блокировать quick links когда таймер запущен', async () => {
    // Запускаем таймер
    await window.fill('#secondsInput', '10s');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Quick links должны быть неактивны (opacity: 0.5 или pointer-events: none)
    const quickLink = window.locator('.quick-link[data-time="5m"]');
    const pointerEvents = await quickLink.evaluate((el) => window.getComputedStyle(el).pointerEvents);
    const opacity = await quickLink.evaluate((el) => window.getComputedStyle(el).opacity);
    
    // Проверяем, что либо pointer-events: none, либо opacity < 1
    const isDisabled = pointerEvents === 'none' || parseFloat(opacity) < 1;
    expect(isDisabled).toBe(true);
    
    // Попытка кликнуть не должна изменить значение
    const currentValue = await window.locator('#secondsInput').inputValue();
    await quickLink.click({ force: true });
    await window.waitForTimeout(100);
    await expect(window.locator('#secondsInput')).toHaveValue(currentValue);
  });

  test('должен правильно парсить различные форматы времени', async () => {
    // Тестируем разные форматы
    const formats = [
      { input: '60s', expected: '60s' },
      { input: '1m', expected: '1m' },
      { input: '1h', expected: '1h' },
      { input: '90s', expected: '90s' },
    ];
    
    for (const format of formats) {
      await window.fill('#secondsInput', format.input);
      await window.click('#startBtn');
      
      // Проверяем, что таймер запустился (кнопка запуска неактивна)
      await expect(window.locator('#startBtn')).toBeDisabled();
      
      // Останавливаем для следующего теста
      await window.click('#stopBtn');
      await window.waitForTimeout(100);
    }
  });

  test('должен показывать статус таймера', async () => {
    // Проверяем начальный статус
    const status = window.locator('#status');
    
    // Запускаем таймер
    await window.fill('#secondsInput', '10s');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Проверяем статус "Таймер запущен..."
    await expect(status).toContainText('Таймер запущен');
    
    // Ставим на паузу
    await window.click('#pauseBtn');
    await window.waitForTimeout(300);
    await expect(status).toContainText('Таймер на паузе');
    
    // Останавливаем
    await window.click('#stopBtn');
    await window.waitForTimeout(300);
    await expect(status).toContainText('Таймер остановлен');
  });

  test('должен блокировать кнопки изменения времени когда таймер не запущен', async () => {
    // Кнопки изменения времени запущенного таймера должны быть заблокированы
    await expect(window.locator('#adjustPlus1m')).toBeDisabled();
    await expect(window.locator('#adjustMinus1m')).toBeDisabled();
    
    // Запускаем таймер
    await window.fill('#secondsInput', '10s');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Теперь кнопки должны быть активны
    await expect(window.locator('#adjustPlus1m')).toBeEnabled();
    await expect(window.locator('#adjustMinus1m')).toBeEnabled();
  });

  test('должен работать с большими значениями времени', async () => {
    // Устанавливаем большое время (2 часа)
    await window.fill('#secondsInput', '2h');
    await window.click('#startBtn');
    
    // Ждем обновления UI
    await window.waitForTimeout(300);
    
    // Проверяем, что таймер запустился
    await expect(window.locator('#startBtn')).toBeDisabled();
    
    // Проверяем, что отображается время (не 00:00)
    const timerText = await window.locator('#timerDisplay').textContent();
    expect(timerText).not.toBe('00:00');
    
    // Останавливаем
    await window.click('#stopBtn');
  });
});

