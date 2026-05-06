import { getOrCreateBrowser } from "../services/BrowserService.js";
import { GenericLoginChecker } from "../services/LoginChecker.js";
import { PageOperator } from "../services/PageOperator.js";
import { PLATFORM_CONFIGS } from "../config/platforms.js";
import { logger } from "../utils/logger.js";

const DEFAULT_LOGIN_URL_MARKERS = [
  "login",
  "auth",
  "signin",
  "passport",
  "signup",
  "sso",
];

const SHOP_PLATFORM_LOGIN_CONFIG = {
  doudian: {
    platformKey: "doudian",
    platformName: "抖店",
    checkMode: "redirect_url",
    loginUrlMarkers: [
      ...DEFAULT_LOGIN_URL_MARKERS,
      "login.jinritemai.com",
      "sso.jinritemai.com",
    ],
  },
  kuaishou_shop: {
    platformKey: "kuaishou_shop",
    platformName: "快手小店",
    checkMode: "redirect_url",
    loginUrlMarkers: [
      ...DEFAULT_LOGIN_URL_MARKERS,
      "login.kwaixiaodian.com",
      "sso.kwaixiaodian.com",
    ],
  },
  taobao: {
    platformKey: "taobao",
    platformName: "淘宝",
    checkMode: "redirect_url",
    loginUrlMarkers: [
      ...DEFAULT_LOGIN_URL_MARKERS,
      "login.taobao.com",
      "login.tmall.com",
      "passport.taobao.com",
      "passport.alibaba.com",
    ],
  },
  qianniu: {
    platformKey: "qianniu",
    platformName: "千牛",
    checkMode: "redirect_url",
    loginUrlMarkers: [
      ...DEFAULT_LOGIN_URL_MARKERS,
      "login.taobao.com",
      "login.tmall.com",
      "passport.taobao.com",
      "passport.alibaba.com",
      "sso.taobao.com",
    ],
  },
  alibaba_1688: {
    platformKey: "alibaba_1688",
    platformName: "1688",
    checkMode: "redirect_url",
    loginUrlMarkers: [
      ...DEFAULT_LOGIN_URL_MARKERS,
      "login.1688.com",
      "passport.1688.com",
      "sso.1688.com",
      "login.alibaba.com",
      "passport.alibaba.com",
    ],
  },
};

function normalizeKeepPageOpen(value, defaultValue = false) {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["1", "true", "yes", "y", "on"].includes(normalized)) {
      return true;
    }
    if (["0", "false", "no", "n", "off"].includes(normalized)) {
      return false;
    }
  }
  return defaultValue;
}

function collectLoginUrlMarkers(currentUrl, markers = DEFAULT_LOGIN_URL_MARKERS) {
  const rawUrl = String(currentUrl || "").trim();
  let normalizedUrl = rawUrl.toLowerCase();
  try {
    const parsedUrl = new URL(rawUrl);
    normalizedUrl = `${parsedUrl.host}${parsedUrl.pathname}`.toLowerCase();
  } catch {
    // Keep the raw URL fallback for browser-internal URLs or unexpected values.
  }

  if (!normalizedUrl) {
    return [];
  }
  return markers
    .map((marker) => String(marker || "").trim().toLowerCase())
    .filter((marker) => marker && normalizedUrl.includes(marker));
}

function buildLoginChecker(platformKey) {
  const normalizedPlatformKey = String(platformKey || "").trim();
  const platformMeta = SHOP_PLATFORM_LOGIN_CONFIG[normalizedPlatformKey];
  const platformConfig = PLATFORM_CONFIGS?.[normalizedPlatformKey];
  if (!platformMeta || !platformConfig?.loginSelectors) {
    throw new Error(`暂不支持 ${platformKey} 平台登录检测`);
  }

  return new GenericLoginChecker(platformMeta.platformName, {
    selectors: platformConfig.loginSelectors,
  });
}

