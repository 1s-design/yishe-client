/**
 * 客户端通用能力 — Google Arts & Culture 艺术搜索与可信采集工作流
 *
 * 可信边界：模型只能选择 search 返回的 resultIndex 和 zoom 返回的 zoomLevel。
 * 真实作品 URL、作品元数据和可用分辨率保存在按 sessionId 隔离的主进程内存中，
 * collect 不接收 URL/标题/ID，避免模型在跨轮对话中重写或编造这些字段。
 */

import { z } from "zod";
import fs from "fs";
import { join } from "path";
import { CapabilityRegistry } from "./registry";
import type { CapabilityCallContext, CapabilityDefinition } from "./types";
import {
  searchGoogleArts,
  getGoogleArtStatus,
  getGoogleArtZooms,
  syncGoogleArtToMaterialLibrary,
} from "../googleArt";

const WORKFLOW_TTL_MS = 30 * 60 * 1000;
const DEFAULT_SESSION_KEY = "__non_agent__";

interface GoogleArtItem {
  id: string;
  title: string;
  artist: string | null;
  thumbnail: string | null;
  url: string;
  color: string | null;
  aspectRatio: number | null;
  hasPixels: boolean;
  institution: string | null;
}

interface GoogleArtSearchView {
  success: boolean;
  query: string;
  page: number;
  total: number;
  count: number;
  nextCursor: string | null;
  error: string | null;
  items: Array<GoogleArtItem & { resultIndex: number }>;
  note: {
    selection: string;
    url: string;
  };
}

interface TrustedZoomSelection {
  url: string;
  canonicalUrl: string;
  item: GoogleArtItem;
  resultIndex: number;
  zooms: Array<{
    idx: number;
    width: number;
    height: number;
    label: string;
    tiles: number;
  }>;
  verifiedAt: number;
}

interface GoogleArtWorkflowState {
  updatedAt: number;
  latestSearchKey?: string;
  latestSearch?: GoogleArtSearchView;
  searchCache: Map<string, { at: number; result: GoogleArtSearchView }>;
  latestZoom?: TrustedZoomSelection;
}

const workflowBySession = new Map<string, GoogleArtWorkflowState>();

function sessionKey(context?: CapabilityCallContext | string): string {
  if (typeof context === "string") return context || DEFAULT_SESSION_KEY;
  return context?.sessionId || DEFAULT_SESSION_KEY;
}

function cleanupWorkflows(now = Date.now()): void {
  for (const [key, state] of workflowBySession) {
    if (now - state.updatedAt > WORKFLOW_TTL_MS) workflowBySession.delete(key);
  }
}

function getWorkflow(
  context?: CapabilityCallContext | string,
): GoogleArtWorkflowState {
  const now = Date.now();
  cleanupWorkflows(now);
  const key = sessionKey(context);
  let state = workflowBySession.get(key);
  if (!state) {
    state = { updatedAt: now, searchCache: new Map() };
    workflowBySession.set(key, state);
  }
  state.updatedAt = now;
  return state;
}

/**
 * 仅用于可信状态内部比对。逐段 decode + NFC 解决 ü 与 %C3%BC 等价形式，
 * 同时严格限制为 Google Arts 的 /asset/<slug>/<id> 详情页。
 */
function canonicalizeArtUrl(raw: string): string | null {
  try {
    const parsed = new URL(String(raw || "").trim());
    const hostname = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (hostname !== "artsandculture.google.com") return null;
    const segments = parsed.pathname
      .split("/")
      .filter(Boolean)
      .map((segment) => decodeURIComponent(segment).normalize("NFC"));
    if (segments[0] !== "asset" || segments.length < 3) return null;
    return `https://artsandculture.google.com/${segments.join("/")}`.replace(
      /\/+$/,
      "",
    );
  } catch {
    return null;
  }
}

function getGoogleArtWorkspaceDir(): string {
  try {
    const globalState = (global as any).__YISHE_WORKSPACE_DIR__;
    if (
      globalState &&
      typeof globalState === "string" &&
      fs.existsSync(globalState)
    ) {
      return globalState;
    }
  } catch {}
  const homeDir = process.env.HOME || "/tmp";
  const defaultDir = join(homeDir, "yisheworkspace");
  try {
    if (!fs.existsSync(defaultDir))
      fs.mkdirSync(defaultDir, { recursive: true });
    return defaultDir;
  } catch {
    return "/tmp/yisheworkspace";
  }
}

