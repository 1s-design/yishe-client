/**
 * 反检测工具函数
 */

import { logger } from './logger.js';

/**
 * 随机延迟
 */
export function randomDelay(min = 1000, max = 3000) {
  const delay = Math.floor(Math.random() * (max - min + 1)) + min;
  return new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * 模拟人类输入
 */
export async function humanType(page, selector, text, options = {}) {
  const { delay = 100, clearFirst = true } = options;
  
  if (clearFirst) {
    await page.click(selector, { clickCount: 3 });
  }
  
  for (const char of text) {
    await page.type(selector, char, { delay: delay + Math.random() * 50 });
  }
}

/**
 * 模拟人类点击
 */
export async function humanClick(page, selector, options = {}) {
  const { delay = 500 } = options;
  
  // 先悬停
  await page.hover(selector);
  await randomDelay(100, 300);
  
  // 点击
  await page.click(selector);
  await randomDelay(delay, delay + 500);
}

/**
 * 随机滚动
 */
export async function randomScroll(page) {
  const scrollDistance = Math.floor(Math.random() * 500) + 200;
  await page.evaluate((distance) => {
    window.scrollBy(0, distance);
  }, scrollDistance);
  
  await randomDelay(500, 1500);
}

/**
 * 模拟鼠标移动
 */
export async function simulateMouseMove(page) {
  await page.mouse.move(
    Math.floor(Math.random() * 800) + 100,
    Math.floor(Math.random() * 600) + 100
  );
  await randomDelay(100, 500);
}

/**
 * 获取随机User-Agent
 */
export function getRandomUserAgent() {
  const userAgents = [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:109.0) Gecko/20100101 Firefox/121.0'
  ];
  
  return userAgents[Math.floor(Math.random() * userAgents.length)];
}

/**
 * 设置随机视口
 */
export async function setRandomViewport(page) {
  const viewports = [
    { width: 1920, height: 1080 },
    { width: 1366, height: 768 },
    { width: 1440, height: 900 },
    { width: 1536, height: 864 }
  ];
  
  const viewport = viewports[Math.floor(Math.random() * viewports.length)];
  await page.setViewport(viewport);
  
  logger.debug('设置随机视口:', viewport);
}

/**
 * 等待元素出现并稳定
 */
export async function waitForElementStable(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout });
  
  // 等待元素稳定
  await page.waitForFunction((sel) => {
    const element = document.querySelector(sel);
    return element && element.offsetHeight > 0 && element.offsetWidth > 0;
  }, { timeout }, selector);
  
  await randomDelay(500, 1000);
}

/**
 * 检查元素是否可见
 */
export async function isElementVisible(page, selector) {
  return await page.evaluate((sel) => {
    const element = document.querySelector(sel);
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0' &&
           element.offsetHeight > 0 &&
           element.offsetWidth > 0;
  }, selector);
}

/**
 * 等待网络空闲
 */
export async function waitForNetworkIdle(page, timeout = 30000) {
  try {
    await page.waitForLoadState('networkidle', { timeout });
  } catch (error) {
    logger.warn('等待网络空闲超时:', error.message);
  }
}

/**
 * 模拟真实用户行为
 */
export async function simulateRealUserBehavior(page) {
  // 随机滚动
  await randomScroll(page);
  
  // 模拟鼠标移动
  await simulateMouseMove(page);
  
  // 随机延迟
  await randomDelay(1000, 3000);
}