async function inspectShopPlatformLoginByRedirectUrl(page, platformKey) {
  const normalizedPlatformKey = String(platformKey || "").trim();
  const platformMeta = SHOP_PLATFORM_LOGIN_CONFIG[normalizedPlatformKey];
  if (!platformMeta) {
    throw new Error(`暂不支持 ${platformKey} 平台登录检测`);
  }

  const currentUrl = page.url();
  const pageTitle = await page.title().catch(() => "");
  const matchedLoginUrlMarkers = collectLoginUrlMarkers(
    currentUrl,
    platformMeta.loginUrlMarkers,
  );
  const redirectedToLoginPage = matchedLoginUrlMarkers.length > 0;
  const isLoggedIn = !redirectedToLoginPage;

  return {
    isLoggedIn,
    description: redirectedToLoginPage
      ? `${platformMeta.platformName}: 未登录 (跳转到登录页)`
      : `${platformMeta.platformName}: 已登录 (未跳转到登录页)`,
    details: {
      checkMode: "redirect_url",
      reason: redirectedToLoginPage
        ? "redirected_to_login_page"
        : "not_redirected_to_login_page",
      currentUrl,
      pageTitle,
      redirectedToLoginPage,
      matchedLoginUrlMarkers,
    },
  };
}

export async function inspectShopPlatformLogin(page, platformKey) {
  const normalizedPlatformKey = String(platformKey || "").trim();
  const platformMeta = SHOP_PLATFORM_LOGIN_CONFIG[normalizedPlatformKey];
  if (platformMeta?.checkMode === "redirect_url") {
    return await inspectShopPlatformLoginByRedirectUrl(page, platformKey);
  }

  const checker = buildLoginChecker(platformKey);
  const loginResult = await checker.checkLoginStatus(page);
  return {
    isLoggedIn: !!loginResult?.isLoggedIn,
    description: checker.getLoginStatusDescription(loginResult),
    details: loginResult?.details || {},
  };
}

export async function isShopPlatformLoggedIn(page, platformKey) {
  const result = await inspectShopPlatformLogin(page, platformKey);
  return !!result?.isLoggedIn;
}

