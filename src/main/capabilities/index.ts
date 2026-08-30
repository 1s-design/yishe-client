/**
 * 客户端通用能力 — 统一入口
 * 注册所有通用能力到 Capability Registry
 */

import { registerFilesystemCapabilities } from "./filesystem";
import { registerClipboardCapabilities } from "./clipboard";
import { registerSystemInfoCapabilities } from "./system-info";
import { registerScreenMediaCapabilities } from "./screen-media";
import { registerNetworkCapabilities } from "./network";
import { registerPrintCapabilities } from "./print";
import { registerPinterestCapabilities } from "./pinterest";
import { registerWikimediaCapabilities } from "./wikimedia";
import { registerPexelsCapabilities } from "./pexels";
import { registerPixabayCapabilities } from "./pixabay";
import { registerRawpixelCapabilities } from "./rawpixel";
import { registerDouyinJingxuanCapabilities } from "./douyin-jingxuan";
import { registerStockSnapCapabilities } from "./stocksnap";
import { registerOpenverseCapabilities } from "./openverse";
import { registerKaboompicsCapabilities } from "./kaboompics";
import { registerOpenclipartCapabilities } from "./openclipart";
import { registerUndrawCapabilities } from "./undraw";
import { registerVecteezyCapabilities } from "./vecteezy";
import { registerNounProjectCapabilities } from "./nounproject";
import { registerIconifyCapabilities } from "./iconify";
import { registerOpenMojiCapabilities } from "./openmoji";
import { registerGoogleIconsCapabilities } from "./googleicons";
import { registerEmojipediaCapabilities } from "./emojipedia";
import { registerHackernewsCapabilities } from "./hackernews";
import { registerArxivCapabilities } from "./arxiv";
import { registerGithubCapabilities } from "./github";
import { registerGdeltCapabilities } from "./gdelt";
import { registerGooglenewsCapabilities } from "./googlenews";
import { registerRedditCapabilities } from "./reddit";
import { registerProducthuntCapabilities } from "./producthunt";
import { registerTheguardianCapabilities } from "./theguardian";
import { registerBbcnewsCapabilities } from "./bbcnews";
import { registerNprCapabilities } from "./npr";
import { registerTechcrunchCapabilities } from "./techcrunch";
import { registerThevergeCapabilities } from "./theverge";
import { registerArstechnicaCapabilities } from "./arstechnica";
import { registerMittechreviewCapabilities } from "./mittechreview";
import { registerReutersCapabilities } from "./reuters";
import { registerChinadailyCapabilities } from "./chinadaily";
import { registerGovcnCapabilities } from "./govcn";
import { registerXinhuanetCapabilities } from "./xinhuanet";
import { registerShopifyCapabilities } from "./shopify";
import { registerOpenmeteoCapabilities } from "./openmeteo";
import { registerWttrCapabilities } from "./wttr";
import { registerCoingeckoCapabilities } from "./coingecko";
import { registerFrankfurterCapabilities } from "./frankfurter";
import { registerDictionaryCapabilities } from "./dictionary";
import { registerJokeCapabilities } from "./joke";
import { registerIpifyCapabilities } from "./ipify";
import { registerSunrisesunsetCapabilities } from "./sunrisesunset";
import { registerTimeapiCapabilities } from "./timeapi";
import { registerZippopotamCapabilities } from "./zippopotam";
import { registerCountryisCapabilities } from "./countryis";
import { registerErapiCapabilities } from "./erapi";
import { registerFawazahmedCapabilities } from "./fawazahmed";
import { registerColorapiCapabilities } from "./colorapi";
import { registerThePaperCapabilities } from "./thepaper";
import { register36KrCapabilities } from "./36kr";
import { registerHuxiuCapabilities } from "./huxiu";
import { registerSvgrepoCapabilities } from "./svgrepo";
import { registerGoogleArtCapabilities } from "./googleArt";
import { registerMaterialLibraryCapabilities } from "./materialLibrary";
import { registerBaiduCapabilities } from "./baidu";
import { registerBingCapabilities } from "./bing";
import { registerDuckDuckGoCapabilities } from "./duckduckgo";
import { registerSogouCapabilities } from "./sogou";
import { registerSoCapabilities } from "./so";
import { registerWallhavenCapabilities } from "./wallhaven";
import { registerUnsplashCapabilities } from "./unsplash";
import { registerFlickrCapabilities } from "./flickr";
import { registerGoogleImagesCapabilities } from "./googleimages";
import { registerYandexCapabilities } from "./yandex";
import { registerLegacyPlatformCapabilities } from "./legacy-platforms";
import { registerLegacyHotsearchCapabilities } from "./legacy-hotsearch";
import { CapabilityRegistry } from "./registry";
import type { CapabilityResult, RegisteredCapability } from "./types";

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
  registerDouyinJingxuanCapabilities();
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
  registerBaiduCapabilities();
  registerBingCapabilities();
  registerDuckDuckGoCapabilities();
  registerSogouCapabilities();
  registerSoCapabilities();
  registerWallhavenCapabilities();
  registerUnsplashCapabilities();
  registerFlickrCapabilities();
  registerGoogleImagesCapabilities();
  registerYandexCapabilities();
  registerHackernewsCapabilities();
  registerArxivCapabilities();
  registerGithubCapabilities();
  registerGdeltCapabilities();
  registerGooglenewsCapabilities();
  registerRedditCapabilities();
  registerProducthuntCapabilities();
  registerTheguardianCapabilities();
  registerBbcnewsCapabilities();
  registerNprCapabilities();
  registerTechcrunchCapabilities();
  registerThevergeCapabilities();
  registerArstechnicaCapabilities();
  registerMittechreviewCapabilities();
  registerReutersCapabilities();
  registerChinadailyCapabilities();
  registerGovcnCapabilities();
  registerXinhuanetCapabilities();
  registerShopifyCapabilities();
  registerOpenmeteoCapabilities();
  registerWttrCapabilities();
  registerCoingeckoCapabilities();
  registerFrankfurterCapabilities();
  registerDictionaryCapabilities();
  registerJokeCapabilities();
  registerIpifyCapabilities();
  registerSunrisesunsetCapabilities();
  registerTimeapiCapabilities();
  registerZippopotamCapabilities();
  registerCountryisCapabilities();
  registerErapiCapabilities();
  registerFawazahmedCapabilities();
  registerColorapiCapabilities();
  registerThePaperCapabilities();
  register36KrCapabilities();
  registerHuxiuCapabilities();
  registerSvgrepoCapabilities();
  registerGoogleArtCapabilities();
  registerMaterialLibraryCapabilities();
  registerLegacyPlatformCapabilities();
  registerLegacyHotsearchCapabilities();

  initialized = true;
  console.log(
    `[Capabilities] 全部注册完成，共 ${CapabilityRegistry.size} 个能力`,
  );
}

/**
 * 调用一个能力
 */
export async function callCapability<T = any>(
  namespace: string,
  name: string,
  args?: any,
): Promise<CapabilityResult<T>> {
  return CapabilityRegistry.call<T>(namespace, name, args);
}

/**
 * 通过完整名称调用
 */
export async function callCapabilityByFullName<T = any>(
  fullName: string,
  args?: any,
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
export function listCapabilitiesByNamespace(
  namespace: string,
): RegisteredCapability[] {
  return CapabilityRegistry.listByNamespace(namespace);
}

/**
 * 获取能力数量
 */
export function getCapabilityCount(): number {
  return CapabilityRegistry.size;
}

// 导出
export { CapabilityRegistry } from "./registry";
export type {
  CapabilityDefinition,
  CapabilityResult,
  RegisteredCapability,
  RiskLevel,
} from "./types";
