#!/usr/bin/env node

const fs = require("fs");
const os = require("os");
const path = require("path");

const designServerRoot =
  process.env.YISHE_DESIGN_SERVER_ROOT ||
  path.resolve(__dirname, "../../design-server");

require(
  path.join(designServerRoot, "node_modules/ts-node/register/transpile-only"),
);

const { io } = require("socket.io-client");
const jwt = require(path.join(designServerRoot, "node_modules/jsonwebtoken"));
const designServerConfigModule = require(path.join(designServerRoot, "config"));
const designServerConfig =
  designServerConfigModule.default || designServerConfigModule;
const {
  executeEcomSelectionSupplyMatchTask,
} = require("../src/renderer/src/services/ecomSelectionSupplyMatch.ts");

const SERVER_WS_URL =
  process.env.YISHE_SERVER_WS_URL || "http://127.0.0.1:1520/ws";
const UPLOADER_API_BASE =
  process.env.YISHE_UPLOADER_API_BASE || "http://127.0.0.1:7010";
const USER_ID = Number(process.env.YISHE_RUNTIME_USER_ID || "5");
const ACCOUNT = process.env.YISHE_RUNTIME_ACCOUNT || "jackie";
const CLIENT_ID =
  process.env.YISHE_RUNTIME_CLIENT_ID || `mock-ecom-runtime-${os.hostname()}`;
const SERVER_TOKEN =
  process.env.YISHE_SERVER_TOKEN ||
  jwt.sign(
    {
      id: USER_ID,
      account: ACCOUNT,
      terminalType: "client",
      tokenId: `mock-${Date.now()}`,
    },
    designServerConfig.SECRET,
  );
const WORKSPACE_DIR =
  process.env.YISHE_RUNTIME_WORKSPACE ||
  path.join(process.cwd(), "tmp", "mock-ecom-runtime");

fs.mkdirSync(WORKSPACE_DIR, { recursive: true });

let heartbeatTimer = null;
let currentBusy = false;
let currentTaskId = null;
let currentError = null;

function log(message, detail) {
  if (detail === undefined) {
    console.log(`[mock-ecom-runtime] ${message}`);
    return;
  }
  console.log(`[mock-ecom-runtime] ${message}`, detail);
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, options);
  const json = await response.json().catch(() => ({}));
  return {
    ok: response.ok,
    statusCode: response.status,
    json,
  };
}

