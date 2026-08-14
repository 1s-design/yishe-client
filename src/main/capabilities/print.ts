/**
 * 客户端通用能力 — 打印
 * 列出打印机/打印文件/打印图片
 */

import { z } from 'zod';
import { BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';

// ─── printer_list ───────────────────────────────────────
const printerListDef: CapabilityDefinition = {
  name: 'list',
  namespace: 'print',
  description: '获取系统打印机列表',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      return { success: false, error: '主窗口未找到' };
    }
    // Electron 35+ 使用 getPrintersAsync
    const printers = await (mainWindow.webContents as any).getPrintersAsync?.() 
      
      || [];
    return {
      success: true,
      data: {
        printers: printers.map((p: any) => ({
          name: p.name,
          description: p.description,
          status: p.status,
          isDefault: p.isDefault,
          options: p.options,
        })),
        count: printers.length,
      },
    };
  },
};

// ─── print_file ─────────────────────────────────────────
const printFileDef: CapabilityDefinition = {
  name: 'print_file',
  namespace: 'print',
  description: '打印指定文件（PDF/图片）',
  riskLevel: 'write',
  argsSchema: z.object({
    filePath: z.string().describe('文件路径（PDF 或图片）'),
    printerName: z.string().optional().describe('打印机名称，不传则使用默认打印机'),
    silent: z.boolean().optional().default(true).describe('是否静默打印（不显示对话框）'),
    copies: z.number().optional().default(1).describe('打印份数'),
    paperSize: z.string().optional().describe('纸张尺寸，如 A4/Letter'),
    landscape: z.boolean().optional().default(false).describe('是否横向'),
    color: z.boolean().optional().default(true).describe('是否彩色打印'),
  }),
  handler: async ({ filePath, printerName, silent, copies, paperSize, landscape, color }) => {
    if (!fs.existsSync(filePath)) {
      return { success: false, error: `文件不存在: ${filePath}` };
    }

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    });

    const ext = path.extname(filePath).toLowerCase();
    const isImage = ['.png', '.jpg', '.jpeg', '.gif', '.bmp', '.webp'].includes(ext);

    return new Promise((resolve) => {
      const printOptions: Record<string, any> = {
        silent,
        printBackground: true,
        deviceName: printerName || undefined,
        copies,
        landscape,
        color,
      };

      if (paperSize) {
        printOptions.pageSize = paperSize;
      }

      if (isImage) {
        const base64 = fs.readFileSync(filePath, 'base64');
        const mimeType = ext === '.png' ? 'png' : ext === '.gif' ? 'gif' : 'jpeg';
        const html = `<!DOCTYPE html><html><body style="margin:0;display:flex;align-items:center;justify-content:center;">
          <img src="data:image/${mimeType};base64,${base64}" style="max-width:100%;max-height:100vh;" />
        </body></html>`;
        printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      } else {
        printWindow.loadURL(`file://${filePath}`);
      }

      printWindow.webContents.on('did-finish-load', () => {
        printWindow.webContents.print(printOptions, (success, errorType) => {
          printWindow.close();
          if (success) {
            resolve({ success: true, data: { filePath, printer: printerName || 'default', copies } });
          } else {
            resolve({ success: false, error: `打印失败: ${errorType}` });
          }
        });
      });

      printWindow.webContents.on('did-fail-load', () => {
        printWindow.close();
        resolve({ success: false, error: `加载文件失败` });
      });

      setTimeout(() => {
        if (!printWindow.isDestroyed()) {
          printWindow.close();
          resolve({ success: false, error: '打印超时' });
        }
      }, 30000);
    });
  },
};

