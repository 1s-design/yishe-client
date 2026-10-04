/**
 * 采集兼容垫片（Collect Compat）
 *
 * 旧采集器实现已删除，统一收敛到「服务端源定义 + 采集引擎」。
 * 本模块保持既有函数名/签名/返回形状，内部一律委托 sourceBridgeCall ——
 * WS pluginKey 门面 / IPC handler / 旧调用方零改动。
 */
import { sourceBridgeCall } from "./capabilities/source-bridge";

/** 旧搜索信封 */
async function legacySearch(sourceId: string, keyword: string, options: Record<string, any>): Promise<any> {
  const bridged = await sourceBridgeCall(sourceId, "search", {
    keyword,
    query: keyword,
    ...options,
  });
  if (!bridged.handled) {
    return { success: false, query: keyword, count: 0, items: [], links: [], page: 1, nextPage: null, error: `采集源不可用: ${sourceId}` };
  }
  const r = bridged.result || {};
  if (!r.success) {
    return { success: false, query: keyword, count: 0, items: [], links: [], page: 1, nextPage: null, error: r.error || "采集失败" };
  }
  const d = r.data || {};
  return {
    success: true,
    query: keyword,
    count: d.count ?? (d.items || []).length,
    total: d.total,
    items: d.items || [],
    links: d.links || [],
    page: options?.page || 1,
    nextPage: d.nextPage ?? null,
  };
}

async function legacyStatus(sourceId: string, label: string): Promise<any> {
  const bridged = await sourceBridgeCall(sourceId, "status", {});
  if (bridged.handled && bridged.result?.data) return bridged.result.data;
  return {
    key: sourceId,
    pluginKey: sourceId,
    label,
    connected: false,
    available: false,
    status: "disconnected",
    state: "offline",
    message: `采集源不可用: ${sourceId}`,
    lastCheckedAt: new Date().toISOString(),
    lastError: null,
  };
}

async function legacyDownload(sourceId: string, fileUrl: string, filename?: string): Promise<string> {
  const bridged = await sourceBridgeCall(sourceId, "download", {
    item: { image: fileUrl, downloadUrl: fileUrl, id: filename || fileUrl },
    filename,
  });
  if (bridged.handled && bridged.result?.success) {
    const d = bridged.result.data || {};
    return d.cosUrl || d.filePath || "";
  }
  throw new Error(bridged.result?.error || `下载失败: ${sourceId}`);
}

async function legacySync(sourceId: string, payload: Record<string, any>): Promise<any> {
  const imageUrl = payload?.imageUrl || payload?.image || "";
  const bridged = await sourceBridgeCall(sourceId, "download", {
    item: {
      image: imageUrl,
      downloadUrl: imageUrl,
      title: payload?.metadata?.name || payload?.metadata?.title || undefined,
    },
  });
  if (bridged.handled && bridged.result?.success) {
    const d = bridged.result.data || {};
    return {
      success: true,
      message: "已采集入库",
      data: { cosUrl: d.cosUrl, localFilePath: d.cosUrl, materialId: null },
    };
  }
  return { success: false, message: bridged.result?.error || "入库失败" };
}

// ── mediaCollector 兼容 ─────────────────────────────────
export function listSources(): Array<{ key: string; name: string; supportedTypes: string[] }> {
  return [
    { key: "wikimedia", name: "Wikimedia", supportedTypes: ["image", "video", "audio"] },
    { key: "internet-archive", name: "Internet Archive", supportedTypes: ["image", "video", "audio"] },
    { key: "openverse", name: "Openverse", supportedTypes: ["image", "audio"] },
    { key: "pexels", name: "Pexels", supportedTypes: ["image", "video"] },
    { key: "magnific", name: "Magnific", supportedTypes: ["image", "video"] },
    { key: "nappy", name: "Nappy", supportedTypes: ["image"] },
    { key: "midjourney", name: "Midjourney", supportedTypes: ["image", "video"] },
  ];
}
export async function searchMedia(options: Record<string, any>): Promise<any> {
  const source = String(options?.source || "");
  return legacySearch(source, String(options?.query || ""), options);
}
export async function importMedia(items: any[]): Promise<any> {
  const results = [] as any[];
  for (const item of items || []) {
    const source = String(item?.source || "pexels");
    results.push(await legacySync(source, { imageUrl: item?.image || item?.downloadUrl || item?.url, metadata: item }));
  }
  return {
    total: items?.length || 0,
    successCount: results.filter((r) => r.success).length,
    results,
  };
}

