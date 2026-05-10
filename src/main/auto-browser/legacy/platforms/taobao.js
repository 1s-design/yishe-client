import fs from "fs";
import path from "path";
import { getOrCreateBrowser } from "../services/BrowserService.js";
import { ImageManager } from "../services/ImageManager.js";
import { PageOperator } from "../services/PageOperator.js";
import { isShopPlatformLoggedIn } from "./shopLoginFeatures.js";
import { logger } from "../utils/logger.js";

const PLATFORM_KEY = "taobao";
const DEFAULT_PUBLISH_URL = "https://item.upload.taobao.com/sell/v2/publish.htm";
const QIANNIU_MATERIAL_CENTER_URL =
  "https://qn.taobao.com/home.htm/material-center/mine-material/";
const TAOBAO_ACTION_DELAY_MS = 900;
const TAOBAO_IMAGE_LIBRARY_DELAY_RANGE_MS = [1600, 3800];
const TAOBAO_MATERIAL_UPLOAD_TIMEOUT_MS = 180000;
const TAOBAO_SECURITY_CHECK_TIMEOUT_MS = 90 * 1000;
const TAOBAO_SECURITY_CHECK_POLL_MS = 1500;
const TAOBAO_TITLE_MAX_LENGTH = 30;
const TAOBAO_IMAGE_RESULT_LIST_SELECTOR =
  '[class^="PicList_PicturesShow_main-document__"], [class*=" PicList_PicturesShow_main-document__"]';
const TAOBAO_IMAGE_EMPTY_RESULT_PATTERN =
  /暂无数据|暂无图片|无搜索结果|没有找到|未找到|没有相关|No data/i;
const TAOBAO_SECURITY_TEXT_PATTERN =
  /验证码|安全验证|拖动滑块|请完成验证|请按住滑块|风险验证/;
const SAFE_TAOBAO_IMAGE_EXTENSIONS = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".gif",
]);

function toUserFriendlyPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function getPathFileName(filePath) {
  return path.posix.basename(toUserFriendlyPath(filePath));
}

function getUploadedLocalFileName(filePath) {
  return getPathFileName(filePath);
}

function safeDecodeURIComponent(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function addTaobaoImageSearchName(candidates, value) {
  const normalized = String(value || "").replace(/\s+/g, " ").trim();
  if (!normalized) return;
  candidates.push(normalized);
}

function isTaobaoNoiseHashSuffix(value) {
  const normalized = String(value || "").replace(/^\./, "");
  return /^[a-f0-9]{24,}$/i.test(normalized);
}

function stripTaobaoNoiseHashSuffix(value) {
  const normalized = String(value || "").trim();
  const dotIndex = normalized.lastIndexOf(".");
  if (dotIndex <= 0) {
    return normalized;
  }

  const suffix = normalized.slice(dotIndex + 1);
  if (!isTaobaoNoiseHashSuffix(suffix)) {
    return normalized;
  }

  return normalized.slice(0, dotIndex);
}

function getSafeTaobaoImageExtension(filePath) {
  const fileName = getPathFileName(filePath);
  const ext = path.posix.extname(fileName).toLowerCase();
  return SAFE_TAOBAO_IMAGE_EXTENSIONS.has(ext) ? ext : ".jpg";
}

function sanitizeTaobaoMaterialBaseName(value, fallback) {
  const stripped = stripTaobaoNoiseHashSuffix(safeDecodeURIComponent(value));
  const withoutExt = stripTaobaoNoiseHashSuffix(
    stripped.slice(0, stripped.length - path.posix.extname(stripped).length),
  );
  const sanitized = String(withoutExt || "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96);
  return sanitized || fallback;
}

function buildShortTaobaoMaterialBaseName(value, index, runId) {
  const sanitized = sanitizeTaobaoMaterialBaseName(value, `img_${index + 1}`);
  const firstToken = sanitized.split("_").find(Boolean) || `img${index + 1}`;
  const shortToken = firstToken.slice(0, 8).toLowerCase();
  return `tb_${runId}_${index + 1}_${shortToken}`;
}

function isShortTaobaoMaterialName(value) {
  return /^tb_[a-z0-9]{1,12}_\d+_[a-z0-9]{1,16}$/i.test(String(value || ""));
}

function resolveUniqueFilePath(dir, baseName, ext) {
  let candidate = path.join(dir, `${baseName}${ext}`);
  let counter = 2;
  while (fs.existsSync(candidate)) {
    candidate = path.join(dir, `${baseName}_${counter}${ext}`);
    counter += 1;
  }
  return candidate;
}

function getUploadedLocalFileSearchNames(filePath) {
  const fileName = getUploadedLocalFileName(filePath);
  const decodedFileName = safeDecodeURIComponent(fileName);
  const ext = path.posix.extname(fileName);
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName;
  const decodedExt = path.posix.extname(decodedFileName);
  const decodedNameWithoutExt = decodedExt
    ? decodedFileName.slice(0, -decodedExt.length)
    : decodedFileName;
  const candidates = [];
  const hasNoiseHashSuffix =
    (ext && isTaobaoNoiseHashSuffix(ext)) ||
    (decodedExt && isTaobaoNoiseHashSuffix(decodedExt));
  if (isShortTaobaoMaterialName(nameWithoutExt)) {
    return [nameWithoutExt, fileName];
  }

  const names = hasNoiseHashSuffix
    ? [nameWithoutExt, decodedNameWithoutExt]
    : [nameWithoutExt, fileName, decodedNameWithoutExt, decodedFileName];

  for (const name of names) {
    addTaobaoImageSearchName(candidates, name);
    addTaobaoImageSearchName(candidates, name.replace(/[_-]+/g, " "));
    addTaobaoImageSearchName(candidates, name.replace(/\s+/g, "_"));
  }

  for (const name of [nameWithoutExt, decodedNameWithoutExt]) {
    addTaobaoImageSearchName(candidates, name.replace(/\s*[(（]\d+[)）]\s*$/u, ""));
    addTaobaoImageSearchName(candidates, name.replace(/[_-]\d+$/u, ""));
    const dotSegments = name.split(".");
    const lastDotSegment = dotSegments.at(-1);
    if (dotSegments.length > 1 && isTaobaoNoiseHashSuffix(lastDotSegment)) {
      addTaobaoImageSearchName(candidates, dotSegments.slice(0, -1).join("."));
    }
  }

  return Array.from(
    new Set(candidates.filter(Boolean)),
  );
}

function normalizeTitle(title) {
  const normalized = String(title || "").trim();
  return Array.from(normalized).slice(0, TAOBAO_TITLE_MAX_LENGTH).join("");
}

function normalizeProductCode(productCode) {
  return String(productCode || "").trim();
}

function resolvePublishUrl(settings = {}, publishInfo = {}) {
  const itemId = String(settings.itemId || publishInfo.itemId || "").trim();
  if (!itemId) {
    throw new Error("淘宝复制商品 itemId 不能为空");
  }
  const url = new URL(DEFAULT_PUBLISH_URL);
  url.searchParams.set("copyItem", "true");
  url.searchParams.set("itemId", itemId);
  url.searchParams.set("fromAIPublish", "true");
  return {
    itemId,
    url: url.toString(),
  };
}

async function prepareImages(images, imageManager) {
  const filePaths = [];
  const tempFiles = [];
  const runId = Date.now();

  for (const [index, rawSource] of images.entries()) {
    const source = String(rawSource || "").trim();
    if (!source) continue;

    if (/^https?:\/\//i.test(source)) {
      const tempPath = await imageManager.downloadImage(
        source,
        `${PLATFORM_KEY}_${runId}_${index + 1}`,
      );
      filePaths.push(tempPath);
      tempFiles.push(tempPath);
      continue;
    }

    if (fs.existsSync(source)) {
      filePaths.push(source);
    }
  }

  return { filePaths, tempFiles };
}

async function checkLogin(page) {
  return await isShopPlatformLoggedIn(page, PLATFORM_KEY);
}

async function waitTaobaoActionDelay(page, reason = "action") {
  await page.waitForTimeout(TAOBAO_ACTION_DELAY_MS);
  logger.debug?.("淘宝操作节流等待完成", {
    reason,
    delayMs: TAOBAO_ACTION_DELAY_MS,
  });
}

function randomIntBetween(min, max) {
  return Math.floor(min + Math.random() * (max - min + 1));
}

async function waitTaobaoImageLibraryDelay(page, reason = "image_library_action") {
  const [minDelay, maxDelay] = TAOBAO_IMAGE_LIBRARY_DELAY_RANGE_MS;
  const delayMs = randomIntBetween(minDelay, maxDelay);
  await page.waitForTimeout(delayMs);
  logger.info("淘宝图片库随机等待完成", {
    reason,
    delayMs,
  });
}

async function getTaobaoSecuritySignal(target) {
  try {
    const signal = await target.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource);
      const isVisible = (element) => {
        if (!element || element === document.body || element === document.documentElement) {
          return false;
        }
        const style = window.getComputedStyle(element);
        if (
          style.display === "none" ||
          style.visibility === "hidden" ||
          Number(style.opacity) === 0
        ) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width >= 20 && rect.height >= 12;
      };
      const visibleElements = Array.from(
        document.querySelectorAll(
          [
            "button",
            "[role='button']",
            "span",
            "div",
            "p",
            "label",
            "[class*='captcha']",
            "[id*='captcha']",
            "[class*='nc-container']",
            "[class*='slider']",
            "[class*='verify']",
          ].join(","),
        ),
      ).filter(isVisible);

      const matchedTextElement = visibleElements.find((element) => {
        const text = String(element.innerText || element.textContent || "")
          .replace(/\s+/g, " ")
          .trim();
        return text && text.length <= 300 && pattern.test(text);
      });
      const matchedNodeElement = visibleElements.find((element) => {
        const marker = `${element.id || ""} ${element.className || ""}`;
        if (!/(captcha|nc-container|slider|verify)/i.test(marker)) {
          return false;
        }
        const rect = element.getBoundingClientRect();
        return rect.width >= 120 && rect.height >= 30;
      });
      const matchedText = !!matchedTextElement;
      const matchedNode = !!matchedNodeElement;
      const previewElement = matchedTextElement || matchedNodeElement;
      const textPreview = String(
        previewElement?.innerText || previewElement?.textContent || document.body?.innerText || "",
      )
        .replace(/\s+/g, " ")
        .slice(0, 160);
      return {
        detected: matchedText || matchedNode,
        matchedText,
        matchedNode,
        textPreview,
      };
    }, TAOBAO_SECURITY_TEXT_PATTERN.source);

    return signal?.detected ? signal : null;
  } catch {
    return null;
  }
}