// ─── print_html ─────────────────────────────────────────
const printHtmlDef: CapabilityDefinition = {
  name: 'print_html',
  namespace: 'print',
  description: '打印 HTML 内容（生成票据/标签等）',
  riskLevel: 'write',
  argsSchema: z.object({
    html: z.string().describe('HTML 内容'),
    printerName: z.string().optional().describe('打印机名称'),
    silent: z.boolean().optional().default(true).describe('是否静默打印'),
    copies: z.number().optional().default(1).describe('打印份数'),
    paperSize: z.string().optional().describe('纸张尺寸'),
    landscape: z.boolean().optional().default(false).describe('是否横向'),
    margins: z.object({
      top: z.number().optional(),
      bottom: z.number().optional(),
      left: z.number().optional(),
      right: z.number().optional(),
    }).optional().describe('边距（毫米）'),
  }),
  handler: async ({ html, printerName, silent, copies, paperSize, landscape, margins }) => {
    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    });

    return new Promise((resolve) => {
      const printOptions: Record<string, any> = {
        silent,
        printBackground: true,
        deviceName: printerName || undefined,
        copies,
        landscape,
        margins: margins ? { type: 'custom', ...margins } : undefined,
      };

      if (paperSize) {
        printOptions.pageSize = paperSize;
      }

      printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);

      printWindow.webContents.on('did-finish-load', () => {
        printWindow.webContents.print(printOptions, (success, errorType) => {
          printWindow.close();
          if (success) {
            resolve({ success: true, data: { printer: printerName || 'default', copies } });
          } else {
            resolve({ success: false, error: `打印失败: ${errorType}` });
          }
        });
      });

      printWindow.webContents.on('did-fail-load', () => {
        printWindow.close();
        resolve({ success: false, error: '加载 HTML 失败' });
      });

      setTimeout(() => {
        if (!printWindow.isDestroyed()) {
          printWindow.close();
          resolve({ success: false, error: '打印超时' });
        }
      }, 30000);
    });
  },
};

// ─── print_pdf ──────────────────────────────────────────
const printPdfDef: CapabilityDefinition = {
  name: 'print_pdf',
  namespace: 'print',
  description: '生成 PDF（从 HTML 或 URL）',
  riskLevel: 'write',
  argsSchema: z.object({
    html: z.string().optional().describe('HTML 内容（与 url 二选一）'),
    url: z.string().optional().describe('URL（与 html 二选一）'),
    outputPath: z.string().describe('输出 PDF 路径'),
    landscape: z.boolean().optional().default(false).describe('是否横向'),
    printBackground: z.boolean().optional().default(true).describe('是否打印背景'),
    paperSize: z.enum(['A4', 'A5', 'Letter', 'Legal']).optional().default('A4').describe('纸张尺寸'),
  }),
  handler: async ({ html, url, outputPath, landscape, printBackground, paperSize }) => {
    if (!html && !url) {
      return { success: false, error: 'html 和 url 至少提供一个' };
    }

    const printWindow = new BrowserWindow({
      show: false,
      webPreferences: { offscreen: true },
    });

    return new Promise((resolve) => {
      const paperMap: Record<string, { width: number; height: number }> = {
        A4: { width: 210, height: 297 },
        A5: { width: 148, height: 210 },
        Letter: { width: 215.9, height: 279.4 },
        Legal: { width: 215.9, height: 355.6 },
      };

      const size = paperMap[paperSize] || paperMap.A4;

      const doPrint = async () => {
        try {
          const data = await printWindow.webContents.printToPDF({
            landscape,
            printBackground,
            pageSize: { width: size.width * 2.834, height: size.height * 2.834 },
            marginsType: 0,
          } as any);
          const absPath = path.resolve(outputPath);
          fs.mkdirSync(path.dirname(absPath), { recursive: true });
          fs.writeFileSync(absPath, data);
          printWindow.close();
          resolve({ success: true, data: { path: absPath, size: data.length } });
        } catch (err: any) {
          printWindow.close();
          resolve({ success: false, error: err?.message || '生成 PDF 失败' });
        }
      };

      printWindow.webContents.on('did-finish-load', doPrint);
      printWindow.webContents.on('did-fail-load', () => {
        printWindow.close();
        resolve({ success: false, error: '加载内容失败' });
      });

      if (html) {
        printWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
      } else {
        printWindow.loadURL(url!);
      }

      setTimeout(() => {
        if (!printWindow.isDestroyed()) {
          printWindow.close();
          resolve({ success: false, error: '生成 PDF 超时' });
        }
      }, 30000);
    });
  },
};

// ─── 注册所有打印能力 ──────────────────────────────────
export function registerPrintCapabilities(): void {
  CapabilityRegistry.registerAll([
    printerListDef,
    printFileDef,
    printHtmlDef,
    printPdfDef,
  ]);
}
