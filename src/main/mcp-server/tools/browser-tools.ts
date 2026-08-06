/**
 * MCP Tools: 浏览器操作工具集
 * 由服务端 agent 通过 MCP bridge 调用，执行具体的浏览器操作
 * LLM 推理在服务端，客户端只负责执行浏览器动作
 */

import { z } from 'zod';

// 获取当前浏览器页面
async function getCurrentPage(profileId?: string) {
  const autoBrowser = await import('../../auto-browser/index.js');
  const mod = autoBrowser as any;

  // 优先获取现有页面
  const existingPage = await mod.getBrowserPage?.(0, { profileId });
  if (existingPage) return existingPage;

  // 创建新页面
  const newPage = await mod.createBrowserPage?.({ profileId });
  if (!newPage) throw new Error('没有可用的浏览器页面，请先在客户端连接浏览器');
  return newPage;
}

// 工具定义
export const browserTools = [
  {
    name: 'browser_navigate',
    description: '导航到指定的网页 URL',
    schema: {
      url: z.string().describe('要导航到的 URL'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { url: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      await page.goto(args.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      const title = await page.title();
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, url: args.url, title }) }],
      };
    },
  },
  {
    name: 'browser_click',
    description: '点击页面上的元素（支持 CSS 选择器或文本内容）',
    schema: {
      selector: z.string().describe('CSS 选择器或文本内容'),
      textSelector: z.boolean().optional().describe('是否按文本内容查找元素'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { selector: string; textSelector?: boolean; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      if (args.textSelector) {
        await page.getByText(args.selector, { exact: false }).first().click({ timeout: 10000 });
      } else {
        await page.locator(args.selector).first().click({ timeout: 10000 });
      }
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, clicked: args.selector }) }],
      };
    },
  },
  {
    name: 'browser_type',
    description: '在输入框中输入文本',
    schema: {
      selector: z.string().describe('输入框的 CSS 选择器'),
      text: z.string().describe('要输入的文本'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { selector: string; text: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      await page.locator(args.selector).first().fill(args.text);
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, typed: args.text, into: args.selector }) }],
      };
    },
  },
  {
    name: 'browser_get_text',
    description: '获取页面元素的文本内容',
    schema: {
      selector: z.string().describe('元素的 CSS 选择器'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { selector: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const text = await page.locator(args.selector).first().textContent();
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, text }) }],
      };
    },
  },
  {
    name: 'browser_screenshot',
    description: '对当前页面截图',
    schema: {
      fullPage: z.boolean().optional().describe('是否截取整个页面'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { fullPage?: boolean; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const buffer = await page.screenshot({ fullPage: args.fullPage || false, type: 'png' });
      const base64 = buffer.toString('base64');
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, screenshot: `data:image/png;base64,${base64}` }) }],
      };
    },
  },
  {
    name: 'browser_get_url',
    description: '获取当前页面的 URL 和标题',
    schema: {
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const url = page.url();
      const title = await page.title();
      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, url, title }) }],
      };
    },
  },
  {
    name: 'browser_wait',
    description: '等待页面元素出现或等待指定时间',
    schema: {
      selector: z.string().optional().describe('等待出现的元素 CSS 选择器'),
      ms: z.number().optional().describe('等待的毫秒数'),
      timeout: z.number().optional().describe('超时时间（毫秒），默认 10000'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { selector?: string; ms?: number; timeout?: number; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      if (args.selector) {
        await page.waitForSelector(args.selector, { timeout: args.timeout || 10000 });
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, found: args.selector }) }] };
      }
      if (args.ms) {
        await page.waitForTimeout(args.ms);
        return { content: [{ type: 'text', text: JSON.stringify({ success: true, waited: args.ms }) }] };
      }
      return { content: [{ type: 'text', text: JSON.stringify({ success: false, error: '需要指定 selector 或 ms' }) }], isError: true };
    },
  },
  {
    name: 'browser_scroll',
    description: '滚动页面',
    schema: {
      direction: z.enum(['up', 'down', 'top', 'bottom']).optional().describe('滚动方向'),
      pixels: z.number().optional().describe('滚动像素数'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { direction?: string; pixels?: number; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const direction = args.direction || 'down';
      const pixels = args.pixels || 500;
      await page.evaluate(
        ({ dir, px }) => {
          if (dir === 'top') window.scrollTo(0, 0);
          else if (dir === 'bottom') window.scrollTo(0, document.body.scrollHeight);
          else if (dir === 'up') window.scrollBy(0, -px);
          else window.scrollBy(0, px);
        },
        { dir: direction, px: pixels }
      );
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, scrolled: direction }) }] };
    },
  },
  {
    name: 'browser_hover',
    description: '将鼠标悬停在元素上',
    schema: {
      selector: z.string().describe('元素的 CSS 选择器'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { selector: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      await page.locator(args.selector).first().hover({ timeout: 5000 });
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, hovered: args.selector }) }] };
    },
  },
  {
    name: 'browser_press_key',
    description: '按下键盘按键（Enter, Tab, Escape 等）',
    schema: {
      key: z.string().describe('按键名称，如 Enter, Tab, Escape'),
      selector: z.string().optional().describe('可选：在指定元素上按键'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { key: string; selector?: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      if (args.selector) {
        await page.locator(args.selector).first().press(args.key);
      } else {
        await page.keyboard.press(args.key);
      }
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, pressed: args.key }) }] };
    },
  },
  {
    name: 'browser_select',
    description: '在下拉框中选择选项',
    schema: {
      selector: z.string().describe('下拉框的 CSS 选择器'),
      value: z.string().optional().describe('按 value 选择'),
      label: z.string().optional().describe('按 label 选择'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { selector: string; value?: string; label?: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const locator = page.locator(args.selector).first();
      if (args.value) {
        await locator.selectOption({ value: args.value });
      } else if (args.label) {
        await locator.selectOption({ label: args.label });
      }
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, selected: args.value || args.label }) }] };
    },
  },
  {
    name: 'browser_eval',
    description: '在页面中执行 JavaScript 代码',
    schema: {
      script: z.string().describe('要执行的 JavaScript 代码'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { script: string; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const result = await page.evaluate(args.script);
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, result }) }] };
    },
  },
  {
    name: 'browser_scrape_list',
    description: '批量采集页面中多个元素的文本和属性',
    schema: {
      itemSelector: z.string().describe('列表项的 CSS 选择器'),
      fields: z.array(z.object({
        name: z.string().describe('字段名'),
        selector: z.string().describe('字段的 CSS 选择器'),
        attribute: z.string().optional().describe('属性名，默认为 textContent'),
      })).describe('要采集的字段列表'),
      profileId: z.string().optional().describe('浏览器配置文件 ID'),
    },
    async execute(args: { itemSelector: string; fields: Array<{ name: string; selector: string; attribute?: string }>; profileId?: string }) {
      const page = await getCurrentPage(args.profileId);
      const result = await page.evaluate(
        ({ itemSel, fields }) => {
          const items = Array.from(document.querySelectorAll(itemSel));
          return items.map((item) => {
            const data: Record<string, any> = {};
            for (const field of fields) {
              const el = item.querySelector(field.selector);
              if (field.attribute && field.attribute !== 'textContent') {
                data[field.name] = el?.getAttribute(field.attribute) || null;
              } else {
                data[field.name] = el?.textContent?.trim() || null;
              }
            }
            return data;
          });
        },
        { itemSel: args.itemSelector, fields: args.fields }
      );
      return { content: [{ type: 'text', text: JSON.stringify({ success: true, items: result, count: result.length }) }] };
    },
  },
];

// 导出工具映射
export const browserToolMap = new Map(browserTools.map((t) => [t.name, t]));
