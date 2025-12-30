import { test, expect } from '@playwright/test';
import * as path from 'path';

test.describe('Timer Application', () => {
  test.beforeEach(async ({ page }) => {
    // Мокируем Electron API перед загрузкой страницы
    await page.addInitScript(() => {
      // Состояние таймера для мока
      let timerState = {
        seconds: 0,
        isRunning: false,
        isPaused: false
      };
      
      let timerInterval: any = null;
      const callbacks: Array<(state: any) => void> = [];
      
      const notifyListeners = () => {
        callbacks.forEach(cb => cb({ ...timerState }));
      };
      
      // Создаем мок для Electron API
      (window as any).electronAPI = {
        updateTimerState: () => {},
        minimizeWindow: () => {},
        closeApp: () => {},
        startTimer: (seconds: number) => {
          timerState.seconds = seconds;
          timerState.isRunning = true;
          timerState.isPaused = false;
          
          if (timerInterval) {
            clearInterval(timerInterval);
          }
          
          timerInterval = setInterval(() => {
            if (!timerState.isPaused && timerState.seconds > 0) {
              timerState.seconds--;
              notifyListeners();
              
              if (timerState.seconds <= 0) {
                timerState.seconds = 0;
                timerState.isRunning = false;
                clearInterval(timerInterval);
                timerInterval = null;
                notifyListeners();
              }
            }
          }, 1000);
          
          notifyListeners();
        },
        stopTimer: () => {
          if (timerInterval) {
            clearInterval(timerInterval);
            timerInterval = null;
          }
          timerState.seconds = 0;
          timerState.isRunning = false;
          timerState.isPaused = false;
          notifyListeners();
        },
        pauseResumeTimer: () => {
          if (!timerState.isRunning) return;
          timerState.isPaused = !timerState.isPaused;
          notifyListeners();
        },
        adjustTimerTime: (seconds: number) => {
          if (!timerState.isRunning && !timerState.isPaused) return;
          timerState.seconds = Math.max(0, timerState.seconds + seconds);
          notifyListeners();
        },
        onTimerUpdate: (callback: (state: any) => void) => {
          callbacks.push(callback);
          // Сразу вызываем callback с текущим состоянием
          callback({ ...timerState });
        },
        onTimerFinished: (callback: () => void) => {
          // Мок для завершения таймера
        },
        removeTimerUpdateListener: () => {
          callbacks.length = 0;
        },
        removeTimerFinishedListener: () => {},
      };
    });

    // Ждем загрузки приложения
    const htmlPath = path.join(__dirname, '../../dist/index.html');
    await page.goto(`file://${htmlPath}`);
    await page.waitForLoadState('domcontentloaded');
    
    // Ждем появления основных элементов
    await page.waitForSelector('#timerDisplay', { timeout: 10000 });
    await page.waitForSelector('#secondsInput', { timeout: 10000 });
    
    // Ждем инициализации приложения
    await page.waitForTimeout(1000);
  });

  test('должен отображать начальное состояние', async ({ page }) => {
    // Проверяем, что таймер показывает 00:00
    await expect(page.locator('#timerDisplay')).toHaveText('00:00');
    
    // Проверяем, что кнопка запуска активна
    await expect(page.locator('#startBtn')).toBeEnabled();
    
    // Проверяем, что кнопки паузы и остановки неактивны
    await expect(page.locator('#pauseBtn')).toBeDisabled();
    await expect(page.locator('#stopBtn')).toBeDisabled();
  });

  test('должен запускать таймер с заданным временем', async ({ page }) => {
    // Устанавливаем время 5 секунд для быстрого теста
    await page.fill('#secondsInput', '5s');
    
    // Запускаем таймер
    await page.click('#startBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(300);
    
    // Проверяем, что кнопка запуска неактивна
    await expect(page.locator('#startBtn')).toBeDisabled();
    
    // Проверяем, что кнопки паузы и остановки активны
    await expect(page.locator('#pauseBtn')).toBeEnabled();
    await expect(page.locator('#stopBtn')).toBeEnabled();
    
    // Проверяем, что поле ввода заблокировано
    await expect(page.locator('#secondsInput')).toBeDisabled();
    
    // Проверяем, что таймер начал отсчет (не 00:00)
    await page.waitForTimeout(500);
    const timerText = await page.locator('#timerDisplay').textContent();
    expect(timerText).not.toBe('00:00');
  });

  test('должен останавливать таймер', async ({ page }) => {
    // Запускаем таймер
    await page.fill('#secondsInput', '10s');
    await page.click('#startBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(300);
    
    // Ждем немного
    await page.waitForTimeout(500);
    
    // Останавливаем таймер
    await page.click('#stopBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(300);
    
    // Проверяем, что таймер остановлен
    await expect(page.locator('#timerDisplay')).toHaveText('00:00');
    
    // Проверяем, что кнопка запуска активна
    await expect(page.locator('#startBtn')).toBeEnabled();
    
    // Проверяем, что поле ввода разблокировано
    await expect(page.locator('#secondsInput')).toBeEnabled();
  });

  test('должен ставить таймер на паузу и возобновлять', async ({ page }) => {
    // Запускаем таймер
    await page.fill('#secondsInput', '30s');
    await page.click('#startBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(500);
    
    // Ставим на паузу
    await page.click('#pauseBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(300);
    
    // Проверяем, что кнопка показывает "Возобновить"
    await expect(page.locator('#pauseBtn')).toHaveText('Возобновить');
    
    // Запоминаем время на паузе
    const pausedTime = await page.locator('#timerDisplay').textContent();
    
    // Ждем немного - время не должно измениться
    await page.waitForTimeout(1000);
    await expect(page.locator('#timerDisplay')).toHaveText(pausedTime!);
    
    // Возобновляем
    await page.click('#pauseBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(300);
    
    // Проверяем, что кнопка показывает "Пауза"
    await expect(page.locator('#pauseBtn')).toHaveText('Пауза');
    
    // Ждем немного - время должно измениться
    await page.waitForTimeout(1500);
    const resumedTime = await page.locator('#timerDisplay').textContent();
    expect(resumedTime).not.toBe(pausedTime);
  });

  test('должен изменять время через кнопки input когда таймер не запущен', async ({ page }) => {
    // Проверяем начальное значение
    await expect(page.locator('#secondsInput')).toHaveValue('1m');
    
    // Кнопки должны быть активны когда таймер не запущен
    await expect(page.locator('#inputAdjustPlus1m')).toBeEnabled();
    
    // Добавляем 1 минуту
    await page.click('#inputAdjustPlus1m');
    await expect(page.locator('#secondsInput')).toHaveValue('2m');
    
    // Добавляем еще 5 минут
    await page.click('#inputAdjustPlus5m');
    await expect(page.locator('#secondsInput')).toHaveValue('7m');
    
    // Вычитаем 2 минуты
    await page.click('#inputAdjustMinus1m');
    await page.click('#inputAdjustMinus1m');
    await expect(page.locator('#secondsInput')).toHaveValue('5m');
  });

  test('должен блокировать кнопки input когда таймер запущен', async ({ page }) => {
    // Запускаем таймер
    await page.fill('#secondsInput', '10s');
    await page.click('#startBtn');
    
    // Кнопки input должны быть заблокированы
    await expect(page.locator('#inputAdjustPlus1m')).toBeDisabled();
    await expect(page.locator('#inputAdjustMinus1m')).toBeDisabled();
  });

  test('должен изменять время запущенного таймера через кнопки изменения времени', async ({ page }) => {
    // Запускаем таймер на 30 секунд
    await page.fill('#secondsInput', '30s');
    await page.click('#startBtn');
    
    await page.waitForTimeout(500);
    
    // Запоминаем текущее время
    const initialTime = await page.locator('#timerDisplay').textContent();
    
    // Добавляем 1 минуту (60 секунд)
    await page.click('#adjustPlus1m');
    
    // Ждем обновления
    await page.waitForTimeout(200);
    
    // Время должно увеличиться
    const newTime = await page.locator('#timerDisplay').textContent();
    expect(newTime).not.toBe(initialTime);
    
    // Вычитаем 30 секунд
    await page.click('#adjustMinus1m');
    await page.waitForTimeout(200);
  });

  test('должен использовать quick links для установки времени', async ({ page }) => {
    // Quick links должны быть активны когда таймер не запущен
    const quickLink = page.locator('.quick-link[data-time="5m"]');
    await expect(quickLink).toBeVisible();
    
    // Кликаем на quick link
    await quickLink.click();
    
    // Проверяем, что значение в input изменилось
    await expect(page.locator('#secondsInput')).toHaveValue('5m');
  });

  test('должен блокировать quick links когда таймер запущен', async ({ page }) => {
    // Запускаем таймер
    await page.fill('#secondsInput', '10s');
    await page.click('#startBtn');
    
    // Ждем обновления UI
    await page.waitForTimeout(300);
    
    // Quick links должны быть неактивны (opacity: 0.5 или pointer-events: none)
    const quickLink = page.locator('.quick-link[data-time="5m"]');
    const pointerEvents = await quickLink.evaluate((el) => window.getComputedStyle(el).pointerEvents);
    const opacity = await quickLink.evaluate((el) => window.getComputedStyle(el).opacity);
    
    // Проверяем, что либо pointer-events: none, либо opacity < 1
    const isDisabled = pointerEvents === 'none' || parseFloat(opacity) < 1;
    expect(isDisabled).toBe(true);
    
    // Попытка кликнуть не должна изменить значение
    const currentValue = await page.locator('#secondsInput').inputValue();
    await quickLink.click({ force: true });
    await page.waitForTimeout(100);
    await expect(page.locator('#secondsInput')).toHaveValue(currentValue);
  });

  test('должен правильно парсить различные форматы времени', async ({ page }) => {
    // Тестируем разные форматы
    const formats = [
      { input: '60s', expected: '60s' },
      { input: '1m', expected: '1m' },
      { input: '1h', expected: '1h' },
      { input: '90s', expected: '90s' },
    ];
    
    for (const format of formats) {
      await page.fill('#secondsInput', format.input);
      await page.click('#startBtn');
      
      // Проверяем, что таймер запустился (кнопка запуска неактивна)
      await expect(page.locator('#startBtn')).toBeDisabled();
      
      // Останавливаем для следующего теста
      await page.click('#stopBtn');
      await page.waitForTimeout(100);
    }
  });

  test('должен показывать статус таймера', async ({ page }) => {
    // Проверяем начальный статус
    const status = page.locator('#status');
    
    // Запускаем таймер
    await page.fill('#secondsInput', '10s');
    await page.click('#startBtn');
    
    // Проверяем статус "Таймер запущен..."
    await expect(status).toContainText('Таймер запущен');
    
    // Ставим на паузу
    await page.click('#pauseBtn');
    await expect(status).toContainText('Таймер на паузе');
    
    // Останавливаем
    await page.click('#stopBtn');
    await expect(status).toContainText('Таймер остановлен');
  });

  test('должен блокировать кнопки изменения времени когда таймер не запущен', async ({ page }) => {
    // Кнопки изменения времени запущенного таймера должны быть заблокированы
    await expect(page.locator('#adjustPlus1m')).toBeDisabled();
    await expect(page.locator('#adjustMinus1m')).toBeDisabled();
    
    // Запускаем таймер
    await page.fill('#secondsInput', '10s');
    await page.click('#startBtn');
    
    // Теперь кнопки должны быть активны
    await expect(page.locator('#adjustPlus1m')).toBeEnabled();
    await expect(page.locator('#adjustMinus1m')).toBeEnabled();
  });

  test('должен работать с большими значениями времени', async ({ page }) => {
    // Устанавливаем большое время (2 часа)
    await page.fill('#secondsInput', '2h');
    await page.click('#startBtn');
    
    // Проверяем, что таймер запустился
    await expect(page.locator('#startBtn')).toBeDisabled();
    
    // Проверяем, что отображается время (не 00:00)
    const timerText = await page.locator('#timerDisplay').textContent();
    expect(timerText).not.toBe('00:00');
    
    // Останавливаем
    await page.click('#stopBtn');
  });
});

