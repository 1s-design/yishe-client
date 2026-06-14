import { getOrCreateBrowser } from "../../services/BrowserService.js";
import { PageOperator } from "../../services/PageOperator.js";
import { PLATFORM_CONFIGS } from "../../config/platforms.js";
import { logger } from "../../utils/logger.js";
import {
  inspectShopPlatformLogin,
  runShopPlatformCheckLoginSmallFeature,
  runShopPlatformOpenWorkspaceSmallFeature,
} from "../shopLoginFeatures.js";

const PLATFORM_KEY = "pdd";
const PLATFORM_NAME = "拼多多";
const COOKIE_DOMAIN_PATTERNS = [
  /pinduoduo\.com$/i,
  /yangkeduo\.com$/i,
  /pddugc\.com$/i,
];
const PDD_LOGIN_URL = "https://mms.pinduoduo.com/login/";
const PDD_ACCOUNT_LOGIN_TEXT = "账号登录";
const PDD_ACCOUNT_INPUT_PLACEHOLDER = "请输入账号名/手机号";
const PDD_PASSWORD_INPUT_PLACEHOLDER = "请输入密码";

function normalizeBoolean(value, fallback = false) {
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
  return fallback;
}

function normalizeText(value) {
  return String(value || "").trim();
}

function isRelevantCookie(cookie) {
  const domain = normalizeText(cookie?.domain).replace(/^\./, "");
  if (!domain) {
    return false;
  }
  return COOKIE_DOMAIN_PATTERNS.some((pattern) => pattern.test(domain));
}

function buildCookieMap(cookies = []) {
  return cookies
    .filter(isRelevantCookie)
    .reduce((result, cookie) => {
      const name = normalizeText(cookie?.name);
      if (name && cookie?.value !== undefined && cookie?.value !== null) {
        result[name] = String(cookie.value);
      }
      return result;
    }, {});
}

function buildCookieHeader(cookies = {}) {
  return Object.entries(cookies)
    .filter(([name, value]) => normalizeText(name) && value !== undefined && value !== null)
    .map(([name, value]) => `${name}=${value}`)
    .join("; ");
}

function firstNonEmpty(...values) {
  return values.map(normalizeText).find(Boolean) || "";
}

function pickUserInfoFromCandidate(candidate = {}) {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return {};
  }

  const user =
    candidate.user ||
    candidate.userInfo ||
    candidate.account ||
    candidate.accountInfo ||
    candidate.operator ||
    {};

  const shop =
    candidate.mall ||
    candidate.mallInfo ||
    candidate.shop ||
    candidate.shopInfo ||
    candidate.store ||
    candidate.storeInfo ||
    candidate.merchant ||
    candidate.merchantInfo ||
    {};

  return {
    userId: firstNonEmpty(
      candidate.userId,
      candidate.uid,
      candidate.id,
      user.userId,
      user.uid,
      user.id,
      user.accountId,
    ),
    userName: firstNonEmpty(
      candidate.userName,
      candidate.name,
      candidate.nickName,
      candidate.nickname,
      user.userName,
      user.name,
      user.nickName,
      user.nickname,
      user.accountName,
    ),
    shopId: firstNonEmpty(
      candidate.mallId,
      candidate.mall_id,
      candidate.shopId,
      candidate.shop_id,
      candidate.storeId,
      candidate.merchantId,
      shop.mallId,
      shop.mall_id,
      shop.shopId,
      shop.shop_id,
      shop.storeId,
      shop.id,
      shop.merchantId,
    ),
    shopName: "",
    accountId: firstNonEmpty(
      candidate.accountId,
      candidate.account_id,
      user.accountId,
      user.account_id,
      user.id,
    ),
    accountName: firstNonEmpty(
      candidate.accountName,
      candidate.account_name,
      user.accountName,
      user.account_name,
      user.name,
      user.nickName,
    ),
    roles: Array.isArray(candidate.roles)
      ? candidate.roles
      : Array.isArray(user.roles)
        ? user.roles
        : [],
  };
}

function mergeUserInfo(...items) {
  return items.reduce(
    (result, item) => {
      const userInfo = pickUserInfoFromCandidate(item);
      return {
        userId: result.userId || userInfo.userId || "",
        userName: result.userName || userInfo.userName || "",
        shopId: result.shopId || userInfo.shopId || "",
        shopName: "",
        accountId: result.accountId || userInfo.accountId || "",
        accountName: result.accountName || userInfo.accountName || "",
        roles: result.roles.length ? result.roles : userInfo.roles || [],
      };
    },
    {
      userId: "",
      userName: "",
      shopId: "",
      shopName: "",
      accountId: "",
      accountName: "",
      roles: [],
    },
  );
}