// ── wikimedia ──────────────────────────────────────────────
export async function searchWikimedia(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("wikimedia", keyword, options);
}
export async function getWikimediaStatus(): Promise<any> {
  return legacyStatus("wikimedia", "Wikimedia");
}
export async function downloadWikimediaImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("wikimedia", fileUrl, filename);
}
export async function syncWikimediaToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("wikimedia", payload);
}

// ── pexels ──────────────────────────────────────────────
export async function searchPexels(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("pexels", keyword, options);
}
export async function getPexelsStatus(): Promise<any> {
  return legacyStatus("pexels", "Pexels");
}
export async function downloadPexelsImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("pexels", fileUrl, filename);
}
export async function syncPexelsToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("pexels", payload);
}

// ── pixabay ──────────────────────────────────────────────
export async function searchPixabay(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("pixabay", keyword, options);
}
export async function getPixabayStatus(): Promise<any> {
  return legacyStatus("pixabay", "Pixabay");
}
export async function downloadPixabayImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("pixabay", fileUrl, filename);
}
export async function syncPixabayToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("pixabay", payload);
}

// ── rawpixel ──────────────────────────────────────────────
export async function searchRawpixel(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("rawpixel", keyword, options);
}
export async function getRawpixelStatus(): Promise<any> {
  return legacyStatus("rawpixel", "Rawpixel");
}
export async function downloadRawpixelImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("rawpixel", fileUrl, filename);
}
export async function syncRawpixelToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("rawpixel", payload);
}

// ── stocksnap ──────────────────────────────────────────────
export async function searchStockSnap(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("stocksnap", keyword, options);
}
export async function getStockSnapStatus(): Promise<any> {
  return legacyStatus("stocksnap", "StockSnap");
}
export async function downloadStockSnapImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("stocksnap", fileUrl, filename);
}
export async function syncStockSnapToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("stocksnap", payload);
}

// ── openverse ──────────────────────────────────────────────
export async function searchOpenverse(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("openverse", keyword, options);
}
export async function getOpenverseStatus(): Promise<any> {
  return legacyStatus("openverse", "Openverse");
}
export async function downloadOpenverseImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("openverse", fileUrl, filename);
}
export async function syncOpenverseToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("openverse", payload);
}

// ── kaboompics ──────────────────────────────────────────────
export async function searchKaboompics(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("kaboompics", keyword, options);
}
export async function getKaboompicsStatus(): Promise<any> {
  return legacyStatus("kaboompics", "Kaboompics");
}
export async function downloadKaboompicsImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("kaboompics", fileUrl, filename);
}
export async function syncKaboompicsToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("kaboompics", payload);
}

// ── magnific ──────────────────────────────────────────────
export async function searchMagnific(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("magnific", keyword, options);
}
export async function getMagnificStatus(): Promise<any> {
  return legacyStatus("magnific", "Magnific");
}
export async function downloadMagnificFile(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("magnific", fileUrl, filename);
}
export async function syncMagnificToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("magnific", payload);
}

// ── openclipart ──────────────────────────────────────────────
export async function searchOpenclipart(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("openclipart", keyword, options);
}
export async function getOpenclipartStatus(): Promise<any> {
  return legacyStatus("openclipart", "Openclipart");
}
export async function downloadOpenclipartImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("openclipart", fileUrl, filename);
}
export async function syncOpenclipartToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("openclipart", payload);
}