export async function runShopPlatformCheckLoginSmallFeature(
  platformKey,
  input = {},
  runtimeOptions = {},
) {
  const normalizedPlatformKey = String(platformKey || "").trim();
  const platformMeta = SHOP_PLATFORM_LOGIN_CONFIG[normalizedPlatformKey];
  const platformConfig = PLATFORM_CONFIGS?.[normalizedPlatformKey];
  if (!platformMeta || !platformConfig) {
    throw new Error(`暂不支持 ${platformKey} 平台登录检测`);
  }

  const profileId = String(input?.profileId || "").trim() || undefined;
  const keepPageOpen = normalizeKeepPageOpen(input?.keepPageOpen, false);
  const targetUrl = platformConfig.loginCheckUrl || platformConfig.uploadUrl;
  const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
  const executionTrace = [];
  const checkedAt = new Date().toISOString();
  const managePage = !runtimeOptions?.page;
  let page = runtimeOptions?.page || null;

  const pushTrace = (step, status, detail = {}) => {
    executionTrace.push({
      step,
      status,
      time: new Date().toISOString(),
      detail,
    });
  };

  try {
    logger.info(`${platformMeta.platformName}工具开始检测登录状态`, {
      profileId: profileId || "default",
      targetUrl,
      keepPageOpen,
      reusePage: !managePage,
    });
    pushTrace("start", "success", {
      profileId: profileId || null,
      keepPageOpen,
      targetUrl,
      reusePage: !managePage,
    });

    if (managePage) {
      const browser = await getOrCreateBrowser({ profileId });
      page = await browser.newPage({ foreground: true });
      await pageOperator.setupAntiDetection(page);
      pushTrace("open_page", "success", {
        reusedCurrentPage: false,
        currentUrl: page.url(),
      });
    } else {
      pushTrace("open_page", "success", {
        reusedCurrentPage: true,
        currentUrl: page.url(),
      });
    }

    await page.goto(targetUrl, {
      waitUntil: platformConfig.waitUntil || "domcontentloaded",
      timeout: platformConfig.timeout || 45000,
    });
    await page.waitForTimeout(2500);
    pushTrace("open_target_page", "success", {
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
    });

    const loginResult = await inspectShopPlatformLogin(
      page,
      normalizedPlatformKey,
    );
    pushTrace(
      "check_login",
      loginResult.isLoggedIn ? "success" : "pending",
      loginResult,
    );

    return {
      success: true,
      message: loginResult.isLoggedIn
        ? `${platformMeta.platformName}当前已登录`
        : `${platformMeta.platformName}当前未登录`,
      data: {
        featureKey: `${normalizedPlatformKey}-check-login`,
        platform: normalizedPlatformKey,
        platformName: platformMeta.platformName,
        profileId: profileId || null,
        checkedAt,
        isLoggedIn: loginResult.isLoggedIn,
        description: loginResult.description,
        details: loginResult.details,
        currentUrl: page.url(),
        pageTitle: await page.title().catch(() => ""),
        executionTrace,
        pageKeptOpen: keepPageOpen,
      },
    };
  } catch (error) {
    logger.error(`${platformMeta.platformName}登录检测失败:`, error);
    pushTrace("check_login", "failed", {
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return {
      success: false,
      message: error?.message || `${platformMeta.platformName}登录检测失败`,
      data: {
        featureKey: `${normalizedPlatformKey}-check-login`,
        platform: normalizedPlatformKey,
        platformName: platformMeta.platformName,
        profileId: profileId || null,
        checkedAt,
        currentUrl: page?.url?.() || "",
        pageTitle: await page?.title?.().catch(() => ""),
        executionTrace,
        pageKeptOpen: keepPageOpen,
      },
    };
  } finally {
    if (managePage && page && !keepPageOpen) {
      await page.close().catch(() => undefined);
    }
  }
}

export async function runDoudianCheckLoginSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  return await runShopPlatformCheckLoginSmallFeature(
    "doudian",
    input,
    runtimeOptions,
  );
}

export async function runKuaishouShopCheckLoginSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  return await runShopPlatformCheckLoginSmallFeature(
    "kuaishou_shop",
    input,
    runtimeOptions,
  );
}

export async function runQianniuCheckLoginSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  return await runShopPlatformCheckLoginSmallFeature(
    "qianniu",
    input,
    runtimeOptions,
  );
}

export async function runAlibaba1688CheckLoginSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  return await runShopPlatformCheckLoginSmallFeature(
    "alibaba_1688",
    input,
    runtimeOptions,
  );
}

