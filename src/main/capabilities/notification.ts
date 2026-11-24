/**
 * 客户端通用能力 — 系统原生本地消息通知
 * 基于 Electron Notification API（macOS 通知中心 / Windows Toast / Linux libnotify）
 */

import { z } from "zod";
import { app, BrowserWindow, Notification, nativeImage, shell } from "electron";
import fs from "fs";
import path from "path";
import { CapabilityRegistry } from "./registry";
import type { CapabilityDefinition } from "./types";

/** 持有活跃通知引用，避免在触发 click 事件前被 V8 GC 回收 */
const activeNotifications = new Set<Notification>();

function resolveNotificationIcon(): Electron.NativeImage | undefined {
  const candidates = [
    path.join(process.resourcesPath || "", "resources", "icon.png"),
    path.join(process.resourcesPath || "", "icon.png"),
    path.join(__dirname, "../../resources/icon.png"),
    path.join(__dirname, "../../resources/favicon.png"),
    path.join(process.cwd(), "resources/icon.png"),
    path.join(process.cwd(), "resources/favicon.png"),
  ];
  for (const p of candidates) {
    try {
      if (p && fs.existsSync(p)) {
        const img = nativeImage.createFromPath(p);
        if (!img.isEmpty()) return img;
      }
    } catch {
      // ignore
    }
  }
  return undefined;
}

function focusMainWindow(): void {
  const win =
    BrowserWindow.getFocusedWindow() ||
    BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (!win) return;
  if (win.isMinimized()) win.restore();
  if (!win.isVisible()) win.show();
  win.focus();
}

export interface NativeNotificationInput {
  title: string;
  body: string;
  subtitle?: string;
  silent?: boolean;
  urgency?: "normal" | "critical" | "low";
  url?: string;
  focusApp?: boolean;
}

/**
 * 弹出一条系统原生桌面通知
 */
export function showNativeNotification(input: NativeNotificationInput): {
  success: boolean;
  data?: Record<string, any>;
  error?: string;
} {
  if (!Notification.isSupported()) {
    return {
      success: false,
      error: `当前运行环境（${process.platform}）不支持 Electron 原生系统通知`,
    };
  }

  const title = String(input.title || "").trim() || "衣设客户端通知";
  const body = String(input.body || "").trim();
  const subtitle = input.subtitle ? String(input.subtitle).trim() : undefined;
  const silent = Boolean(input.silent);
  const urgency = input.urgency || "normal";
  const url = input.url ? String(input.url).trim() : undefined;
  const focusApp = input.focusApp !== false;

  const icon = resolveNotificationIcon();
  const notification = new Notification({
    title,
    body,
    ...(subtitle ? { subtitle } : {}),
    silent,
    urgency,
    ...(icon ? { icon } : {}),
  });

  activeNotifications.add(notification);
  const cleanup = () => {
    activeNotifications.delete(notification);
  };

  notification.on("click", () => {
    if (url && /^https?:\/\//i.test(url)) {
      shell.openExternal(url).catch((err) => {
        console.warn("[Notification] 打开通知链接失败:", err?.message || err);
      });
    } else if (focusApp) {
      focusMainWindow();
    }
    cleanup();
  });

  notification.on("close", cleanup);
  notification.on("failed", (_event, err) => {
    console.warn("[Notification] 系统通知展示失败:", err);
    cleanup();
  });

  // 兜底释放引用（60 秒后）
  setTimeout(cleanup, 60_000).unref();

  notification.show();

  if (process.platform === "darwin" && urgency === "critical") {
    try {
      app.dock?.bounce("informational");
    } catch {
      // ignore
    }
  }

  return {
    success: true,
    data: {
      shown: true,
      platform: process.platform,
      title,
      body,
      subtitle: subtitle || null,
      silent,
      urgency,
      url: url || null,
    },
  };
}

// ─── notification_send ──────────────────────────────────
const sendDef: CapabilityDefinition = {
  name: "send",
  namespace: "notification",
  description:
    "调用操作系统原生本地通知中心弹出桌面消息通知（macOS 通知中心 / Windows Toast），支持标题、正文、副标题、静音及点击跳转链接。",
  riskLevel: "write",
  argsSchema: z.object({
    title: z.string().min(1).max(120).describe("通知标题"),
    body: z.string().min(1).max(1000).describe("通知正文内容"),
    subtitle: z.string().max(120).optional().describe("副标题（仅 macOS 展示，可选）"),
    silent: z.boolean().optional().describe("是否静音，默认 false"),
    urgency: z
      .enum(["normal", "critical", "low"])
      .optional()
      .describe("重要程度：normal / critical / low，默认 normal"),
    url: z
      .string()
      .optional()
      .describe("点击通知后在默认浏览器打开的 http/https 链接（可选）"),
    focusApp: z
      .boolean()
      .optional()
      .describe("未传 url 时，点击通知是否唤起并聚焦客户端主窗口，默认 true"),
  }),
  handler: async (args) => {
    return showNativeNotification(args);
  },
};

// ─── notification_is_supported ──────────────────────────
const isSupportedDef: CapabilityDefinition = {
  name: "is_supported",
  namespace: "notification",
  description: "检查当前桌面客户端是否支持系统原生消息通知",
  riskLevel: "read",
  argsSchema: z.object({}),
  handler: async () => {
    return {
      success: true,
      data: {
        supported: Notification.isSupported(),
        platform: process.platform,
      },
    };
  },
};

export function registerNotificationCapabilities(): void {
  CapabilityRegistry.registerAll([sendDef, isSupportedDef]);
}