async function runUploaderEcomCollect(data) {
  try {
    const response = await requestJson(
      `${UPLOADER_API_BASE}/api/ecom-collect/run`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...(data || {}),
          workspaceDir:
            String(data?.workspaceDir || "").trim() || WORKSPACE_DIR,
        }),
        signal: AbortSignal.timeout(
          typeof data?.timeoutMs === "number" && Number.isFinite(data.timeoutMs)
            ? Math.max(60_000, Number(data.timeoutMs) + 60_000)
            : 21 * 60 * 1000,
        ),
      },
    );

    const json = response.json || {};
    const success = response.ok && json.success !== false;
    return {
      success,
      status: json.status || (success ? "success" : "failed"),
      message:
        json.message ||
        (!success ? `执行电商采集失败: ${response.statusCode}` : ""),
      data: json.data,
    };
  } catch (error) {
    return {
      success: false,
      status: "failed",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function buildBrowserAutomationRuntime() {
  const [apiInfo, browserStatus, capabilityStatus] = await Promise.all([
    requestJson(`${UPLOADER_API_BASE}/api`),
    requestJson(`${UPLOADER_API_BASE}/api/browser/status`),
    requestJson(`${UPLOADER_API_BASE}/api/ecom-collect/capabilities`),
  ]);

  const serviceData = apiInfo.json || {};
  const browserData =
    browserStatus.ok && browserStatus.json?.success
      ? browserStatus.json.data || {}
      : {};
  const capabilityData =
    capabilityStatus.ok && capabilityStatus.json?.success
      ? capabilityStatus.json.data || null
      : null;

  const browserConnected = !!browserData.isConnected;
  const available =
    browserStatus.ok && browserStatus.json?.success && browserConnected;

  return {
    label: "浏览器自动化",
    connected: apiInfo.ok,
    available,
    status: apiInfo.ok ? "connected" : "disconnected",
    state: currentBusy ? "busy" : available ? "idle" : "offline",
    busy: currentBusy,
    currentTaskId,
    message: currentBusy
      ? "模拟运行时执行中"
      : available
        ? "模拟运行时已连接 uploader 与浏览器"
        : "uploader 已启动，但浏览器或能力未就绪",
    version: serviceData.version || null,
    endpoint: UPLOADER_API_BASE,
    lastCheckedAt: new Date().toISOString(),
    lastError: currentError,
    supportedCommands: ["ecomCollectRun", "ecomSelectionSupplyMatchRun"],
    autoDispatchEnabled: true,
    details: {
      browserConnected,
      hasInstance: !!browserData.hasInstance,
      pageCount: Number(browserData.pageCount) || 0,
      lastActivity: browserData.lastActivity || null,
      connection: browserData.connection || null,
      pages: Array.isArray(browserData.pages) ? browserData.pages : [],
      ecomCollect: capabilityData,
    },
  };
}

const socket = io(SERVER_WS_URL, {
  transports: ["websocket"],
  auth: {
    token: SERVER_TOKEN,
  },
  query: {
    clientId: CLIENT_ID,
    clientSource: "客户端",
  },
});

async function emitClientInfo() {
  socket.emit("client-info", {
    clientId: CLIENT_ID,
    appVersion: "mock-ecom-runtime/1.0.0",
    location: "local-smoke",
    user: {
      id: USER_ID,
      account: ACCOUNT,
    },
    machine: {
      code: `MOCK-${os.hostname()}`,
      name: os.hostname(),
      platform: process.platform,
    },
  });
}

async function emitRuntime() {
  const runtime = await buildBrowserAutomationRuntime();
  socket.emit("service-runtime", {
    service: "browser-automation",
    pluginKey: "browser-automation",
    runtime,
  });
}

async function handleCollectCommand(command) {
  const payload =
    command && typeof command.payload === "object" ? command.payload : {};
  return runUploaderEcomCollect(payload);
}

async function handleSupplyMatchCommand(command) {
  const payload =
    command && typeof command.payload === "object" ? command.payload : {};
  return executeEcomSelectionSupplyMatchTask({
    runId: String(payload.runId || "").trim(),
    taskId: String(payload.taskId || "").trim(),
    matchType: String(payload.matchType || "supply_match").trim(),
    sourceProducts: Array.isArray(payload.sourceProducts)
      ? payload.sourceProducts
      : [],
    sourceSummary:
      payload.sourceSummary && typeof payload.sourceSummary === "object"
        ? payload.sourceSummary
        : null,
    optionsData:
      payload.optionsData && typeof payload.optionsData === "object"
        ? payload.optionsData
        : null,
    timeoutMs: Number(payload.timeoutMs) || 30 * 60 * 1000,
    workspaceDir: WORKSPACE_DIR,
    runCollect: runUploaderEcomCollect,
  });
}

async function reportCommandResult(command, result, error) {
  const payload =
    command && typeof command.payload === "object" ? command.payload : {};
  const runId = String(payload.runId || "").trim();
  const taskId = String(payload.taskId || "").trim();
  const action = String(command?.action || "").trim();
  const success = !!result?.success && !error;
  const status =
    result?.status || (success ? "success" : error ? "failed" : "failed");
  const message =
    result?.message ||
    (error instanceof Error ? error.message : error ? String(error) : "");

  socket.emit("service-command-result", {
    action,
    success,
    message,
    error: success ? null : message,
    data: {
      ...(result?.data || {}),
      runId,
      taskId,
      status,
    },
  });
}

socket.on("connect", async () => {
  log(`connected to ${SERVER_WS_URL} as ${CLIENT_ID}`);
  await emitClientInfo();
  await emitRuntime();

  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
  }
  heartbeatTimer = setInterval(() => {
    void emitRuntime().catch((error) => {
      log(
        "runtime heartbeat failed",
        error instanceof Error ? error.message : error,
      );
    });
  }, 15_000);
});

socket.on("disconnect", (reason) => {
  log(`disconnected: ${reason}`);
});

socket.on("connect_error", (error) => {
  log("connect error", error instanceof Error ? error.message : error);
});

socket.on("service-command", async (command) => {
  const action = String(command?.action || "").trim();
  if (!["ecomCollectRun", "ecomSelectionSupplyMatchRun"].includes(action)) {
    log("ignored unsupported command", action);
    return;
  }

  currentBusy = true;
  currentTaskId = String(command?.payload?.runId || "").trim() || null;
  currentError = null;
  await emitRuntime().catch(() => undefined);

  log(`handling ${action}`, {
    runId: command?.payload?.runId,
    taskId: command?.payload?.taskId,
  });

  let result = null;
  let error = null;

  try {
    result =
      action === "ecomCollectRun"
        ? await handleCollectCommand(command)
        : await handleSupplyMatchCommand(command);
  } catch (caught) {
    error = caught;
    log("command failed", caught instanceof Error ? caught.message : caught);
  }

  currentBusy = false;
  currentError =
    error instanceof Error
      ? error.message
      : result?.success
        ? null
        : result?.message || null;
  currentTaskId = null;

  await reportCommandResult(command, result, error).catch((caught) => {
    log(
      "failed to report command result",
      caught instanceof Error ? caught.message : caught,
    );
  });
  await emitRuntime().catch(() => undefined);
});

async function shutdown() {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  socket.disconnect();
}

process.on("SIGINT", async () => {
  await shutdown();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await shutdown();
  process.exit(0);
});