export async function runAlibaba1688OpenWorkspaceSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  const platformKey = "alibaba_1688";
  const platformConfig = PLATFORM_CONFIGS?.[platformKey];
  if (!platformConfig) {
    throw new Error("1688平台配置不存在");
  }

  const profileId = String(input?.profileId || "").trim() || undefined;
  const targetUrl = platformConfig.loginCheckUrl || platformConfig.uploadUrl;
  const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
  const executionTrace = [];
  const managePage = !runtimeOptions?.page;
  let page = runtimeOptions?.page || null;

  const pushTrace = (step, status, detail = {}) => {
    executionTrace.push({
      step,
      status,
      time: new Date().toISOString(),
      detail,
    });
  };

  try {
    logger.info("1688工具开始进入工作台", {
      profileId: profileId || "default",
      targetUrl,
    });
    pushTrace("start", "success", {
      profileId: profileId || null,
      targetUrl,
    });

    if (managePage) {
      const browser = await getOrCreateBrowser({ profileId });
      page = await browser.newPage({ foreground: true });
      await pageOperator.setupAntiDetection(page);
      pushTrace("open_page", "success", {
        currentUrl: page.url(),
      });
    } else {
      pushTrace("open_page", "success", {
        reusedCurrentPage: true,
        currentUrl: page.url(),
      });
    }

    await page.goto(targetUrl, {
      waitUntil: platformConfig.waitUntil || "domcontentloaded",
      timeout: platformConfig.timeout || 45000,
    });
    await page.waitForTimeout(2000);
    pushTrace("navigate_to_workspace", "success", {
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
    });

    return {
      success: true,
      message: "已打开1688工作台",
      data: {
        featureKey: "alibaba-1688-open-workspace",
        platform: platformKey,
        platformName: "1688",
        profileId: profileId || null,
        currentUrl: page.url(),
        pageTitle: await page.title().catch(() => ""),
        executionTrace,
        pageKeptOpen: true,
      },
    };
  } catch (error) {
    logger.error("1688进入工作台失败:", error);
    pushTrace("open_workspace", "failed", {
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return {
      success: false,
      message: error?.message || "1688进入工作台失败",
      data: {
        featureKey: "alibaba-1688-open-workspace",
        platform: platformKey,
        platformName: "1688",
        profileId: profileId || null,
        currentUrl: page?.url?.() || "",
        pageTitle: await page?.title?.().catch(() => ""),
        executionTrace,
      },
    };
  }
}

export async function runQianniuOpenWorkspaceSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  const platformKey = "qianniu";
  const platformConfig = PLATFORM_CONFIGS?.[platformKey];
  if (!platformConfig) {
    throw new Error("千牛平台配置不存在");
  }

  const profileId = String(input?.profileId || "").trim() || undefined;
  const targetUrl = platformConfig.loginCheckUrl || platformConfig.uploadUrl;
  const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
  const executionTrace = [];
  const managePage = !runtimeOptions?.page;
  let page = runtimeOptions?.page || null;

  const pushTrace = (step, status, detail = {}) => {
    executionTrace.push({
      step,
      status,
      time: new Date().toISOString(),
      detail,
    });
  };

  try {
    logger.info("千牛工具开始进入工作台", {
      profileId: profileId || "default",
      targetUrl,
    });
    pushTrace("start", "success", {
      profileId: profileId || null,
      targetUrl,
    });

    if (managePage) {
      const browser = await getOrCreateBrowser({ profileId });
      page = await browser.newPage({ foreground: true });
      await pageOperator.setupAntiDetection(page);
      pushTrace("open_page", "success", {
        currentUrl: page.url(),
      });
    } else {
      pushTrace("open_page", "success", {
        reusedCurrentPage: true,
        currentUrl: page.url(),
      });
    }

    await page.goto(targetUrl, {
      waitUntil: platformConfig.waitUntil || "domcontentloaded",
      timeout: platformConfig.timeout || 45000,
    });
    await page.waitForTimeout(2000);
    pushTrace("navigate_to_workspace", "success", {
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
    });

    return {
      success: true,
      message: "已打开千牛工作台",
      data: {
        featureKey: "qianniu-open-workspace",
        platform: platformKey,
        platformName: "千牛",
        profileId: profileId || null,
        currentUrl: page.url(),
        pageTitle: await page.title().catch(() => ""),
        executionTrace,
        pageKeptOpen: true,
      },
    };
  } catch (error) {
    logger.error("千牛进入工作台失败:", error);
    pushTrace("open_workspace", "failed", {
      error: error instanceof Error ? error.message : String(error || ""),
    });
    return {
      success: false,
      message: error?.message || "千牛进入工作台失败",
      data: {
        featureKey: "qianniu-open-workspace",
        platform: platformKey,
        platformName: "千牛",
        profileId: profileId || null,
        currentUrl: page?.url?.() || "",
        pageTitle: await page?.title?.().catch(() => ""),
        executionTrace,
      },
    };
  }
}