// ── undraw ──────────────────────────────────────────────
export async function searchUndraw(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("undraw", keyword, options);
}
export async function getUndrawStatus(): Promise<any> {
  return legacyStatus("undraw", "Undraw");
}
export async function downloadUndrawImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("undraw", fileUrl, filename);
}
export async function syncUndrawToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("undraw", payload);
}

// ── vecteezy ──────────────────────────────────────────────
export async function searchVecteezy(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("vecteezy", keyword, options);
}
export async function getVecteezyStatus(): Promise<any> {
  return legacyStatus("vecteezy", "Vecteezy");
}
export async function downloadVecteezyAsset(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("vecteezy", fileUrl, filename);
}
export async function syncVecteezyToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("vecteezy", payload);
}

// ── openmoji ──────────────────────────────────────────────
export async function searchOpenMoji(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("openmoji", keyword, options);
}
export async function getOpenMojiStatus(): Promise<any> {
  return legacyStatus("openmoji", "OpenMoji");
}
export async function downloadOpenMojiEmoji(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("openmoji", fileUrl, filename);
}
export async function syncOpenMojiToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("openmoji", payload);
}

// ── googleicons ──────────────────────────────────────────────
export async function searchGoogleIcons(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("googleicons", keyword, options);
}
export async function getGoogleIconsStatus(): Promise<any> {
  return legacyStatus("googleicons", "GoogleIcons");
}
export async function downloadGoogleIcon(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("googleicons", fileUrl, filename);
}
export async function syncGoogleIconsToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("googleicons", payload);
}

// ── emojipedia ──────────────────────────────────────────────
export async function searchEmojipedia(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("emojipedia", keyword, options);
}
export async function getEmojipediaStatus(): Promise<any> {
  return legacyStatus("emojipedia", "Emojipedia");
}
export async function downloadEmojipediaItem(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("emojipedia", fileUrl, filename);
}
export async function syncEmojipediaToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("emojipedia", payload);
}

// ── svgrepo ──────────────────────────────────────────────
export async function searchSvgrepo(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("svgrepo", keyword, options);
}
export async function getSvgrepoStatus(): Promise<any> {
  return legacyStatus("svgrepo", "Svgrepo");
}
export async function downloadSvgrepoImage(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("svgrepo", fileUrl, filename);
}
export async function syncSvgrepoToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("svgrepo", payload);
}

// ── iconify ──────────────────────────────────────────────
export async function searchIconify(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("iconify", keyword, options);
}
export async function getIconifyStatus(): Promise<any> {
  return legacyStatus("iconify", "Iconify");
}
export async function downloadIconifyIcon(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("iconify", fileUrl, filename);
}
export async function syncIconifyToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("iconify", payload);
}

// ── nounproject ──────────────────────────────────────────────
export async function searchNounProject(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("nounproject", keyword, options);
}
export async function getNounProjectStatus(): Promise<any> {
  return legacyStatus("nounproject", "NounProject");
}
export async function downloadNounProjectAsset(fileUrl: string, destDir?: string, filename?: string): Promise<string> {
  return legacyDownload("nounproject", fileUrl, filename);
}
export async function syncNounProjectToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("nounproject", payload);
}