async function detectTaobaoSecurityCheck(page, frames = []) {
  const pageSignal = await getTaobaoSecuritySignal(page);
  if (pageSignal) {
    return {
      scope: "page",
      ...pageSignal,
    };
  }

  for (const [index, frame] of frames.filter(Boolean).entries()) {
    const frameSignal = await getTaobaoSecuritySignal(frame);
    if (frameSignal) {
      return {
        scope: `frame-${index}`,
        frameUrl: getFrameUrl(frame),
        ...frameSignal,
      };
    }
  }

  return null;
}

async function waitTaobaoSecurityCheckResolved(page, options = {}) {
  const {
    frames = [],
    timeoutMs = TAOBAO_SECURITY_CHECK_TIMEOUT_MS,
    pollMs = TAOBAO_SECURITY_CHECK_POLL_MS,
    reason = "security_check",
  } = options;
  const firstSignal = await detectTaobaoSecurityCheck(page, frames);
  if (!firstSignal) {
    return true;
  }

  logger.warn("淘宝检测到安全验证/滑块，暂停等待人工处理", {
    reason,
    timeoutMs,
    signal: firstSignal,
  });
  try {
    await page.bringToFront?.();
  } catch {
    // ignore
  }

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    await page.waitForTimeout(pollMs);
    const signal = await detectTaobaoSecurityCheck(page, frames);
    if (!signal) {
      logger.info("淘宝安全验证已消失，继续自动化流程", {
        reason,
        waitedMs: Date.now() - startedAt,
      });
      await waitTaobaoActionDelay(page, `${reason}:resolved`);
      return true;
    }
  }

  logger.warn("淘宝安全验证等待超时", {
    reason,
    timeoutMs,
  });
  return false;
}

async function fillTextLocator(locator, value) {
  if ((await locator.count()) <= 0) {
    return false;
  }
  await locator.waitFor({ timeout: 3000, state: "visible" });
  await locator.scrollIntoViewIfNeeded().catch(() => undefined);
  await locator.click({ clickCount: 3 }).catch(() => undefined);
  await locator.fill("").catch(() => undefined);
  await locator.fill(value);
  return true;
}

