/**
 * 客户端通用能力 — 统一入口
 * 注册所有通用能力到 Capability Registry
 */

import { registerFilesystemCapabilities } from './filesystem';
import { registerClipboardCapabilities } from './clipboard';
import { registerSystemInfoCapabilities } from './system-info';
import { registerScreenMediaCapabilities } from './screen-media';
import { registerNetworkCapabilities } from './network';
import { registerPrintCapabilities } from './print';
import { registerPinterestCapabilities } from './pinterest';
import { registerWikimediaCapabilities } from './wikimedia';
import { registerPexelsCapabilities } from './pexels';
import { registerPixabayCapabilities } from './pixabay';
import { registerRawpixelCapabilities } from './rawpixel';
import { registerStockSnapCapabilities } from './stocksnap';
import { registerOpenverseCapabilities } from './openverse';
import { registerKaboompicsCapabilities } from './kaboompics';
import { registerOpenclipartCapabilities } from './openclipart';
import { registerUndrawCapabilities } from './undraw';
import { registerVecteezyCapabilities } from './vecteezy';
import { registerNounProjectCapabilities } from './nounproject';
import { registerIconifyCapabilities } from './iconify';
import { registerOpenMojiCapabilities } from './openmoji';
import { registerGoogleIconsCapabilities } from './googleicons';
import { registerEmojipediaCapabilities } from './emojipedia';
import { registerSvgrepoCapabilities } from './svgrepo';
import { CapabilityRegistry } from './registry';
import type { CapabilityResult, RegisteredCapability } from './types';

/** 是否已初始化 */
let initialized = false;

/**
 * 注册所有通用能力
 */
export function registerAllCapabilities(): void {
  if (initialized) return;

  registerFilesystemCapabilities();
  registerClipboardCapabilities();
  registerSystemInfoCapabilities();
  registerScreenMediaCapabilities();
  registerNetworkCapabilities();
  registerPrintCapabilities();
  registerPinterestCapabilities();
  registerWikimediaCapabilities();
  registerPexelsCapabilities();
  registerPixabayCapabilities();
  registerRawpixelCapabilities();
  registerStockSnapCapabilities();
  registerOpenverseCapabilities();
  registerKaboompicsCapabilities();
  registerOpenclipartCapabilities();
  registerUndrawCapabilities();
  registerVecteezyCapabilities();
  registerNounProjectCapabilities();
  registerIconifyCapabilities();
  registerOpenMojiCapabilities();
  registerGoogleIconsCapabilities();
  registerEmojipediaCapabilities();
  registerSvgrepoCapabilities();

  initialized = true;
  console.log(`[Capabilities] 全部注册完成，共 ${CapabilityRegistry.size} 个能力`);
}

/**
 * 调用一个能力
 */
export async function callCapability<T = any>(
  namespace: string,
  name: string,
  args?: any
): Promise<CapabilityResult<T>> {
  return CapabilityRegistry.call<T>(namespace, name, args);
}

/**
 * 通过完整名称调用
 */
export async function callCapabilityByFullName<T = any>(
  fullName: string,
  args?: any
): Promise<CapabilityResult<T>> {
  return CapabilityRegistry.callByFullName<T>(fullName, args);
}

/**
 * 列出所有能力
 */
export function listCapabilities(): RegisteredCapability[] {
  return CapabilityRegistry.list();
}

/**
 * 按命名空间列出
 */
export function listCapabilitiesByNamespace(namespace: string): RegisteredCapability[] {
  return CapabilityRegistry.listByNamespace(namespace);
}

/**
 * 获取能力数量
 */
export function getCapabilityCount(): number {
  return CapabilityRegistry.size;
}

// 导出
export { CapabilityRegistry } from './registry';
export type { CapabilityDefinition, CapabilityResult, RegisteredCapability, RiskLevel } from './types';