function normalizeSearchResult(result: {
  success: boolean;
  query: string;
  page: number;
  total: number;
  count: number;
  items: GoogleArtItem[];
  nextCursor: string | null;
  error?: string;
}): GoogleArtSearchView {
  const items = (result.items || [])
    .filter((item) => !!canonicalizeArtUrl(item.url))
    .map((item, index) => ({ ...item, resultIndex: index + 1 }));
  return {
    success: result.success,
    query: result.query,
    page: result.page,
    total: result.total,
    count: items.length,
    nextCursor: result.nextCursor ?? null,
    error: result.error || null,
    items,
    note: {
      selection:
        "后续获取分辨率时只把用户选择项的 resultIndex 传给 googleArt.zoom；不要重新传递、拼写或改写 URL。",
      url: "items[].url 仅用于向用户展示来源；items[].thumbnail 仅用于预览。googleArt.collect 不接收 URL。",
    },
  };
}

function cloneSearchView(result: GoogleArtSearchView): GoogleArtSearchView {
  return {
    ...result,
    items: result.items.map((item) => ({ ...item })),
    note: { ...result.note },
  };
}

function searchCacheKey(args: {
  keyword: string;
  page?: number;
  hl?: string;
  maxCount?: number;
}): string {
  return [
    args.keyword.trim().toLocaleLowerCase(),
    args.page ?? 1,
    args.hl || "en",
    args.maxCount ?? 24,
  ].join("|");
}

// ─── googleArt.search ────────────────────────────────────────
const searchDef: CapabilityDefinition = {
  name: "search",
  namespace: "googleArt",
  description:
    "在 Google Arts & Culture 搜索世界名画与艺术作品。每项带 resultIndex；用户选中作品后，把该数字传给 googleArt.zoom。不要把 URL 或 thumbnail 传给 zoom/collect。同一查询 30 分钟内由工具复用可信缓存，无需重复联网搜索。",
  riskLevel: "read",
  argsSchema: z
    .object({
      keyword: z
        .string()
        .optional()
        .describe("搜索关键词，如 impressionism, van gogh, mona lisa, 中国画"),
      query: z
        .string()
        .optional()
        .describe("搜索关键词（keyword 的别名，二选一即可）"),
      page: z
        .number()
        .int()
        .min(1)
        .optional()
        .default(1)
        .describe("页码，从 1 开始"),
      hl: z.string().optional().default("en").describe("界面语言，en 或 zh"),
      maxCount: z
        .number()
        .int()
        .min(1)
        .max(64)
        .optional()
        .default(24)
        .describe("每页返回数量，最多 64"),
    })
    .transform((args) => ({
      ...args,
      keyword: String(args.keyword ?? args.query ?? "").trim(),
    })),
  async handler(
    args: { keyword: string; page?: number; hl?: string; maxCount?: number },
    context?: CapabilityCallContext,
  ) {
    const workflow = getWorkflow(context);
    const key = searchCacheKey(args);
    const now = Date.now();
    const cached = workflow.searchCache.get(key);
    if (cached && now - cached.at <= WORKFLOW_TTL_MS) {
      const result = cloneSearchView(cached.result);
      if (workflow.latestSearchKey && workflow.latestSearchKey !== key) {
        workflow.latestZoom = undefined;
      }
      workflow.latestSearchKey = key;
      workflow.latestSearch = result;
      workflow.updatedAt = now;
      return { ...result, cached: true };
    }

    const rawResult = await searchGoogleArts(
      {
        keyword: args.keyword,
        page: args.page ?? 1,
        hl: args.hl || "en",
        maxCount: args.maxCount ?? 24,
        cursor: null,
      },
      args.page ?? 1,
      args.hl || "en",
    );
    const result = normalizeSearchResult(rawResult);
    if (result.success) {
      if (workflow.latestSearchKey && workflow.latestSearchKey !== key) {
        workflow.latestZoom = undefined;
      }
      workflow.latestSearchKey = key;
      workflow.latestSearch = cloneSearchView(result);
      workflow.searchCache.set(key, {
        at: now,
        result: cloneSearchView(result),
      });
      for (const [cacheKey, entry] of workflow.searchCache) {
        if (now - entry.at > WORKFLOW_TTL_MS)
          workflow.searchCache.delete(cacheKey);
      }
    }
    return { ...result, cached: false };
  },
};

