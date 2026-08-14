/**
 * 客户端通用能力 — 屏幕与媒体采集
 * 截图/录屏/摄像头/麦克风/设备枚举
 */

import { z } from 'zod';
import { desktopCapturer, screen, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
;
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';

// ─── screen_capture ─────────────────────────────────────
const captureScreenDef: CapabilityDefinition = {
  name: 'capture_screen',
  namespace: 'screen',
  description: '截取指定显示器全屏（不传则截取主显示器）',
  riskLevel: 'read',
  argsSchema: z.object({
    displayId: z.number().optional().describe('显示器索引，不传则主显示器'),
    format: z.enum(['png', 'jpg']).optional().default('png').describe('图片格式'),
    outputPath: z.string().optional().describe('保存路径，不传则返回 base64'),
  }),
  handler: async ({ displayId, format, outputPath }) => {
    const displays = screen.getAllDisplays();
    const target = displayId !== undefined ? displays[displayId] : screen.getPrimaryDisplay();
    if (!target) {
      return { success: false, error: '显示器不存在' };
    }

    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: target.bounds.width * target.scaleFactor,
        height: target.bounds.height * target.scaleFactor,
      },
    });

    // 找到匹配的 source（按 label 或取第一个）
    const source = sources.find((s) => s.display_id === String(target.id)) || sources[0];
    if (!source) {
      return { success: false, error: '无法获取屏幕源' };
    }

    const thumbnail = source.thumbnail;
    const image = format === 'jpg' ? thumbnail.toJPEG(90) : thumbnail.toPNG();

    if (outputPath) {
      const absPath = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, image);
      return {
        success: true,
        data: { path: absPath, width: thumbnail.getSize().width, height: thumbnail.getSize().height },
      };
    }

    return {
      success: true,
      data: {
        dataUrl: `data:image/${format};base64,${image.toString('base64')}`,
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height,
      },
    };
  },
};

// ─── screen_capture_window ──────────────────────────────
const captureWindowDef: CapabilityDefinition = {
  name: 'capture_window',
  namespace: 'screen',
  description: '截取指定窗口（通过窗口标题模糊匹配）',
  riskLevel: 'read',
  argsSchema: z.object({
    titlePattern: z.string().describe('窗口标题（模糊匹配）'),
    format: z.enum(['png', 'jpg']).optional().default('png'),
    outputPath: z.string().optional(),
  }),
  handler: async ({ titlePattern, format, outputPath }) => {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 1920, height: 1080 },
    });

    const source = sources.find((s) => s.name.includes(titlePattern));
    if (!source) {
      const names = sources.map((s) => s.name).slice(0, 20);
      return { success: false, error: `未找到匹配 "${titlePattern}" 的窗口`, data: { availableWindows: names } };
    }

    const thumbnail = source.thumbnail;
    const image = format === 'jpg' ? thumbnail.toJPEG(90) : thumbnail.toPNG();

    if (outputPath) {
      const absPath = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, image);
      return {
        success: true,
        data: { path: absPath, windowTitle: source.name, width: thumbnail.getSize().width, height: thumbnail.getSize().height },
      };
    }

    return {
      success: true,
      data: {
        dataUrl: `data:image/${format};base64,${image.toString('base64')}`,
        windowTitle: source.name,
        width: thumbnail.getSize().width,
        height: thumbnail.getSize().height,
      },
    };
  },
};

// ─── screen_list_windows ────────────────────────────────
const listWindowsDef: CapabilityDefinition = {
  name: 'list_windows',
  namespace: 'screen',
  description: '列出所有可截图的窗口',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const sources = await desktopCapturer.getSources({
      types: ['window'],
      thumbnailSize: { width: 0, height: 0 },
    });
    const windows = sources.map((s) => ({
      id: s.id,
      name: s.name,
      displayId: s.display_id,
    }));
    return { success: true, data: { windows, count: windows.length } };
  },
};