async function fillTaobaoTitle(page, title) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    logger.info("淘宝标题为空，跳过填写");
    return false;
  }

  const selectors = [
    '#sell-field-title input',
    '#sell-field-title textarea',
    'xpath=//*[@id="sell-field-title"]//following::input[1]',
    'xpath=//*[@id="sell-field-title"]//following::textarea[1]',
    'input[placeholder*="标题"]',
    'textarea[placeholder*="标题"]',
    'input[placeholder*="宝贝"]',
    'textarea[placeholder*="宝贝"]',
    'input[name*="title"]',
    'textarea[name*="title"]',
  ];

  for (const selector of selectors) {
    try {
      const locator = page.locator(selector).first();
      if (await fillTextLocator(locator, normalizedTitle)) {
        logger.info(`淘宝标题已填写: selector=${selector}, title=${normalizedTitle}`);
        return true;
      }
    } catch (error) {
      logger.warn(`淘宝标题填写尝试失败: selector=${selector}, error=${error?.message || error}`);
    }
  }

  logger.warn("淘宝未找到可填写的标题输入框");
  return false;
}

async function fillTaobaoSkuOuterIds(page, productCode) {
  const normalizedProductCode = normalizeProductCode(productCode);
  const result = {
    fieldCount: 0,
    filledCount: 0,
  };

  if (!normalizedProductCode) {
    logger.info("淘宝 productCode 为空，跳过 skuOuterId 填写");
    return result;
  }

  const fieldLocator = page.locator('[id$="-skuOuterId"]');
  const fieldCount = await fieldLocator.count().catch(() => 0);
  result.fieldCount = fieldCount;

  if (fieldCount <= 0) {
    logger.warn("淘宝未找到 skuOuterId 字段区域");
    return result;
  }

  for (let index = 0; index < fieldCount; index += 1) {
    const field = fieldLocator.nth(index);
    const fieldId = await field.getAttribute("id").catch(() => "");
    const inputCandidates = [
      field.locator("input, textarea").first(),
      field.locator(
        'xpath=following::*[(self::input or self::textarea) and not(@disabled)][1]',
      ),
    ];

    let filled = false;
    for (const input of inputCandidates) {
      try {
        if (await fillTextLocator(input, normalizedProductCode)) {
          filled = true;
          result.filledCount += 1;
          logger.info("淘宝 skuOuterId 已填写", {
            index,
            fieldId,
            productCode: normalizedProductCode,
          });
          break;
        }
      } catch (error) {
        logger.warn("淘宝 skuOuterId 填写尝试失败", {
          index,
          fieldId,
          error: error?.message || String(error),
        });
      }
    }

    if (!filled) {
      logger.warn("淘宝 skuOuterId 未找到可填写输入框", {
        index,
        fieldId,
      });
    }
  }

  logger.info("淘宝 skuOuterId 填写流程结束", {
    fieldCount: result.fieldCount,
    filledCount: result.filledCount,
  });
  return result;
}

async function clickTextButtonInLocator(rootLocator, text, timeout = 5000) {
  const candidates = [
    rootLocator.locator("button").filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first(),
    rootLocator.locator('[role="button"]').filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) }).first(),
    rootLocator.locator(`text="${text}"`).first(),
  ];

  for (const candidate of candidates) {
    try {
      if ((await candidate.count().catch(() => 0)) <= 0) {
        continue;
      }
      await candidate.waitFor({ timeout, state: "visible" });
      await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
      await candidate.click({ timeout });
      return true;
    } catch {
      // Try the next candidate. Taobao often wraps button text in nested spans.
    }
  }

  return false;
}

async function clickTextButtonByPatternInLocator(rootLocator, pattern, timeout = 5000) {
  const candidates = [
    rootLocator.locator("button").filter({ hasText: pattern }).first(),
    rootLocator.locator('[role="button"]').filter({ hasText: pattern }).first(),
    rootLocator.locator("*").filter({ hasText: pattern }).first(),
  ];

  for (const candidate of candidates) {
    try {
      if ((await candidate.count().catch(() => 0)) <= 0) {
        continue;
      }
      await candidate.waitFor({ timeout, state: "visible" });
      await candidate.scrollIntoViewIfNeeded().catch(() => undefined);
      await candidate.click({ timeout });
      return true;
    } catch {
      // Try the next candidate. Some dialogs render buttons as nested text nodes.
    }
  }

  return false;
}

async function clearTaobaoDetailImages(page) {
  const result = {
    containerFound: false,
    clearClicked: false,
    confirmClicked: false,
  };
  const container = page.locator("#struct-descRepublicOfSell").first();

  try {
    await container.waitFor({ timeout: 10000, state: "visible" });
    await container.scrollIntoViewIfNeeded().catch(() => undefined);
    result.containerFound = true;
  } catch (error) {
    logger.warn("淘宝未找到详情图容器 #struct-descRepublicOfSell", {
      error: error?.message || String(error),
    });
    return result;
  }

  result.clearClicked = await clickTextButtonInLocator(container, "清空");
  if (!result.clearClicked) {
    logger.warn("淘宝详情图容器内未找到清空按钮");
    return result;
  }
  logger.info("淘宝详情图已点击清空按钮");
  await page.waitForTimeout(300);

  result.confirmClicked = await clickTextButtonInLocator(page, "确定", 8000);
  if (!result.confirmClicked) {
    logger.warn("淘宝详情图清空弹窗未找到确定按钮");
    return result;
  }

  logger.info("淘宝详情图清空已确认");
  return result;
}

async function openTaobaoDetailImagePanel(page) {
  const result = {
    containerFound: false,
    panelFound: false,
    imageButtonClicked: false,
  };
  const container = page.locator("#struct-descRepublicOfSell").first();

  try {
    await container.waitFor({ timeout: 10000, state: "visible" });
    await container.scrollIntoViewIfNeeded().catch(() => undefined);
    result.containerFound = true;
  } catch (error) {
    logger.warn("淘宝未找到详情图容器，无法打开图片选择面板", {
      error: error?.message || String(error),
    });
    return result;
  }

  const panel = container.locator("#panel_edit").first();
  try {
    await panel.waitFor({ timeout: 8000, state: "visible" });
    result.panelFound = true;
  } catch (error) {
    logger.warn("淘宝详情图容器内未找到 #panel_edit", {
      error: error?.message || String(error),
    });
    return result;
  }

  await waitTaobaoActionDelay(page, "detail_images_before_open_panel_click");
  result.imageButtonClicked = await clickTextButtonInLocator(panel, "图片", 8000);
  if (!result.imageButtonClicked) {
    logger.warn("淘宝详情图 #panel_edit 内未找到图片按钮");
    return result;
  }

  logger.info("淘宝详情图图片选择面板已打开");
  await waitTaobaoActionDelay(page, "detail_images_after_open_panel_click");
  return result;
}

async function getTaobaoMainImagesFrame(page) {
  const frameElement = page.locator('iframe#mainImagesGroup');
  await frameElement.waitFor({ timeout: 10000, state: "attached" });
  return await frameElement.contentFrame();
}