// ─── googleArt.status ────────────────────────────────────────
const statusDef: CapabilityDefinition = {
  name: "status",
  namespace: "googleArt",
  description: "获取 Google Arts & Culture 服务状态与下载组件可用性。",
  riskLevel: "read",
  argsSchema: z.object({}),
  async handler() {
    const st = await getGoogleArtStatus();
    return { success: !!st?.ok, ...st };
  },
};

// ─── googleArt.zoom ──────────────────────────────────────────
const zoomDef: CapabilityDefinition = {
  name: "zoom",
  namespace: "googleArt",
  description:
    "根据最近一次 googleArt.search 返回的 resultIndex 获取该作品可用分辨率。调用后必须停下来展示 idx/宽×高/tiles，等待用户明确选择；不得自行选择。真实 URL 由主进程可信状态解析，禁止传 URL。",
  riskLevel: "read",
  argsSchema: z.object({
    resultIndex: z
      .number()
      .int()
      .min(1)
      .describe(
        "用户选择的搜索结果序号，逐字复制自 googleArt.search 的 items[].resultIndex。不是作品 ID，也不是 URL。",
      ),
  }),
  async handler(
    args: { resultIndex: number },
    context?: CapabilityCallContext,
  ) {
    const workflow = getWorkflow(context);
    const item = workflow.latestSearch?.items.find(
      (candidate) => candidate.resultIndex === args.resultIndex,
    );
    if (!item) {
      return {
        success: false,
        error:
          "该 resultIndex 不在本会话最近一次搜索结果中。请展示并复用已有搜索结果；只有用户明确要求新关键词或翻页时才重新搜索。",
        zooms: [],
      };
    }
    const canonicalUrl = canonicalizeArtUrl(item.url);
    if (!canonicalUrl) {
      return { success: false, error: "搜索结果中的作品 URL 无效", zooms: [] };
    }

    // 一旦开始验证新作品，旧作品立即失效；新作品验证失败时绝不能回退采集旧作品。
    workflow.latestZoom = undefined;
    const res = await getGoogleArtZooms(item.url);
    const zooms = (res.zooms || []).map((zoom) => ({
      idx: zoom.idx,
      width: zoom.width,
      height: zoom.height,
      label: zoom.label,
      tiles: zoom.tiles,
    }));
    if (res.ok && zooms.length) {
      workflow.latestZoom = {
        url: item.url,
        canonicalUrl,
        item: { ...item },
        resultIndex: args.resultIndex,
        zooms,
        verifiedAt: Date.now(),
      };
      workflow.updatedAt = Date.now();
    }
    return {
      success: !!res.ok && zooms.length > 0,
      error: res.msg || null,
      selected: {
        resultIndex: args.resultIndex,
        title: item.title,
        artist: item.artist,
        url: item.url,
      },
      zooms,
      note: "用户选定档位后，调用 googleArt.collect 时只传 zoomLevel；不要传 URL 或作品元数据。",
    };
  },
};

export interface GoogleArtCollectPreview {
  ok: boolean;
  error?: string;
  title?: string;
  artist?: string | null;
  url?: string;
  resultIndex?: number;
  zoomLevel?: number;
  width?: number;
  height?: number;
  tiles?: number;
}

/** 在弹出写操作确认卡前验证会话内的可信 zoom 选择。 */
export function prepareGoogleArtCollect(
  context: CapabilityCallContext | string | undefined,
  zoomLevel: unknown,
): GoogleArtCollectPreview {
  const workflow = getWorkflow(context);
  const latestZoom = workflow.latestZoom;
  if (!latestZoom || Date.now() - latestZoom.verifiedAt > WORKFLOW_TTL_MS) {
    return {
      ok: false,
      error:
        "本会话没有有效的 zoom 结果。请先用 googleArt.search 的 resultIndex 调用 googleArt.zoom，并等待用户选择分辨率；不要重新拼写作品 URL。",
    };
  }
  if (typeof zoomLevel !== "number" || !Number.isInteger(zoomLevel)) {
    return { ok: false, error: "缺少用户明确选择的 zoomLevel，不能开始采集" };
  }
  const selectedZoom = latestZoom.zooms.find((zoom) => zoom.idx === zoomLevel);
  if (!selectedZoom) {
    return {
      ok: false,
      error: `zoomLevel ${zoomLevel} 不在已验证档位中，可用档位：${latestZoom.zooms.map((zoom) => zoom.idx).join(", ")}`,
    };
  }
  return {
    ok: true,
    title: latestZoom.item.title,
    artist: latestZoom.item.artist,
    url: latestZoom.url,
    resultIndex: latestZoom.resultIndex,
    zoomLevel,
    width: selectedZoom.width,
    height: selectedZoom.height,
    tiles: selectedZoom.tiles,
  };
}

