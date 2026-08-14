/**
 * 客户端通用能力 — 系统信息
 * OS/CPU/内存/屏幕/IP/MAC/环境变量/工作目录
 */

import { z } from 'zod';
import os from 'os';
import { app, screen } from 'electron';
import fs from 'fs';
;
import { CapabilityRegistry } from './registry';
import type { CapabilityDefinition } from './types';

// ─── sys_info ───────────────────────────────────────────
const sysInfoDef: CapabilityDefinition = {
  name: 'info',
  namespace: 'system',
  description: '获取系统基本信息（OS/CPU/内存/主机名/运行时间）',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    return {
      success: true,
      data: {
        platform: process.platform,
        arch: process.arch,
        osVersion: os.release(),
        hostname: os.hostname(),
        uptime: os.uptime(),
        cpu: {
          model: os.cpus()[0]?.model || 'unknown',
          cores: os.cpus().length,
          loadavg: os.loadavg(),
        },
        memory: {
          total: totalMem,
          free: freeMem,
          used: totalMem - freeMem,
          usagePercent: Math.round(((totalMem - freeMem) / totalMem) * 100),
        },
        nodeVersion: process.version,
        electronVersion: process.versions.electron,
        appVersion: app.getVersion(),
      },
    };
  },
};

// ─── sys_screen_info ────────────────────────────────────
const screenInfoDef: CapabilityDefinition = {
  name: 'screen_info',
  namespace: 'system',
  description: '获取显示器信息（分辨率/缩放/多屏）',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const displays = screen.getAllDisplays().map((d, i) => ({
      id: d.id,
      index: i,
      label: d.label,
      bounds: d.bounds,
      size: d.size,
      scaleFactor: d.scaleFactor,
      rotation: d.rotation,
      internal: d.internal,
      touchSupport: d.touchSupport,
    }));
    const primary = screen.getPrimaryDisplay();
    return {
      success: true,
      data: {
        displays,
        primary: {
          id: primary.id,
          bounds: primary.bounds,
          size: primary.size,
          scaleFactor: primary.scaleFactor,
        },
      },
    };
  },
};

// ─── sys_local_ip ───────────────────────────────────────
const localIpDef: CapabilityDefinition = {
  name: 'local_ip',
  namespace: 'system',
  description: '获取本机 IP 地址（IPv4/IPv6）',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const interfaces = os.networkInterfaces();
    const result: Array<{ name: string; address: string; family: string; internal: boolean; mac: string }> = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs || []) {
        result.push({
          name,
          address: addr.address,
          family: addr.family,
          internal: addr.internal,
          mac: addr.mac,
        });
      }
    }
    return {
      success: true,
      data: {
        interfaces: result,
        primary: result.find((r) => !r.internal && r.family === 'IPv4') || null,
      },
    };
  },
};

// ─── sys_mac_address ────────────────────────────────────
const macAddressDef: CapabilityDefinition = {
  name: 'mac_address',
  namespace: 'system',
  description: '获取网卡 MAC 地址列表',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const interfaces = os.networkInterfaces();
    const macs: Array<{ name: string; mac: string; internal: boolean }> = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
      for (const addr of addrs || []) {
        if (addr.mac && addr.mac !== '00:00:00:00:00:00') {
          macs.push({ name, mac: addr.mac, internal: addr.internal });
        }
      }
    }
    return { success: true, data: { macs } };
  },
};

// ─── sys_env ────────────────────────────────────────────
const envDef: CapabilityDefinition = {
  name: 'env',
  namespace: 'system',
  description: '读取环境变量（不传 key 则返回全部）',
  riskLevel: 'read',
  argsSchema: z.object({
    key: z.string().optional().describe('环境变量名，不传则返回全部'),
  }),
  handler: async ({ key }) => {
    if (key) {
      const value = process.env[key];
      if (value === undefined) {
        return { success: false, error: `环境变量不存在: ${key}` };
      }
      return { success: true, data: { key, value } };
    }
    // 返回全部（过滤敏感信息）
    const safeEnv: Record<string, string> = {};
    const sensitiveKeys = ['SECRET', 'TOKEN', 'PASSWORD', 'KEY', 'PRIVATE'];
    for (const [k, v] of Object.entries(process.env)) {
      if (v === undefined) continue;
      const isSensitive = sensitiveKeys.some((sk) => k.toUpperCase().includes(sk));
      safeEnv[k] = isSensitive ? '***' : v;
    }
    return { success: true, data: { env: safeEnv, count: Object.keys(safeEnv).length } };
  },
};

// ─── sys_disk_info ──────────────────────────────────────
const diskInfoDef: CapabilityDefinition = {
  name: 'disk_info',
  namespace: 'system',
  description: '获取磁盘空间信息（仅 macOS/Linux）',
  riskLevel: 'read',
  argsSchema: z.object({
    path: z.string().optional().describe('要检查的路径，默认根目录'),
  }),
  handler: async ({ path: checkPath }) => {
    const targetPath = checkPath || (process.platform === 'win32' ? 'C:\\' : '/');
    try {
      const stats = fs.statfsSync(targetPath);
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      const used = total - free;
      return {
        success: true,
        data: {
          path: targetPath,
          total,
          free,
          used,
          usagePercent: Math.round((used / total) * 100),
        },
      };
    } catch {
      return { success: false, error: `无法获取磁盘信息: ${targetPath}` };
    }
  },
};

// ─── sys_workspace_dir ──────────────────────────────────
const workspaceDirDef: CapabilityDefinition = {
  name: 'workspace_dir',
  namespace: 'system',
  description: '获取客户端当前工作目录',
  riskLevel: 'read',
  argsSchema: z.object({}),
  handler: async () => {
    const Store = ((await import('electron-store')) as any).default || (await import('electron-store'));
    const store = new Store();
    const dir = (store.get('workspaceDirectory', '') as string) || '';
    return {
      success: true,
      data: {
        workspaceDirectory: dir,
        userDataPath: app.getPath('userData'),
        tempPath: app.getPath('temp'),
        homePath: app.getPath('home'),
        appPath: app.getAppPath(),
      },
    };
  },
};

// ─── 注册所有系统信息能力 ──────────────────────────────────
export function registerSystemInfoCapabilities(): void {
  CapabilityRegistry.registerAll([
    sysInfoDef,
    screenInfoDef,
    localIpDef,
    macAddressDef,
    envDef,
    diskInfoDef,
    workspaceDirDef,
  ]);
}