async function getTaobaoDetailImagesFrame(page) {
  const frameElement = page.locator(".media-img-plug iframe").first();
  await frameElement.waitFor({ timeout: 10000, state: "attached" });
  return await frameElement.contentFrame();
}

function getTaobaoSearchScopes(page) {
  return [page, ...page.frames()];
}

function buildTaobaoTextLocators(scope, text) {
  const locators = [];

  if (typeof scope.getByRole === "function") {
    locators.push(scope.getByRole("button", { name: text, exact: true }));
    locators.push(scope.getByRole("button", { name: new RegExp(text) }));
  }

  locators.push(scope.locator("button").filter({ hasText: text }));
  locators.push(scope.locator('[role="button"]').filter({ hasText: text }));

  if (typeof scope.getByText === "function") {
    locators.push(scope.getByText(text, { exact: true }));
    locators.push(scope.getByText(new RegExp(text)));
  }

  return locators.map((locator) => locator.first());
}

async function clickTaobaoText(page, text, label, options = {}) {
  const timeout = options.timeout ?? 15000;
  const scopes = getTaobaoSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    for (const locator of buildTaobaoTextLocators(scope, text)) {
      try {
        await locator.waitFor({ state: "visible", timeout: Math.min(timeout, 1500) });
        await locator.scrollIntoViewIfNeeded().catch(() => undefined);
        await locator.click({ timeout: 5000 });
        logger.info(`淘宝${label}点击成功`, { text });
        return { clicked: true, text };
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }
  }

  throw new Error(
    `淘宝未找到或无法点击${label}：${text}（${errors.slice(-3).join(" | ")}）`,
  );
}

async function waitTaobaoMaterialUploadFinished(page, expectedCount) {
  const startedAt = Date.now();
  const successHandle = await page.waitForFunction(
    () => {
      const bodyText = String(document.body?.innerText || "");
      const successMatched = bodyText.includes("文件上传成功");
      const doneVisible = Array.from(document.querySelectorAll("button, [role='button'], span, div"))
        .some((element) => {
          const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
          if (text !== "完成") return false;
          const style = window.getComputedStyle(element);
          const rect = element.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            Number(style.opacity) !== 0 &&
            rect.width > 0 &&
            rect.height > 0
          );
        });
      return successMatched && doneVisible
        ? { message: "文件上传成功", doneVisible }
        : false;
    },
    { timeout: TAOBAO_MATERIAL_UPLOAD_TIMEOUT_MS, polling: 800 },
  );

  const successResult = await successHandle.jsonValue();
  const elapsedMs = Date.now() - startedAt;
  logger.info("淘宝素材中心检测到上传成功提示", {
    expectedCount,
    message: successResult?.message || "",
    elapsedMs,
  });
  return {
    successCount: expectedCount,
    message: successResult?.message || "文件上传成功",
    elapsedMs,
  };
}