/** 会话中是否存在尚未被消费的有效 zoom 结果（用于最终输出兜底纠偏）。 */
export function hasTrustedGoogleArtZoom(
  context?: CapabilityCallContext | string,
): boolean {
  const workflow = getWorkflow(context);
  return (
    !!workflow.latestZoom &&
    Date.now() - workflow.latestZoom.verifiedAt <= WORKFLOW_TTL_MS
  );
}

/**
 * 兼容旧调用点；现在只允许与本会话最后一次成功 zoom 完全一致的 URL，
 * 不再接受“任意搜索结果 URL”。新 Agent collect 已不接收 URL。
 */
export function assertKnownGoogleArtUrl(
  url: string | undefined,
  context?: CapabilityCallContext | string,
): string | null {
  const latestZoom = getWorkflow(context).latestZoom;
  const canonicalUrl = url ? canonicalizeArtUrl(url) : null;
  if (
    latestZoom &&
    canonicalUrl &&
    canonicalUrl === latestZoom.canonicalUrl &&
    Date.now() - latestZoom.verifiedAt <= WORKFLOW_TTL_MS
  ) {
    return null;
  }
  return "该 URL 不是本会话最后一次成功 zoom 的作品 URL，已拒绝采集。";
}

// ─── googleArt.collect ───────────────────────────────────────
const collectDef: CapabilityDefinition = {
  name: "collect",
  namespace: "googleArt",
  description:
    "把本会话最后一次 googleArt.zoom 验证的作品按用户选择的 zoomLevel 下载并写入素材库。工具不接收 URL、标题、ID 或路径；这些可信数据由主进程保存。只有 success=true 且 materialLibraryOk=true 才表示入库成功。",
  riskLevel: "write",
  argsSchema: z.object({
    zoomLevel: z
      .number()
      .int()
      .describe(
        "用户明确选择的分辨率档位 idx，必须来自最后一次 googleArt.zoom 返回的 zooms[].idx。",
      ),
  }),
  async handler(args: { zoomLevel: number }, context?: CapabilityCallContext) {
    const preview = prepareGoogleArtCollect(context, args.zoomLevel);
    if (!preview.ok) {
      return {
        success: false,
        ok: false,
        materialLibraryOk: false,
        downloaded: false,
        filePath: null,
        fileName: null,
        fileSize: null,
        error: preview.error,
        msg: preview.error,
      };
    }

    const workflow = getWorkflow(context);
    const trusted = workflow.latestZoom!;
    const workspaceDir = getGoogleArtWorkspaceDir();
    const res = await syncGoogleArtToMaterialLibrary({
      url: trusted.url,
      zoomLevel: args.zoomLevel,
      workspaceDir,
      metadata: {
        title: trusted.item.title || undefined,
        artist: trusted.item.artist || undefined,
        institution: trusted.item.institution || undefined,
        color: trusted.item.color || undefined,
        thumbnail: trusted.item.thumbnail || undefined,
        aspectRatio: trusted.item.aspectRatio ?? undefined,
        hasPixels: trusted.item.hasPixels,
        id: trusted.item.id || undefined,
      },
    });
    const materialLibraryOk = res.ok === true && res.materialLibraryOk === true;
    if (materialLibraryOk) {
      return {
        success: true,
        ok: true,
        materialLibraryOk: true,
        downloaded: true,
        title: trusted.item.title,
        originUrl: trusted.url,
        zoomLevel: args.zoomLevel,
        filePath: res.filePath || null,
        fileName: res.fileName || null,
        fileSize: res.fileSize || null,
        materialId: res.materialId ?? null,
        materialUrl: res.materialUrl || null,
        error: null,
        msg: "已下载并写入素材库",
      };
    }
    return {
      success: false,
      ok: false,
      materialLibraryOk: false,
      downloaded: !!res.filePath,
      title: trusted.item.title,
      originUrl: trusted.url,
      zoomLevel: args.zoomLevel,
      // 失败时不把本地路径交给模型，避免它把“已下载”误说成“已入库”。
      filePath: null,
      fileName: null,
      fileSize: res.fileSize || null,
      error: res.msg || "采集或素材库入库失败",
      msg: res.msg || "采集或素材库入库失败",
    };
  },
};

export function registerGoogleArtCapabilities(): void {
  CapabilityRegistry.registerAll([searchDef, statusDef, zoomDef, collectDef]);
}
