/**
 * 热搜相关 Express 路由
 */

import { type Express, type Request, type Response } from "express";
import { hotSearchService } from "./hotsearch.service";

export function registerHotSearchRoutes(
  app: Express,
  getToken?: () => string | null,
) {
  app.get("/api/hotsearch/info", (_req: Request, res: Response) => {
    try {
      const status = hotSearchService.getStatus();
      const polling = hotSearchService.getSchedulePollingStatus();
      res.json({
        success: true,
        deviceId: polling.clientDeviceId,
        polling: polling.polling,
        lastFetchAt: status.lastFetchAt,
        platformCount: status.platforms.length,
      });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  app.get("/api/hotsearch/platforms", (_req: Request, res: Response) => {
    try {
      res.json(hotSearchService.getPlatforms());
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  app.get("/api/hotsearch/status", (_req: Request, res: Response) => {
    try {
      res.json({ success: true, ...hotSearchService.getStatus() });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  app.post("/api/hotsearch/fetch", async (req: Request, res: Response) => {
    try {
      const { platforms, reportToServer = true } = req.body || {};
      const result = reportToServer
        ? await hotSearchService.fetchAndReport(platforms)
        : await hotSearchService.fetchAll(platforms);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  app.get("/api/hotsearch/platform/:key", (req: Request, res: Response) => {
    try {
      const detail = hotSearchService.getPlatformDetail(req.params.key);
      if (!detail) {
        res.status(404).json({ success: false, message: "平台不存在" });
        return;
      }
      res.json({ success: true, data: detail });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  app.post("/api/hotsearch/fetch/:key", async (req: Request, res: Response) => {
    try {
      const result = await hotSearchService.fetchAndReport([req.params.key]);
      res.json({ success: true, ...result });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  app.get("/api/hotsearch/schedule/status", (_req: Request, res: Response) => {
    try {
      const status = hotSearchService.getSchedulePollingStatus();
      res.json({ success: true, ...status });
    } catch (error: any) {
      res.status(500).json({ success: false, message: error?.message });
    }
  });

  // 代理远程热搜数据接口（避免 CORS 问题）
  const REMOTE_BASE =
    process.env.NODE_ENV === "development"
      ? "http://localhost:1520/api"
      : "https://1s.design:1520/api";
  const FALLBACK_BASE = "http://localhost:1520/api";

  /** 带 fallback 的 fetch */
  async function fetchWithFallback(path: string, init?: RequestInit): Promise<any> {
    try {
      return await fetch(`${REMOTE_BASE}${path}`, init);
    } catch (primaryErr: any) {
      console.warn(`[HotSearch Proxy] 主地址失败 (${primaryErr?.cause?.code || primaryErr?.message}), fallback → ${FALLBACK_BASE}${path}`);
      return fetch(`${FALLBACK_BASE}${path}`, init);
    }
  }

  app.get(
    "/api/hotsearch-data/schedules",
    async (req: Request, res: Response) => {
      try {
        // 优先用请求头中的 token，fallback 到主进程 token
        const headerToken = (req.headers.authorization || "").replace(
          /^Bearer /i,
          "",
        );
        const localToken = getToken?.() || "";
        const token = headerToken || localToken;
        const clientId = (req.query.clientId as string) || "";

        // 调用远程获取全部 schedules（user-scoped）
        const response = await fetchWithFallback("/hotsearch-data/schedules", {
          headers: {
            Authorization: token ? `Bearer ${token}` : "",
            "Content-Type": "application/json",
          },
        });

        if (!response.ok) {
          const errorText = await response.text().catch(() => "");
          console.warn(
            `[HotSearch Proxy] 远程请求失败: HTTP ${response.status} ${errorText}`,
          );
          if (response.status === 401) {
            res.status(200).json({
              success: false,
              data: null,
              message: "未登录或 token 已过期",
            });
          } else {
            res.status(response.status).json({
              success: false,
              message: `远程服务返回 ${response.status}`,
            });
          }
          return;
        }

        const raw = await response.json();
        // API 返回 { data: [...], code: 0 } 或直接数组
        const schedules: any[] = Array.isArray(raw)
          ? raw
          : Array.isArray(raw?.data)
            ? raw.data
            : [];

        // 如果指定了 clientId，在代理层过滤
        if (clientId) {
          const matched =
            schedules.find((s: any) => s.clientId === clientId) || null;
          res.json({ success: true, data: matched });
        } else {
          res.json({ success: true, data: schedules });
        }
      } catch (error: any) {
        console.error(
          "[HotSearch Proxy] 获取定时任务失败:",
          error?.message || error,
        );
        res
          .status(500)
          .json({ success: false, message: error?.message || "代理请求失败" });
      }
    },
  );

  console.log("✅ [HotSearch] 路由已注册: /api/hotsearch/*");
}