async function collectPddUserInfo(page) {
  return await page
    .evaluate(() => {
      const safeParse = (value) => {
        if (!value || typeof value !== "string") return null;
        try {
          return JSON.parse(value);
        } catch {
          return null;
        }
      };

      const readStorage = (storage) => {
        const result = {};
        for (let index = 0; index < storage.length; index += 1) {
          const key = storage.key(index);
          if (!key) continue;
          if (!/(user|account|mall|shop|store|merchant|operator|seller|login)/i.test(key)) {
            continue;
          }
          const parsed = safeParse(storage.getItem(key));
          if (parsed && typeof parsed === "object") {
            result[key] = parsed;
          }
        }
        return result;
      };

      const pickText = (selectors) => {
        for (const selector of selectors) {
          const el = document.querySelector(selector);
          const text = el?.textContent?.trim();
          if (text) return text;
        }
        return "";
      };

      return {
        globals: {
          initialState: window.__INITIAL_STATE__ || null,
          appData: window.__APP_DATA__ || null,
          reduxState: window.__REDUX_STATE__ || null,
          modernServerData: window.__MODERN_SERVER_DATA__ || null,
          rawData: window.rawData || null,
        },
        localStorage: readStorage(window.localStorage),
        sessionStorage: readStorage(window.sessionStorage),
        dom: {
          userName: pickText([
            "[class*='user'] [class*='name']",
            "[class*='account'] [class*='name']",
            "[class*='nickname']",
            "[class*='avatar']",
          ]),
        },
      };
    })
    .then((snapshot) => {
      const candidates = [
        snapshot?.globals?.initialState,
        snapshot?.globals?.appData,
        snapshot?.globals?.reduxState,
        snapshot?.globals?.modernServerData,
        snapshot?.globals?.rawData,
        ...Object.values(snapshot?.localStorage || {}),
        ...Object.values(snapshot?.sessionStorage || {}),
      ];
      const merged = mergeUserInfo(...candidates);
      return {
        ...merged,
        userName: merged.userName || normalizeText(snapshot?.dom?.userName),
        shopName: "",
        rawSnapshot: snapshot,
      };
    })
    .catch((error) => {
      logger.warn(`${PLATFORM_NAME}页面身份信息提取失败`, {
        error: error?.message || String(error),
      });
      return {
        userId: "",
        userName: "",
        shopId: "",
        shopName: "",
        accountId: "",
        accountName: "",
        roles: [],
        rawSnapshot: null,
      };
    });
}

export async function runPddCheckLoginSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  return await runShopPlatformCheckLoginSmallFeature(
    PLATFORM_KEY,
    input,
    runtimeOptions,
  );
}

export async function runPddOpenWorkspaceSmallFeature(
  input = {},
  runtimeOptions = {},
) {
  return await runShopPlatformOpenWorkspaceSmallFeature(
    PLATFORM_KEY,
    input,
    runtimeOptions,
  );
}

async function clickPddText(page, text, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const errors = [];
  const selectors = [
    `text="${text}"`,
    `button:has-text("${text}")`,
    `[role="button"]:has-text("${text}")`,
    `a:has-text("${text}")`,
    `[tabindex]:has-text("${text}")`,
  ];

  while (Date.now() < deadline) {
    for (const selector of selectors) {
      try {
        const locator = page.locator(selector).first();
        await locator.waitFor({ state: "visible", timeout: 800 });
        const snapshot = await getPddElementSnapshot(locator);
        await locator.click({ timeout: 3000 });
        return {
          clicked: true,
          selector,
          text,
          element: snapshot,
        };
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }

    await page.waitForTimeout(500);
  }

  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label}：${text}（${errors.slice(-3).join(" | ")}）`,
  );
}

async function getPddElementSnapshot(locator) {
  return await locator
    .evaluate((element) => ({
      tagName: element.tagName,
      className:
        typeof element.className === "string"
          ? element.className
          : String(element.className || ""),
      text: String(element.textContent || "").trim().slice(0, 80),
      role: element.getAttribute("role") || "",
      placeholder: element.getAttribute("placeholder") || "",
    }))
    .catch(() => null);
}

async function fillPddLoginInput(page, placeholder, value, label, timeoutMs = 15000) {
  const normalizedValue = normalizeText(value);
  if (!normalizedValue) {
    throw new Error(`请先填写拼多多${label}`);
  }

  const locator = page.locator(`input[placeholder="${placeholder}"]`).first();
  await locator.waitFor({ state: "visible", timeout: timeoutMs });
  const snapshot = await getPddElementSnapshot(locator);
  await locator.fill("");
  await locator.fill(normalizedValue);
  return {
    filled: true,
    placeholder,
    element: snapshot,
  };
}

async function clickPddSubmitLoginButton(page, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  const errors = [];

  while (Date.now() < deadline) {
    try {
      const locator = page.locator("button").filter({ hasText: "登录" }).first();
      await locator.waitFor({ state: "visible", timeout: 800 });
      const snapshot = await getPddElementSnapshot(locator);
      await locator.click({ timeout: 3000 });
      return {
        clicked: true,
        selector: 'button:has-text("登录")',
        element: snapshot,
      };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
    await page.waitForTimeout(500);
  }

  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击登录 button（${errors.slice(-3).join(" | ")}）`,
  );
}

