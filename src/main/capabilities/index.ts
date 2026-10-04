/**
 * 客户端通用能力 — 统一入口
 *
 * 采集类能力（图片/媒体/新闻/热搜/数据）已统一收敛：
 *   工具面 = capability-specs.ts（名称/描述/风险等级）
 *   实现体 = 服务端源定义 + 客户端采集引擎（source-bridge 桥接）
 * 本文件只注册：采集能力规格表 + 非采集的系统能力 + 少量定制能力（googleArt/pinterest 等）。
 */

import { registerFilesystemCapabilities } from "./filesystem";
import { registerClipboardCapabilities } from "./clipboard";
import { registerSystemInfoCapabilities } from "./system-info";
import { registerScreenMediaCapabilities } from "./screen-media";
import { registerNetworkCapabilities } from "./network";
import { registerPrintCapabilities } from "./print";
import { registerGoogleArtCapabilities } from "./googleArt";
import { registerMaterialLibraryCapabilities } from "./materialLibrary";
import { registerCollectCapabilities } from "./collect";
import { startCollectToolSyncLoop } from "./dynamic-tool-surface";
import { registerShopifyCapabilities } from "./shopify";
import { CapabilityRegistry } from "./registry";
import type { CapabilityResult, RegisteredCapability } from "./types";

/** 兼容导出：能力调用入口（本地 REST / 桥接层使用） */
export async function callCapability<T = any>(
  namespace: string,
  name: string,
  args: any = {},
  context?: any,
): Promise<CapabilityResult<T>> {
  return CapabilityRegistry.call<T>(namespace, name, args, context);
}

/** 是否已初始化 */
let initialized = false;

/**
 * 注册所有通用能力
 */
export function registerAllCapabilities(): void {
  if (initialized) return;

  // ── 系统能力（非采集） ──
  registerFilesystemCapabilities();
  registerClipboardCapabilities();
  registerSystemInfoCapabilities();
  registerScreenMediaCapabilities();
  registerNetworkCapabilities();
  registerPrintCapabilities();
  registerMaterialLibraryCapabilities();

  // ── 定制采集能力（独立实现，保留） ──
  registerGoogleArtCapabilities();
  registerShopifyCapabilities();

  // ── 采集引擎 + 采集能力规格表（工具面；实现走 source-bridge → 服务端源定义）──
  registerCollectCapabilities();
  startCollectToolSyncLoop(); // 采集工具面由服务端源清单动态生成

  initialized = true;
}