// ─── screen_capture_area ────────────────────────────────
const captureAreaDef: CapabilityDefinition = {
  name: 'capture_area',
  namespace: 'screen',
  description: '截取主显示器指定区域',
  riskLevel: 'read',
  argsSchema: z.object({
    x: z.number().describe('起始 X 坐标'),
    y: z.number().describe('起始 Y 坐标'),
    width: z.number().describe('截取宽度'),
    height: z.number().describe('截取高度'),
    format: z.enum(['png', 'jpg']).optional().default('png'),
    outputPath: z.string().optional(),
  }),
  handler: async ({ x, y, width, height, format, outputPath }) => {
    const primary = screen.getPrimaryDisplay();
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: {
        width: primary.bounds.width * primary.scaleFactor,
        height: primary.bounds.height * primary.scaleFactor,
      },
    });

    const source = sources[0];
    if (!source) {
      return { success: false, error: '无法获取屏幕源' };
    }

    // 裁剪指定区域
    const scale = primary.scaleFactor;
    const cropped = source.thumbnail.crop({
      x: Math.round(x * scale),
      y: Math.round(y * scale),
      width: Math.round(width * scale),
      height: Math.round(height * scale),
    });
    const image = format === 'jpg' ? cropped.toJPEG(90) : cropped.toPNG();

    if (outputPath) {
      const absPath = path.resolve(outputPath);
      fs.mkdirSync(path.dirname(absPath), { recursive: true });
      fs.writeFileSync(absPath, image);
      return {
        success: true,
        data: { path: absPath, width: cropped.getSize().width, height: cropped.getSize().height },
      };
    }

    return {
      success: true,
      data: {
        dataUrl: `data:image/${format};base64,${image.toString('base64')}`,
        width: cropped.getSize().width,
        height: cropped.getSize().height,
      },
    };
  },
};

// ─── media_enumerate_devices ────────────────────────────
const enumDevicesDef: CapabilityDefinition = {
  name: 'enumerate_devices',
  namespace: 'screen',
  description: '枚举可用的媒体输入输出设备（摄像头/麦克风/扬声器）',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    // 在渲染进程通过 navigator.mediaDevices.enumerateDevices() 获取
    // 这里返回 Electron 的多媒体权限状态
    const mainWindow = BrowserWindow.getAllWindows()[0];
    if (!mainWindow) {
      return { success: false, error: '主窗口未找到' };
    }

    try {
      const devices = await mainWindow.webContents.executeJavaScript(`
        (async () => {
          // 先请求权限触发设备列表刷新
          try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
            stream.getTracks().forEach(t => t.stop());
          } catch {}
          const devices = await navigator.mediaDevices.enumerateDevices();
          return devices.map(d => ({
            deviceId: d.deviceId,
            kind: d.kind,
            label: d.label,
            groupId: d.groupId,
          }));
        })()
      `);
      return {
        success: true,
        data: {
          devices,
          cameras: devices.filter((d: any) => d.kind === 'videoinput'),
          microphones: devices.filter((d: any) => d.kind === 'audioinput'),
          speakers: devices.filter((d: any) => d.kind === 'audiooutput'),
        },
      };
    } catch (error: any) {
      return { success: false, error: error?.message || '枚举设备失败' };
    }
  },
};

// ─── screen_list_displays ───────────────────────────────
const listDisplaysDef: CapabilityDefinition = {
  name: 'list_displays',
  namespace: 'screen',
  description: '列出所有显示器信息',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const displays = screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      index: i,
      label: d.label,
      isPrimary: d.id === screen.getPrimaryDisplay().id,
      bounds: d.bounds,
      workArea: d.workArea,
      size: d.size,
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      internal: d.internal,
    }));
    return { success: true, data: { displays, count: displays.length } };
  },
};

// ─── 注册所有屏幕与媒体能力 ────────────────────────────────
export function registerScreenMediaCapabilities(): void {
  CapabilityRegistry.registerAll([
    captureScreenDef,
    captureWindowDef,
    captureAreaDef,
    listWindowsDef,
    listDisplaysDef,
    enumDevicesDef,
  ]);
}