async function uploadTaobaoImagesToMaterialCenter(page, filePaths) {
  const result = {
    materialPageOpened: false,
    uploadFileClicked: false,
    fileInputFound: false,
    uploadSuccessCount: 0,
    uploadSuccessMessage: "",
    uploadElapsedMs: 0,
    doneClicked: false,
  };

  if (!filePaths.length) {
    return result;
  }

  logger.info("淘宝进入千牛素材中心上传页", {
    url: QIANNIU_MATERIAL_CENTER_URL,
    fileCount: filePaths.length,
    files: filePaths.map(getPathFileName),
  });

  await page.goto(QIANNIU_MATERIAL_CENTER_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  result.materialPageOpened = true;
  await page.waitForTimeout(3000);

  if (!(await checkLogin(page))) {
    throw new Error("请先登录淘宝/千牛商家后台");
  }

  const uploadFileClick = await clickTaobaoText(page, "上传文件", "素材中心上传文件按钮", {
    timeout: 30000,
  });
  result.uploadFileClicked = uploadFileClick.clicked;
  await waitTaobaoActionDelay(page, "material_center_after_upload_file_click");

  const fileInputs = page.locator("input[type=file]");
  await fileInputs.first().waitFor({ state: "attached", timeout: 30000 });

  const inputCount = await fileInputs.count().catch(() => 0);
  let fileInput = null;
  let inputSnapshot = null;
  for (let index = inputCount - 1; index >= 0; index -= 1) {
    const candidate = fileInputs.nth(index);
    const snapshot = await candidate
      .evaluate((element) => ({
        tagName: element.tagName,
        type: element.getAttribute("type") || "",
        accept: element.getAttribute("accept") || "",
        multiple: !!element.multiple,
        disabled: !!element.disabled,
      }))
      .catch(() => null);
    if (snapshot && !snapshot.disabled) {
      fileInput = candidate;
      inputSnapshot = { ...snapshot, index, inputCount };
      break;
    }
  }

  result.fileInputFound = !!fileInput;

  if (!fileInput) {
    throw new Error("淘宝素材中心未找到可用的上传 input[type=file]");
  }

  logger.info("淘宝准备通过千牛素材中心 input 批量上传图片", {
    fileCount: filePaths.length,
    inputSnapshot,
  });

  await fileInput.setInputFiles(filePaths);
  const uploadResult = await waitTaobaoMaterialUploadFinished(page, filePaths.length);
  result.uploadSuccessCount = uploadResult.successCount;
  result.uploadSuccessMessage = uploadResult.message;
  result.uploadElapsedMs = uploadResult.elapsedMs;

  const doneClick = await clickTaobaoText(page, "完成", "素材中心完成按钮", {
    timeout: 30000,
  });
  result.doneClicked = doneClick.clicked;
  await waitTaobaoActionDelay(page, "material_center_after_done_click");

  return result;
}

function getFrameUrl(frame) {
  if (!frame) return "";
  if (typeof frame.url === "function") {
    return frame.url();
  }
  return String(frame.url || "");
}

async function searchTaobaoImageNameInFrame(frame, searchName, index, contextName) {
  if (!frame) {
    logger.warn(`淘宝未找到${contextName} iframe，无法搜索图片名称`, { index });
    return false;
  }
  const page = frame.page?.();
  if (page) {
    if (!(await waitTaobaoSecurityCheckResolved(page, {
      frames: [frame],
      reason: `${contextName}_before_search`,
    }))) {
      return false;
    }
    await waitTaobaoImageLibraryDelay(page, `${contextName}_before_search_input`);
  }

  const finalSearchName = stripTaobaoNoiseHashSuffix(searchName);
  const input = frame
    .locator('input[placeholder="搜索图片名称"], input[placeholder*="搜索图片名称"]')
    .first();
  await input.waitFor({ timeout: 10000, state: "visible" });
  await input.click({ clickCount: 3 }).catch(() => undefined);
  await input.fill("");
  await input.fill(finalSearchName);
  await input.press("Enter");
  logger.info(`淘宝${contextName}已搜索图片名称`, {
    index,
    imageName: finalSearchName,
    rawImageName: searchName,
  });
  if (page) {
    await waitTaobaoImageLibraryDelay(page, `${contextName}_after_search_enter`);
    await waitTaobaoSecurityCheckResolved(page, {
      frames: [frame],
      reason: `${contextName}_after_search`,
    });
  }

  const hasResult = await hasTaobaoImageSearchResult(frame, index, contextName);
  if (!hasResult) {
    logger.warn(`淘宝${contextName}搜索无可选结果`, {
      index,
      imageName: finalSearchName,
      rawImageName: searchName,
    });
  }
  return hasResult;
}

async function hasTaobaoImageSearchResult(frame, index, contextName) {
  const list = frame.locator(TAOBAO_IMAGE_RESULT_LIST_SELECTOR).first();
  try {
    await list.waitFor({ timeout: 12000, state: "visible" });
  } catch (error) {
    const bodyText = await frame
      .locator("body")
      .innerText({ timeout: 1000 })
      .catch(() => "");
    const emptyMatched = TAOBAO_IMAGE_EMPTY_RESULT_PATTERN.test(bodyText);
    logger.warn(`淘宝${contextName}搜索结果列表未出现`, {
      index,
      emptyMatched,
      textPreview: String(bodyText || "").replace(/\s+/g, " ").slice(0, 120),
      error: error?.message || String(error),
    });
    return false;
  }

  const resultCount = await list.locator(":scope > *").count().catch(() => 0);
  if (resultCount <= 0) {
    logger.warn(`淘宝${contextName}搜索结果列表为空`, { index });
    return false;
  }

  const listText = await list.innerText({ timeout: 1000 }).catch(() => "");
  if (TAOBAO_IMAGE_EMPTY_RESULT_PATTERN.test(listText)) {
    logger.warn(`淘宝${contextName}搜索结果为空提示命中`, {
      index,
      textPreview: String(listText || "").replace(/\s+/g, " ").slice(0, 120),
    });
    return false;
  }

  return true;
}

async function clickTaobaoFirstSearchedImageInFrame(frame, index, contextName) {
  if (!frame) {
    logger.warn(`淘宝未找到${contextName} iframe，无法选择搜索图片`, { index });
    return false;
  }
  const page = frame.page?.();
  if (page) {
    if (!(await waitTaobaoSecurityCheckResolved(page, {
      frames: [frame],
      reason: `${contextName}_before_select_result`,
    }))) {
      return false;
    }
    await waitTaobaoImageLibraryDelay(page, `${contextName}_before_select_result_click`);
  }

  const list = frame.locator(TAOBAO_IMAGE_RESULT_LIST_SELECTOR).first();
  await list.waitFor({ timeout: 10000, state: "visible" });

  let firstItem = list.locator(":scope > *").first();
  if ((await firstItem.count().catch(() => 0)) <= 0) {
    firstItem = list.locator("*").first();
  }

  await firstItem.waitFor({ timeout: 10000, state: "visible" });
  const itemDebug = await firstItem.evaluate((element) => {
    const rect = element.getBoundingClientRect();
    return {
      tagName: element.tagName,
      className: String(element.className || ""),
      text: String(element.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
  }).catch(() => null);

  await firstItem
    .evaluate((element) => {
      element.scrollIntoView({ block: "center", inline: "center" });
    })
    .catch(() => undefined);

  const pointerReady = await firstItem
    .evaluate((element) => {
      const rect = element.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const target = document.elementFromPoint(x, y);
      return !!target && (target === element || element.contains(target));
    })
    .catch(() => false);

  try {
    await firstItem.click({ timeout: pointerReady ? 5000 : 1200 });
  } catch (error) {
    const fallbackDebug = await firstItem
      .evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const target = document.elementFromPoint(x, y);
        const clickTarget =
          element.querySelector("img") ||
          element.querySelector("button") ||
          element.querySelector("[role='button']") ||
          element;
        clickTarget.dispatchEvent(
          new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }),
        );
        clickTarget.dispatchEvent(
          new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }),
        );
        clickTarget.dispatchEvent(
          new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }),
        );
        clickTarget.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true, view: window }),
        );
        return {
          reason: "dom_click_fallback",
          interceptedBy: target
            ? {
                tagName: target.tagName,
                className: String(target.className || ""),
                text: String(target.textContent || "").trim().replace(/\s+/g, " ").slice(0, 80),
              }
            : null,
          clickTarget: {
            tagName: clickTarget.tagName,
            className: String(clickTarget.className || ""),
          },
        };
      })
      .catch((fallbackError) => ({
        reason: "dom_click_fallback_failed",
        error: fallbackError?.message || String(fallbackError),
      }));
    logger.warn(`淘宝${contextName}搜索结果普通点击被拦截，已尝试DOM点击兜底`, {
      index,
      error: error?.message || String(error),
      fallback: fallbackDebug,
      item: itemDebug,
    });
  }
  logger.info(`淘宝${contextName}已点击搜索结果第一张图片`, {
    index,
    item: itemDebug,
  });
  if (page) {
    await waitTaobaoImageLibraryDelay(page, `${contextName}_after_select_result_click`);
    await waitTaobaoSecurityCheckResolved(page, {
      frames: [frame],
      reason: `${contextName}_after_select_result`,
    });
  }
  return true;
}

async function searchTaobaoUploadedImageName(page, searchName, index) {
  const frame = await getTaobaoMainImagesFrame(page);
  return searchTaobaoImageNameInFrame(frame, searchName, index, "主图");
}

async function clickTaobaoFirstSearchedImage(page, index) {
  const frame = await getTaobaoMainImagesFrame(page);
  return clickTaobaoFirstSearchedImageInFrame(frame, index, "主图");
}

