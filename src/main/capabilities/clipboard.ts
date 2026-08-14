/**
 * 客户端通用能力 — 剪贴板
 * 读写文本、图片、文件列表
 */

import { z } from 'zod';
import { clipboard, nativeImage } from 'electron';
import fs from 'fs';
;
;
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';

// ─── clipboard_read_text ────────────────────────────────
const readTextDef: CapabilityDefinition = {
  name: 'read_text',
  namespace: 'clipboard',
  description: '读取剪贴板文本内容',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const text = clipboard.readText();
    return { success: true, data: { text } };
  },
};

// ─── clipboard_write_text ───────────────────────────────
const writeTextDef: CapabilityDefinition = {
  name: 'write_text',
  namespace: 'clipboard',
  description: '写入文本到剪贴板',
  riskLevel: 'write',
  argsSchema: z.object({
    text: z.string().describe('要写入的文本'),
  }),
  handler: async ({ text }) => {
    clipboard.writeText(text);
    return { success: true, data: { length: text.length } };
  },
};

// ─── clipboard_read_image ───────────────────────────────
const readImageDef: CapabilityDefinition = {
  name: 'read_image',
  namespace: 'clipboard',
  description: '读取剪贴板图片（返回 base64 数据 URL）',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const image = clipboard.readImage();
    if (image.isEmpty()) {
      return { success: false, error: '剪贴板中没有图片' };
    }
    const pngData = image.toDataURL();
    const size = image.getSize();
    return {
      success: true,
      data: {
        dataUrl: pngData,
        width: size.width,
        height: size.height,
      },
    };
  },
};

// ─── clipboard_write_image ──────────────────────────────
const writeImageDef: CapabilityDefinition = {
  name: 'write_image',
  namespace: 'clipboard',
  description: '写入图片到剪贴板（支持 base64 或本地路径）',
  riskLevel: 'write',
  argsSchema: z.object({
    data: z.string().describe('图片 base64 数据（含 data: 前缀）或本地文件路径'),
  }),
  handler: async ({ data }) => {
    let image: Electron.NativeImage;
    if (data.startsWith('data:')) {
      // base64 data URL
      const base64 = data.replace(/^data:image\/\w+;base64,/, '');
      image = nativeImage.createFromBuffer(Buffer.from(base64, 'base64'));
    } else if (fs.existsSync(data)) {
      image = nativeImage.createFromPath(data);
    } else {
      return { success: false, error: '无效的图片数据或路径' };
    }
    if (image.isEmpty()) {
      return { success: false, error: '无法解析图片' };
    }
    clipboard.writeImage(image);
    const size = image.getSize();
    return { success: true, data: { width: size.width, height: size.height } };
  },
};

// ─── clipboard_read_files ───────────────────────────────
const readFilesDef: CapabilityDefinition = {
  name: 'read_files',
  namespace: 'clipboard',
  description: '读取剪贴板中的文件路径列表（如复制的文件）',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    // Electron 不直接暴露文件列表，通过读取系统剪贴板格式
    const formats = clipboard.availableFormats();
    const files: string[] = [];

    // macOS: public.file-url, Windows: FileNameW
    if (formats.includes('public.file-url') || formats.includes('FileNameW')) {
      // 尝试通过 readBuffer 读取
      try {
        if (process.platform === 'darwin') {
          const buffer = clipboard.readBuffer('public.file-url');
          const url = buffer.toString('utf8').trim();
          if (url.startsWith('file://')) {
            files.push(decodeURIComponent(url.replace('file://', '')));
          }
        }
      } catch {
        // fallback
      }
    }

    // 尝试 readText 获取路径（某些场景下有效）
    const text = clipboard.readText();
    if (text && !text.includes(' ') && (text.startsWith('/') || /^[A-Z]:\\/.test(text))) {
      const paths = text.split('\n').filter(p => fs.existsSync(p.trim()));
      files.push(...paths.map(p => p.trim()));
    }

    return {
      success: true,
      data: {
        files: [...new Set(files)],
        formats,
      },
    };
  },
};

// ─── clipboard_clear ────────────────────────────────────
const clearDef: CapabilityDefinition = {
  name: 'clear',
  namespace: 'clipboard',
  description: '清空剪贴板',
  riskLevel: 'write',
  argsSchema: z.object({}),
  handler: async () => {
    clipboard.clear();
    return { success: true, data: {} };
  },
};

// ─── 注册所有剪贴板能力 ──────────────────────────────────
export function registerClipboardCapabilities(): void {
  CapabilityRegistry.registerAll([
    readTextDef,
    writeTextDef,
    readImageDef,
    writeImageDef,
    readFilesDef,
    clearDef,
  ]);
}