export async function runPddClickLoginSmallFeature(input = {}, runtimeOptions = {}) {
  const platformConfig = PLATFORM_CONFIGS?.[PLATFORM_KEY];
  if (!platformConfig) {
    throw new Error("拼多多平台配置不存在");
  }

  const profileId = normalizeText(input?.profileId) || undefined;
  const account = normalizeText(input?.account);
  const password = normalizeText(input?.password);
  const keepPageOpen = normalizeBoolean(input?.keepPageOpen, true);
  const targetUrl = normalizeText(input?.loginUrl) || PDD_LOGIN_URL;
  const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
  const executionTrace = [];
  const clickedAt = new Date().toISOString();
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
    logger.info(`${PLATFORM_NAME}开始点击登录`, {
      profileId: profileId || "default",
      targetUrl,
      keepPageOpen,
    });
    pushTrace("start", "success", {
      profileId: profileId || null,
      targetUrl,
      keepPageOpen,
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
    pushTrace("open_login_page", "success", {
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
    });

    const modeClickResult = await clickPddText(
      page,
      PDD_ACCOUNT_LOGIN_TEXT,
      "账号登录入口",
    );
    await page.waitForTimeout(800);
    pushTrace("click_account_login", "success", modeClickResult);

    const accountFillResult = await fillPddLoginInput(
      page,
      PDD_ACCOUNT_INPUT_PLACEHOLDER,
      account,
      "账号",
    );
    pushTrace("fill_account", "success", {
      ...accountFillResult,
      valueLength: account.length,
    });

    const passwordFillResult = await fillPddLoginInput(
      page,
      PDD_PASSWORD_INPUT_PLACEHOLDER,
      password,
      "密码",
    );
    pushTrace("fill_password", "success", {
      ...passwordFillResult,
      valueLength: password.length,
    });

    const clickResult = await clickPddSubmitLoginButton(page);
    await page.waitForTimeout(1200);
    pushTrace("click_login", "success", clickResult);

    return {
      success: true,
      message: `${PLATFORM_NAME}已点击登录`,
      data: {
        featureKey: "pdd-click-login",
        platform: PLATFORM_KEY,
        platformName: PLATFORM_NAME,
        profileId: profileId || null,
        clickedAt,
        accountProvided: !!account,
        passwordProvided: !!password,
        modeClickResult,
        clickResult,
        currentUrl: page.url(),
        pageTitle: await page.title().catch(() => ""),
        executionTrace,
        pageKeptOpen: keepPageOpen,
      },
    };
  } catch (error) {
    logger.error(`${PLATFORM_NAME}点击登录失败:`, error);
    pushTrace("click_login", "failed", {
      error: error?.message || String(error || ""),
    });
    return {
      success: false,
      message: error?.message || `${PLATFORM_NAME}点击登录失败`,
      data: {
        featureKey: "pdd-click-login",
        platform: PLATFORM_KEY,
        platformName: PLATFORM_NAME,
        profileId: profileId || null,
        clickedAt,
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

export async function runPddSessionAcquireSmallFeature(input = {}, runtimeOptions = {}) {
  const platformConfig = PLATFORM_CONFIGS?.[PLATFORM_KEY];
  if (!platformConfig) {
    throw new Error("拼多多平台配置不存在");
  }

  const profileId = normalizeText(input?.profileId) || undefined;
  const keepPageOpen = normalizeBoolean(input?.keepPageOpen, true);
  const includeDebugInfo = normalizeBoolean(input?.includeDebugInfo, false);
  const targetUrl = platformConfig.loginCheckUrl || platformConfig.uploadUrl;
  const pageOperator = runtimeOptions?.pageOperator || new PageOperator();
  const executionTrace = [];
  const collectedAt = new Date().toISOString();
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
    logger.info(`${PLATFORM_NAME}开始采集登录信息`, {
      profileId: profileId || "default",
      targetUrl,
      keepPageOpen,
    });
    pushTrace("start", "success", {
      profileId: profileId || null,
      targetUrl,
      keepPageOpen,
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
    await page.waitForTimeout(2500);
    pushTrace("open_target_page", "success", {
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
    });

    const loginResult = await inspectShopPlatformLogin(page, PLATFORM_KEY);
    pushTrace(
      "check_login",
      loginResult.isLoggedIn ? "success" : "pending",
      loginResult,
    );

    if (!loginResult.isLoggedIn) {
      return {
        success: false,
        message: `${PLATFORM_NAME}当前未登录，请先在浏览器环境中完成登录`,
        data: {
          featureKey: "pdd-session-acquire",
          platform: PLATFORM_KEY,
          platformName: PLATFORM_NAME,
          profileId: profileId || null,
          collectedAt,
          isLoggedIn: false,
          loginResult,
          currentUrl: page.url(),
          pageTitle: await page.title().catch(() => ""),
          executionTrace,
          pageKeptOpen: keepPageOpen,
        },
      };
    }

    const context = page.context();
    const browserCookies = await context.cookies([
      "https://mms.pinduoduo.com",
      "https://mai.pinduoduo.com",
      "https://pinduoduo.com",
      "https://yangkeduo.com",
    ]);
    const cookies = buildCookieMap(browserCookies);
    const userInfo = await collectPddUserInfo(page);
    const userAgent = await page.evaluate(() => navigator.userAgent).catch(() => "");
    const headersTemplate = {
      accept: "application/json, text/plain, */*",
      origin: "https://mms.pinduoduo.com",
      referer: page.url(),
      ...(userAgent ? { "user-agent": userAgent } : {}),
    };
    const cookieHeader = buildCookieHeader(cookies);
    const hasIdentity = !!(
      userInfo.userId ||
      userInfo.userName ||
      userInfo.accountId ||
      userInfo.accountName
    );
    const hasShop = !!userInfo.shopId;
    const sessionBundle = {
      source: "browser_tab",
      success: true,
      platform: PLATFORM_KEY,
      profileId: profileId || null,
      currentUrl: page.url(),
      pageTitle: await page.title().catch(() => ""),
      collectedAt,
      userAgent,
      userId: userInfo.userId,
      userName: userInfo.userName,
      shopId: userInfo.shopId,
      shopName: "",
      accountId: userInfo.accountId,
      accountName: userInfo.accountName,
      roles: userInfo.roles,
      headers: headersTemplate,
      headersTemplate,
      cookies,
      cookieHeader,
      cookieCount: Object.keys(cookies).length,
      userInfo: {
        status: hasIdentity || hasShop ? "success" : "missing",
        message:
          hasIdentity || hasShop
            ? "浏览器环境已同步拼多多用户信息"
            : "已采集 Cookie，但页面身份信息不足",
        fetchedAt: collectedAt,
        userId: userInfo.userId,
        userName: userInfo.userName,
        shopId: userInfo.shopId,
        shopName: "",
        accountId: userInfo.accountId,
        accountName: userInfo.accountName,
        roles: userInfo.roles,
      },
      validation: {
        status: Object.keys(cookies).length && hasIdentity ? "fresh" : "incomplete",
        message: Object.keys(cookies).length
          ? "会话已采集，建议保存后校验"
          : "未采集到可用 Cookie",
        checkedAt: collectedAt,
      },
      session: {
        seller: {
          cookies,
          headers: headersTemplate,
          updatedAt: collectedAt,
        },
      },
      ...(includeDebugInfo ? { rawUserInfoSnapshot: userInfo.rawSnapshot } : {}),
    };

    return {
      success: Object.keys(cookies).length > 0,
      message: Object.keys(cookies).length
        ? `${PLATFORM_NAME}登录信息采集成功`
        : `${PLATFORM_NAME}未采集到可用 Cookie`,
      data: {
        featureKey: "pdd-session-acquire",
        platform: PLATFORM_KEY,
        platformName: PLATFORM_NAME,
        profileId: profileId || null,
        collectedAt,
        isLoggedIn: true,
        sessionBundle,
        executionTrace,
        pageKeptOpen: keepPageOpen,
      },
    };
  } catch (error) {
    logger.error(`${PLATFORM_NAME}登录信息采集失败:`, error);
    pushTrace("session_acquire", "failed", {
      error: error?.message || String(error || ""),
    });
    return {
      success: false,
      message: error?.message || `${PLATFORM_NAME}登录信息采集失败`,
      data: {
        featureKey: "pdd-session-acquire",
        platform: PLATFORM_KEY,
        platformName: PLATFORM_NAME,
        profileId: profileId || null,
        collectedAt,
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