async function selectTaobaoDetailImagesFromLibrary(page, imagePaths) {
  const targetImagePaths = (imagePaths || []).filter(Boolean).slice(0, 1);
  const result = {
    requested: targetImagePaths.length,
    selectedPaths: [],
    failedPaths: [],
    confirmClicked: false,
  };

  if (!targetImagePaths.length) {
    logger.info("淘宝无已上传主图可用于详情图选择，跳过详情图选择");
    return result;
  }
  logger.info("淘宝详情图仅选择第一张主图素材，减少图片库操作次数", {
    sourceCount: (imagePaths || []).filter(Boolean).length,
    requested: targetImagePaths.length,
    file: toUserFriendlyPath(targetImagePaths[0]),
  });

  for (let index = 0; index < targetImagePaths.length; index += 1) {
    const imagePath = targetImagePaths[index];
    const searchNames = getUploadedLocalFileSearchNames(imagePath);
    let selected = false;

    for (const searchName of searchNames) {
      try {
        const frame = await getTaobaoDetailImagesFrame(page);
        const searched = await searchTaobaoImageNameInFrame(
          frame,
          searchName,
          index,
          "详情图",
        );
        if (!searched) {
          continue;
        }

        await page.waitForTimeout(500);
        const clicked = await clickTaobaoFirstSearchedImageInFrame(
          frame,
          index,
          "详情图",
        );
        if (!clicked) {
          continue;
        }

        selected = true;
        result.selectedPaths.push(imagePath);
        logger.info("淘宝详情图已从素材库选中图片", {
          index,
          imageName: searchName,
          file: toUserFriendlyPath(imagePath),
        });
        await waitTaobaoImageLibraryDelay(page, "detail_images_between_selected_images");
        break;
      } catch (error) {
        logger.warn("淘宝详情图搜索选择图片失败", {
          index,
          imageName: searchName,
          file: toUserFriendlyPath(imagePath),
          error: error?.message || String(error),
        });
      }
    }

    if (!selected) {
      result.failedPaths.push(imagePath);
      logger.warn("淘宝详情图未能选中图片", {
        index,
        names: searchNames.join(", "),
        file: toUserFriendlyPath(imagePath),
      });
    }
  }

  logger.info("淘宝详情图素材库选择流程结束", {
    requested: result.requested,
    selected: result.selectedPaths.length,
    failed: result.failedPaths.length,
  });

  if (result.selectedPaths.length > 0) {
    const confirmPattern = /^\s*确定\s*(?:[（(]\s*\d+\s*[）)])?\s*$/;
    try {
      const frame = await getTaobaoDetailImagesFrame(page);
      await waitTaobaoSecurityCheckResolved(page, {
        frames: [frame],
        reason: "detail_images_before_confirm",
      });
      await waitTaobaoActionDelay(page, "detail_images_before_confirm_click");
      result.confirmClicked = await clickTextButtonByPatternInLocator(
        frame,
        confirmPattern,
        8000,
      );
    } catch (error) {
      logger.warn("淘宝详情图 iframe 内确认按钮点击失败，准备全页面兜底", {
        error: error?.message || String(error),
      });
    }

    if (!result.confirmClicked) {
      await waitTaobaoActionDelay(page, "detail_images_before_confirm_fallback_click");
      result.confirmClicked = await clickTextButtonByPatternInLocator(
        page,
        confirmPattern,
        8000,
      );
    }

    if (result.confirmClicked) {
      await waitTaobaoActionDelay(page, "detail_images_after_confirm_click");
      logger.info("淘宝详情图图片选择已点击确定按钮", {
        selected: result.selectedPaths.length,
      });
    } else {
      logger.warn("淘宝详情图图片选择未找到确定按钮", {
        selected: result.selectedPaths.length,
      });
    }
  }

  return result;
}

async function submitTaobaoProductInfo(page) {
  const clicked = await clickTextButtonInLocator(page, "提交宝贝信息", 10000);
  if (clicked) {
    logger.info("淘宝已点击提交宝贝信息按钮");
    return true;
  }

  logger.warn("淘宝未找到提交宝贝信息按钮");
  return false;
}

async function waitTaobaoSubmitSuccess(page) {
  try {
    const successText = page.locator("text=商品提交成功").first();
    await successText.waitFor({ timeout: 60000, state: "visible" });
    logger.info("淘宝商品提交成功提示已出现");
    return true;
  } catch (error) {
    logger.warn("淘宝提交后未等待到商品提交成功提示", {
      error: error?.message || String(error),
    });
    return false;
  }
}

async function closeTaobaoPublishPage(page, reason = "finished") {
  if (!page) {
    return false;
  }

  try {
    if (typeof page.isClosed === "function" && page.isClosed()) {
      return true;
    }
    await page.close({ runBeforeUnload: false });
    logger.info("淘宝发布页面已关闭", { reason });
    return true;
  } catch (error) {
    logger.warn("淘宝发布页面关闭失败", {
      reason,
      error: error?.message || String(error),
    });
    return false;
  }
}

async function countTaobaoMainImageEmptySlots(page) {
  return await page
    .locator(".image-list")
    .first()
    .locator(".image-empty")
    .count()
    .catch(() => 0);
}

async function waitTaobaoMainImageSelectionApplied(page, index, beforeEmptyCount) {
  await page
    .waitForFunction(
      (beforeCount) => {
        const imageList = document.querySelectorAll(".image-list")[0];
        if (!imageList) return false;
        return imageList.querySelectorAll(".image-empty").length < beforeCount;
      },
      beforeEmptyCount,
      { timeout: 8000, polling: 300 },
    )
    .catch(() => undefined);

  const afterEmptyCount = await countTaobaoMainImageEmptySlots(page);
  const applied = afterEmptyCount < beforeEmptyCount;
  logger.info("淘宝主图选择回填检测:", {
    index,
    beforeEmptyCount,
    afterEmptyCount,
    applied,
  });
  return applied;
}

async function blurTaobaoPageAfterImageSelection(page, index) {
  await page.mouse.click(20, 20).catch(() => undefined);
  await page.evaluate(() => {
    if (document.activeElement && typeof document.activeElement.blur === "function") {
      document.activeElement.blur();
    }
  }).catch(() => undefined);
  logger.info("淘宝已点击页面空白处释放焦点", { index });
}

async function waitTaobaoMainImagesFrameClosed(page, index) {
  const frameElement = page.locator('iframe#mainImagesGroup');
  await frameElement
    .waitFor({ timeout: 10000, state: "hidden" })
    .catch(() => undefined);

  const stillVisible = await frameElement.isVisible().catch(() => false);
  logger.info("淘宝主图选择器关闭检测:", {
    index,
    closed: !stillVisible,
  });
  return !stillVisible;
}