// ── 追加兼容导出（新闻/数据等）──
export async function searchHN(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("hackernews", String(keyword || ""), options || {}); }
export async function getHNStatus(): Promise<any> { return legacyStatus("hackernews", "hackernews"); }
export async function syncHNToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("hackernews", payload || {}); }
export async function searchArxiv(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("arxiv", String(keyword || ""), options || {}); }
export async function getArxivStatus(): Promise<any> { return legacyStatus("arxiv", "arxiv"); }
export async function syncArxivToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("arxiv", payload || {}); }
export async function searchGithubRepos(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("github", String(keyword || ""), options || {}); }
export async function getGithubStatus(): Promise<any> { return legacyStatus("github", "github"); }
export async function syncGithubToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("github", payload || {}); }
export async function searchGdeltNews(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("gdelt", String(keyword || ""), options || {}); }
export async function getGdeltStatus(): Promise<any> { return legacyStatus("gdelt", "gdelt"); }
export async function syncGdeltToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("gdelt", payload || {}); }
export async function searchGoogleNews(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("googlenews", String(keyword || ""), options || {}); }
export async function getGoogleNewsStatus(): Promise<any> { return legacyStatus("googlenews", "googlenews"); }
export async function syncGoogleNewsToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("googlenews", payload || {}); }
export async function searchReddit(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("reddit", String(keyword || ""), options || {}); }
export async function getRedditStatus(): Promise<any> { return legacyStatus("reddit", "reddit"); }
export async function syncRedditToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("reddit", payload || {}); }
export async function searchPH(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("producthunt", String(keyword || ""), options || {}); }
export async function getPHStatus(): Promise<any> { return legacyStatus("producthunt", "producthunt"); }
export async function syncPHToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("producthunt", payload || {}); }
export async function searchGuardian(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("theguardian", String(keyword || ""), options || {}); }
export async function getGuardianStatus(): Promise<any> { return legacyStatus("theguardian", "theguardian"); }
export async function syncGuardianToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("theguardian", payload || {}); }
export async function fetchBBC(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("bbcnews", String(keyword || ""), options || {}); }
export async function getBBCStatus(): Promise<any> { return legacyStatus("bbcnews", "bbcnews"); }
export async function syncBBCToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("bbcnews", payload || {}); }
export async function fetchNPR(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("npr", String(keyword || ""), options || {}); }
export async function getNPRStatus(): Promise<any> { return legacyStatus("npr", "npr"); }
export async function syncNPRToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("npr", payload || {}); }
export async function fetchTC(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("techcrunch", String(keyword || ""), options || {}); }
export async function getTCStatus(): Promise<any> { return legacyStatus("techcrunch", "techcrunch"); }
export async function syncTCToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("techcrunch", payload || {}); }
export async function fetchVerge(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("theverge", String(keyword || ""), options || {}); }
export async function getVergeStatus(): Promise<any> { return legacyStatus("theverge", "theverge"); }
export async function syncVergeToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("theverge", payload || {}); }
export async function fetchArs(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("arstechnica", String(keyword || ""), options || {}); }
export async function getArsStatus(): Promise<any> { return legacyStatus("arstechnica", "arstechnica"); }
export async function syncArsToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("arstechnica", payload || {}); }
export async function fetchMIT(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("mittechreview", String(keyword || ""), options || {}); }
export async function getMITStatus(): Promise<any> { return legacyStatus("mittechreview", "mittechreview"); }
export async function syncMITToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("mittechreview", payload || {}); }
export async function fetchReuters(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("reuters", String(keyword || ""), options || {}); }
export async function getReutersStatus(): Promise<any> { return legacyStatus("reuters", "reuters"); }
export async function syncReutersToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("reuters", payload || {}); }
export async function fetchChinaDaily(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("chinadaily", String(keyword || ""), options || {}); }
export async function getChinaDailyStatus(): Promise<any> { return legacyStatus("chinadaily", "chinadaily"); }
export async function syncChinaDailyToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("chinadaily", payload || {}); }
export async function fetchGovCN(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("govcn", String(keyword || ""), options || {}); }
export async function getGovCNStatus(): Promise<any> { return legacyStatus("govcn", "govcn"); }
export async function syncGovCNToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("govcn", payload || {}); }
export async function fetchXH(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("xinhuanet", String(keyword || ""), options || {}); }
export async function getXHStatus(): Promise<any> { return legacyStatus("xinhuanet", "xinhuanet"); }
export async function syncXHToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("xinhuanet", payload || {}); }
export async function fetchThePaper(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("thepaper", String(keyword || ""), options || {}); }
export async function getThePaperStatus(): Promise<any> { return legacyStatus("thepaper", "thepaper"); }
export async function syncThePaperToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("thepaper", payload || {}); }
export async function fetch36Kr(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("36kr", String(keyword || ""), options || {}); }
export async function get36KrStatus(): Promise<any> { return legacyStatus("36kr", "36kr"); }
export async function sync36KrToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("36kr", payload || {}); }
export async function fetchHuxiu(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("huxiu", String(keyword || ""), options || {}); }
export async function getHuxiuStatus(): Promise<any> { return legacyStatus("huxiu", "huxiu"); }
export async function syncHuxiuToLibrary(payload: Record<string, any> = {}): Promise<any> { return legacySync("huxiu", payload || {}); }
export async function searchOpenMeteo(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("openmeteo", String(keyword || ""), options || {}); }
export async function getOpenMeteoStatus(): Promise<any> { return legacyStatus("openmeteo", "openmeteo"); }
export async function searchWttr(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("wttr", String(keyword || ""), options || {}); }
export async function getWttrStatus(): Promise<any> { return legacyStatus("wttr", "wttr"); }
export async function searchCoinGecko(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("coingecko", String(keyword || ""), options || {}); }
export async function getCoinGeckoStatus(): Promise<any> { return legacyStatus("coingecko", "coingecko"); }
export async function searchFrankfurter(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("frankfurter", String(keyword || ""), options || {}); }
export async function getFrankfurterStatus(): Promise<any> { return legacyStatus("frankfurter", "frankfurter"); }
export async function searchDictionary(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("dictionary", String(keyword || ""), options || {}); }
export async function getDictionaryStatus(): Promise<any> { return legacyStatus("dictionary", "dictionary"); }
export async function searchJoke(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("joke", String(keyword || ""), options || {}); }
export async function getJokeStatus(): Promise<any> { return legacyStatus("joke", "joke"); }
export async function searchIpify(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("ipify", String(keyword || ""), options || {}); }
export async function getIpifyStatus(): Promise<any> { return legacyStatus("ipify", "ipify"); }
export async function searchSunrise(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("sunrisesunset", String(keyword || ""), options || {}); }
export async function getSunriseStatus(): Promise<any> { return legacyStatus("sunrisesunset", "sunrisesunset"); }
export async function searchTimeApi(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("timeapi", String(keyword || ""), options || {}); }
export async function getTimeApiStatus(): Promise<any> { return legacyStatus("timeapi", "timeapi"); }
export async function searchZippopotam(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("zippopotam", String(keyword || ""), options || {}); }
export async function getZippopotamStatus(): Promise<any> { return legacyStatus("zippopotam", "zippopotam"); }
export async function searchCountryIs(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("countryis", String(keyword || ""), options || {}); }
export async function getCountryIsStatus(): Promise<any> { return legacyStatus("countryis", "countryis"); }
export async function searchErApi(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("erapi", String(keyword || ""), options || {}); }
export async function getErApiStatus(): Promise<any> { return legacyStatus("erapi", "erapi"); }
export async function searchFawazahmed(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("fawazahmed", String(keyword || ""), options || {}); }
export async function getFawazahmedStatus(): Promise<any> { return legacyStatus("fawazahmed", "fawazahmed"); }
export async function searchColorApi(keyword?: string, options?: Record<string, any>): Promise<any> { return legacySearch("colorapi", String(keyword || ""), options || {}); }
export async function getColorApiStatus(): Promise<any> { return legacyStatus("colorapi", "colorapi"); }

// ── pinterest 兼容（已迁移为源定义，走引擎）──
export async function searchPinterest(keyword: string, options: Record<string, any> = {}): Promise<any> {
  return legacySearch("pinterest", keyword, options);
}
export async function getPinterestStatus(): Promise<any> {
  return legacyStatus("pinterest", "Pinterest");
}
export async function syncPinterestToMaterialLibrary(payload: Record<string, any> = {}): Promise<any> {
  return legacySync("pinterest", payload);
}
export class PinterestClient {
  async downloadImage(imageUrl: string, _destDir?: string, filename?: string): Promise<string> {
    return legacyDownload("pinterest", imageUrl, filename);
  }
}
