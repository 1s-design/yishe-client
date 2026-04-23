import { getOrCreateBrowser } from "../services/BrowserService.js";
import { GenericLoginChecker } from "../services/LoginChecker.js";
import { PageOperator } from "../services/PageOperator.js";
import { PLATFORM_CONFIGS } from "../config/platforms.js";
import { logger } from "../utils/logger.js";

const SHOP_PLATFORM_LOGIN_CONFIG = {
  doudian: {
    platformKey: "doudian",
    platformName: "抖店",
  },
  kuaishou_shop: {
    platformKey: "kuaishou_shop",
    platformName: "快手小店",
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

function buildLoginChecker(platformKey) {
  const baseConfig =
    SHOP_PLATFORM_LOGIN_CONFIG[String(platformKey || "").trim()];
  const platformConfig = PLATFORM_CONFIGS?.[platformKey];
  if (!baseConfig || !platformConfig?.loginSelectors) {
    throw new Error(`暂不支持 ${platformKey} 平台登录检测`);
  }

  return new GenericLoginChecker(baseConfig.platformName, {
    selectors: platformConfig.loginSelectors,
  });
}

export async function inspectShopPlatformLogin(page, platformKey) {
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
      uploadUrl: platformConfig.uploadUrl,
      keepPageOpen,
      reusePage: !managePage,
    });
    pushTrace("start", "success", {
      profileId: profileId || null,
      keepPageOpen,
      uploadUrl: platformConfig.uploadUrl,
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

    await page.goto(platformConfig.uploadUrl, {
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