async function selectTaobaoMainImagesFromLibrary(page, emptySlot, filePaths) {
  await waitTaobaoActionDelay(page, "main_image_before_open_dialog_click");
  const clickedElementDebug = await emptySlot.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center" });
    const rect = element.getBoundingClientRect();
    const detail = {
      tagName: element.tagName,
      className: element.className,
      text: String(element.textContent || "").trim().slice(0, 80),
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
    };
    element.click();
    return detail;
  });
  logger.info("淘宝已点击首个 image-empty 打开主图素材选择弹窗:", {
    fileCount: filePaths.length,
    element: clickedElementDebug,
  });
  await waitTaobaoActionDelay(page, "main_image_after_open_dialog_click");

  const selectedFiles = [];
  for (let index = 0; index < filePaths.length; index += 1) {
    const filePath = filePaths[index];
    const beforeEmptyCount = await countTaobaoMainImageEmptySlots(page);
    if (beforeEmptyCount <= 0) {
      logger.info(`淘宝主图空位已用完，结束图片选择: index=${index}`);
      break;
    }

    let applied = false;
    const searchNames = getUploadedLocalFileSearchNames(filePath);
    for (const searchName of searchNames) {
      const searched = await searchTaobaoUploadedImageName(page, searchName, index);
      if (!searched) {
        continue;
      }

      const clicked = await clickTaobaoFirstSearchedImage(page, index);
      if (!clicked) {
        continue;
      }

      applied = await waitTaobaoMainImageSelectionApplied(
        page,
        index,
        beforeEmptyCount,
      );
      if (applied) {
        break;
      }
    }

    if (applied) {
      selectedFiles.push(filePath);
      logger.info("淘宝主图已从素材库选中图片", {
        index,
        file: toUserFriendlyPath(filePath),
      });
    } else {
      logger.warn(`淘宝主图搜索选择未确认回填: index=${index}, names=${searchNames.join(", ")}`);
    }
  }

  await blurTaobaoPageAfterImageSelection(page, selectedFiles.length);
  await waitTaobaoMainImagesFrameClosed(page, selectedFiles.length);
  return selectedFiles;
}

async function prepareTaobaoPublishImages(images, imageManager) {
  const targetImages = (images || []).filter(Boolean).slice(0, 5);
  const preparedImages = await prepareImages(targetImages, imageManager);
  const materialFilePaths = [];
  const materialTempFiles = [];
  const materialRunId = Date.now().toString(36).slice(-6);

  for (const [index, sourcePath] of preparedImages.filePaths.entries()) {
    const originalFileName = getPathFileName(sourcePath);
    const ext = getSafeTaobaoImageExtension(sourcePath);
    const materialBaseName = buildShortTaobaoMaterialBaseName(
      originalFileName,
      index,
      materialRunId,
    );
    const materialPath = resolveUniqueFilePath(
      imageManager.tempDir,
      materialBaseName,
      ext,
    );

    fs.copyFileSync(sourcePath, materialPath);
    materialFilePaths.push(materialPath);
    materialTempFiles.push(materialPath);

    logger.info("淘宝素材中心上传文件名已安全化", {
      index,
      sourceFile: originalFileName,
      materialFile: getPathFileName(materialPath),
    });
  }

  logger.info("淘宝准备发布图片:", materialFilePaths.map(toUserFriendlyPath));

  return {
    requested: materialFilePaths.length,
    filePaths: materialFilePaths,
    sourceFilePaths: preparedImages.filePaths,
    tempFiles: [
      ...preparedImages.tempFiles,
      ...materialTempFiles,
    ],
  };
}

async function selectTaobaoImages(page, filePaths) {
  const targetImages = (filePaths || []).filter(Boolean).slice(0, 5);
  const result = {
    requested: targetImages.length,
    availableInputs: 0,
    availableSlots: 0,
    uploadedPaths: [],
    selectionCompleted: false,
    selectorClosed: null,
  };
  if (!targetImages.length) {
    logger.info("淘宝未提供主图，跳过图片选择");
    return {
      ...result,
      selectionCompleted: true,
      selectorClosed: true,
    };
  }

  try {
    await page.waitForSelector(".image-list .image-empty", {
      timeout: 15000,
      state: "visible",
    });
  } catch (error) {
    logger.warn(`淘宝等待主图空位超时: ${error?.message || error}`);
  }

  const emptySlotLocator = page.locator(".image-list").first().locator(".image-empty");
  const emptySlotCount = await emptySlotLocator.count();
  result.availableSlots = emptySlotCount;
  if (emptySlotCount <= 0) {
    logger.warn("淘宝未找到主图空位，暂不选择图片");
    return {
      ...result,
      selectionCompleted: false,
      selectorClosed: true,
    };
  }

  const maxUploadCount = Math.min(targetImages.length, emptySlotCount, 5);
  result.requested = maxUploadCount;
  const uploadFiles = targetImages.slice(0, maxUploadCount);
  const firstEmptySlot = page.locator(".image-list").first().locator(".image-empty").first();
  if ((await firstEmptySlot.count()) <= 0) {
    logger.info("淘宝主图空位已用完，结束图片选择");
  } else {
    try {
      result.uploadedPaths = await selectTaobaoMainImagesFromLibrary(
        page,
        firstEmptySlot,
        uploadFiles,
      );
    } catch (error) {
      logger.warn(`淘宝主图素材库选择异常: ${error?.message || error}`);
    }
  }

  result.selectionCompleted = result.uploadedPaths.length >= result.requested;
  if (result.selectionCompleted) {
    result.selectorClosed = await waitTaobaoMainImagesFrameClosed(
      page,
      result.uploadedPaths.length,
    );
  }

  logger.info(
    `淘宝主图素材库选择流程结束: selected=${result.uploadedPaths.length}/${result.requested}, selectionCompleted=${result.selectionCompleted}, selectorClosed=${result.selectorClosed}, files=${result.uploadedPaths.map(getPathFileName).join(", ")}`,
  );

  return result;
}

export async function publishToTaobao(publishInfo = {}) {
  const imageManager = new ImageManager();
  const pageOperator = new PageOperator();
  const tempFiles = [];
  let page = null;

  try {
    const settings =
      publishInfo.platformOptions ||
      publishInfo.publishOptions ||
      publishInfo.platformSettings?.[PLATFORM_KEY] ||
      {};
    const title = normalizeTitle(publishInfo.title || publishInfo.name || "");
    const productCode = normalizeProductCode(
      settings.productCode ?? publishInfo.productCode ?? publishInfo.data?.productCode,
    );
    const sourceImages =
      Array.isArray(publishInfo.images) && publishInfo.images.length
        ? publishInfo.images
        : Array.isArray(publishInfo.imageSources)
          ? publishInfo.imageSources
          : [];
    const { itemId, url: targetUrl } = resolvePublishUrl(settings, publishInfo);

    logger.info("开始执行淘宝商品发布基础流程", {
      itemId,
      targetUrl,
      title,
      productCode,
      imageCount: sourceImages.length,
    });

    const browser = await getOrCreateBrowser({
      profileId: publishInfo?.profileId,
    });
    page = await browser.newPage({ foreground: true });
    await pageOperator.setupAntiDetection(page);

    const preparedImages = await prepareTaobaoPublishImages(
      sourceImages,
      imageManager,
    );
    tempFiles.push(...(preparedImages.tempFiles || []));

    let materialUploadResult = null;
    if (preparedImages.filePaths.length > 0) {
      materialUploadResult = await uploadTaobaoImagesToMaterialCenter(
        page,
        preparedImages.filePaths,
      );

      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(4000);
      logger.info(`淘宝素材上传后回到发布页: ${page.url()}`);
      logger.info(`淘宝发布页标题: ${await page.title().catch(() => "")}`);
    } else {
      await page.goto(targetUrl, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      await page.waitForTimeout(4000);
      logger.info(`淘宝当前页面: ${page.url()}`);
      logger.info(`淘宝当前标题: ${await page.title().catch(() => "")}`);
    }

    if (!(await checkLogin(page))) {
      return {
        success: false,
        message: "请先登录淘宝/千牛商家后台",
        data: {
          itemId,
          targetUrl,
          pageKeptOpen: true,
        },
      };
    }

    const uploadResult = await selectTaobaoImages(
      page,
      preparedImages.filePaths,
    );
    const mainImagesReady =
      uploadResult.requested <= 0 ||
      (uploadResult.selectionCompleted && uploadResult.selectorClosed !== false);
    if (!mainImagesReady) {
      const pageClosed = await closeTaobaoPublishPage(page, "main_images_not_ready");
      return {
        success: false,
        message: "淘宝主图未全部从素材库选择完成，已停止后续操作",
        data: {
          itemId,
          targetUrl,
          finalUrl: page.url(),
          requested: uploadResult.requested,
          availableInputs: uploadResult.availableInputs,
          availableSlots: uploadResult.availableSlots,
          uploaded: uploadResult.uploadedPaths.length,
          uploadedPaths: uploadResult.uploadedPaths.map(toUserFriendlyPath),
          uploadedNames: uploadResult.uploadedPaths.map(getPathFileName),
          materialUploadPageOpened: !!materialUploadResult?.materialPageOpened,
          materialUploadSuccessCount: materialUploadResult?.uploadSuccessCount || 0,
          materialUploadDoneClicked: !!materialUploadResult?.doneClicked,
          mainImagesSelectionCompleted: uploadResult.selectionCompleted,
          mainImagesSelectorClosed: uploadResult.selectorClosed,
          pageKeptOpen: !pageClosed,
          pageClosed,
        },
      };
    }

    const titleFilled = await fillTaobaoTitle(page, title);
    const skuOuterIdFillResult = await fillTaobaoSkuOuterIds(page, productCode);
    const detailImagesClearResult = await clearTaobaoDetailImages(page);
    const detailImagePanelResult = await openTaobaoDetailImagePanel(page);
    const detailImagesSelectResult = detailImagePanelResult.imageButtonClicked
      ? await selectTaobaoDetailImagesFromLibrary(page, uploadResult.uploadedPaths)
      : {
          requested: uploadResult.uploadedPaths.length,
          selectedPaths: [],
          failedPaths: uploadResult.uploadedPaths,
          confirmClicked: false,
        };
    const submitClicked = await submitTaobaoProductInfo(page);
    const submitSuccess = submitClicked
      ? await waitTaobaoSubmitSuccess(page)
      : false;
    const finalUrl = page.url();
    const pageClosed = await closeTaobaoPublishPage(
      page,
      submitSuccess ? "submit_success" : "publish_finished_without_success",
    );

    return {
      success: submitSuccess,
      message: submitSuccess
        ? "淘宝商品提交成功"
        : submitClicked
          ? "淘宝已点击提交宝贝信息，但未等待到商品提交成功提示"
          : "淘宝发布信息已填写，但未找到提交宝贝信息按钮",
      data: {
        itemId,
        targetUrl,
        finalUrl,
        titleFilled,
        titleValue: titleFilled ? title : "",
        productCode,
        skuOuterIdFieldCount: skuOuterIdFillResult.fieldCount,
        skuOuterIdFilledCount: skuOuterIdFillResult.filledCount,
        detailImagesContainerFound: detailImagesClearResult.containerFound,
        detailImagesClearClicked: detailImagesClearResult.clearClicked,
        detailImagesClearConfirmed: detailImagesClearResult.confirmClicked,
        detailImagePanelFound: detailImagePanelResult.panelFound,
        detailImagePanelOpened: detailImagePanelResult.imageButtonClicked,
        detailImagesRequested: detailImagesSelectResult.requested,
        detailImagesSelected: detailImagesSelectResult.selectedPaths.length,
        detailImagesFailed: detailImagesSelectResult.failedPaths.length,
        detailImagesConfirmClicked: detailImagesSelectResult.confirmClicked,
        detailImagesSelectedPaths:
          detailImagesSelectResult.selectedPaths.map(toUserFriendlyPath),
        detailImagesSelectedNames:
          detailImagesSelectResult.selectedPaths.map(getPathFileName),
        detailImagesFailedPaths:
          detailImagesSelectResult.failedPaths.map(toUserFriendlyPath),
        submitProductInfoClicked: submitClicked,
        submitSuccess,
        requested: uploadResult.requested,
        availableInputs: uploadResult.availableInputs,
        availableSlots: uploadResult.availableSlots,
        uploaded: uploadResult.uploadedPaths.length,
        uploadedPaths: uploadResult.uploadedPaths.map(toUserFriendlyPath),
        uploadedNames: uploadResult.uploadedPaths.map(getPathFileName),
        materialUploadPageOpened: !!materialUploadResult?.materialPageOpened,
        materialUploadSuccessCount: materialUploadResult?.uploadSuccessCount || 0,
        materialUploadMessage: materialUploadResult?.uploadSuccessMessage || "",
        materialUploadElapsedMs: materialUploadResult?.uploadElapsedMs || 0,
        materialUploadDoneClicked: !!materialUploadResult?.doneClicked,
        mainImagesSelectionCompleted: uploadResult.selectionCompleted,
        mainImagesSelectorClosed: uploadResult.selectorClosed,
        pageKeptOpen: !pageClosed,
        pageClosed,
      },
    };
  } catch (error) {
    logger.error("淘宝发布基础流程失败:", error);
    await closeTaobaoPublishPage(page, "publish_error");
    return {
      success: false,
      message: error?.message || "淘宝发布基础流程失败",
    };
  } finally {
    tempFiles.forEach((file) => imageManager.deleteTempFile(file));
  }
}

export const taobaoPublisher = { publish: publishToTaobao };

export default taobaoPublisher;
