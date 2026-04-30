import fs from "fs";
import path from "path";
import { getOrCreateBrowser } from "../services/BrowserService.js";
import { ImageManager } from "../services/ImageManager.js";
import { PageOperator } from "../services/PageOperator.js";
import { isShopPlatformLoggedIn } from "./shopLoginFeatures.js";
import { logger } from "../utils/logger.js";

const PLATFORM_KEY = "taobao";
const DEFAULT_PUBLISH_URL = "https://item.upload.taobao.com/sell/v2/publish.htm";
const TAOBAO_ACTION_DELAY_MS = 900;
const TAOBAO_SECURITY_CHECK_TIMEOUT_MS = 5 * 60 * 1000;
const TAOBAO_SECURITY_CHECK_POLL_MS = 1500;
const TAOBAO_SECURITY_TEXT_PATTERN =
  /验证码|安全验证|验证一下|拖动滑块|滑块|请完成验证|请按住滑块|环境异常|风险验证/;

function toUserFriendlyPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function getPathFileName(filePath) {
  return path.posix.basename(toUserFriendlyPath(filePath));
}

function getUploadedLocalFileName(filePath) {
  return getPathFileName(filePath);
}

function getUploadedLocalFileSearchNames(filePath) {
  const fileName = getUploadedLocalFileName(filePath);
  const ext = path.posix.extname(fileName);
  const nameWithoutExt = ext ? fileName.slice(0, -ext.length) : fileName;
  const nameBeforeHashSuffix = nameWithoutExt.split(".")[0];
  return Array.from(
    new Set([nameBeforeHashSuffix, nameWithoutExt, fileName].filter(Boolean)),
  );
}

function normalizeTitle(title) {
  return String(title || "")
    .trim()
    .slice(0, 60);
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

  for (const [index, rawSource] of images.entries()) {
    const source = String(rawSource || "").trim();
    if (!source) continue;

    if (/^https?:\/\//i.test(source)) {
      const tempPath = await imageManager.downloadImage(
        source,
        `${PLATFORM_KEY}_${Date.now()}_${index}`,
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

async function getTaobaoSecuritySignal(target) {
  try {
    const signal = await target.evaluate((patternSource) => {
      const pattern = new RegExp(patternSource);
      const bodyText = String(document.body?.innerText || "").slice(0, 4000);
      const matchedText = pattern.test(bodyText);
      const matchedNode = !!document.querySelector(
        [
          '[class*="captcha"]',
          '[id*="captcha"]',
          '[class*="nc-container"]',
          '[id*="nc"]',
          '[class*="slider"]',
          '[class*="verify"]',
          '[id*="verify"]',
          '[class*="risk"]',
        ].join(","),
      );
      return {
        detected: matchedText || matchedNode,
        matchedText,
        matchedNode,
        textPreview: bodyText.replace(/\s+/g, " ").slice(0, 160),
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

  await waitTaobaoSecurityCheckResolved(page, {
    reason: "detail_images_before_open_panel",
  });
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

function getFrameUrl(frame) {
  if (!frame) return "";
  if (typeof frame.url === "function") {
    return frame.url();
  }
  return String(frame.url || "");
}

async function waitTaobaoFileChooserFromLocalUpload(page, index) {
  const frame = await getTaobaoMainImagesFrame(page);
  if (!frame) {
    logger.warn("淘宝未找到主图上传 iframe: #mainImagesGroup", { index });
    return null;
  }
  if (!(await waitTaobaoSecurityCheckResolved(page, {
    frames: [frame],
    reason: "main_image_before_local_upload",
  }))) {
    return null;
  }
  await waitTaobaoActionDelay(page, "main_image_before_local_upload_click");

  const button = frame.locator("button").filter({ hasText: "本地上传" }).first();
  await button.waitFor({ timeout: 5000, state: "visible" });
  logger.info("淘宝找到本地上传按钮", {
    index,
    frameUrl: getFrameUrl(frame),
  });

  const [fileChooser] = await Promise.all([
    page.waitForEvent("filechooser", { timeout: 15000 }),
    button.click({ timeout: 5000 }),
  ]);
  logger.info("淘宝本地上传按钮已触发文件选择器:", {
    index,
  });
  await waitTaobaoActionDelay(page, "main_image_after_local_upload_click");
  return fileChooser;
}

async function clickTaobaoUploadDoneButton(page, index) {
  const frame = await getTaobaoMainImagesFrame(page);
  if (!frame) {
    logger.warn("淘宝未找到主图上传 iframe: #mainImagesGroup", { index });
    return false;
  }

  const button = frame.locator("button").filter({ hasText: "完成" }).first();
  await button.waitFor({ timeout: 15000, state: "visible" });
  const enabled = await button.isEnabled().catch(() => true);
  if (!enabled) {
    logger.warn("淘宝上传完成按钮不可用", { index });
    return false;
  }
  if (!(await waitTaobaoSecurityCheckResolved(page, {
    frames: [frame],
    reason: "main_image_before_upload_done",
  }))) {
    return false;
  }
  await waitTaobaoActionDelay(page, "main_image_before_upload_done_click");
  logger.info("淘宝找到上传完成按钮", {
    index,
    frameUrl: getFrameUrl(frame),
  });
  await button.click({ timeout: 5000 });
  logger.info("淘宝已点击上传完成按钮", { index });
  await waitTaobaoActionDelay(page, "main_image_after_upload_done_click");
  return true;
}

async function waitTaobaoBatchUploadCompleted(page, filePaths) {
  const frame = await getTaobaoMainImagesFrame(page);
  if (!frame) {
    logger.warn("淘宝未找到主图上传 iframe，无法等待批量上传完成");
    return false;
  }

  await page.waitForTimeout(Math.max(5000, filePaths.length * 1500));

  const doneButton = frame.locator("button").filter({ hasText: "完成" }).first();
  let result = false;
  const startedAt = Date.now();
  while (Date.now() - startedAt < 45000) {
    const visible = await doneButton.isVisible().catch(() => false);
    const enabled = await doneButton.isEnabled().catch(() => false);
    if (visible && enabled) {
      result = true;
      break;
    }
    await page.waitForTimeout(500);
  }

  logger.info("淘宝批量图片上传完成检测:", {
    requested: filePaths.length,
    completed: result,
  });
  return result;
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
    await waitTaobaoActionDelay(page, `${contextName}_before_search_input`);
  }

  const input = frame
    .locator('input[placeholder="搜索图片名称"], input[placeholder*="搜索图片名称"]')
    .first();
  await input.waitFor({ timeout: 10000, state: "visible" });
  await input.click({ clickCount: 3 }).catch(() => undefined);
  await input.fill("");
  await input.fill(searchName);
  await input.press("Enter");
  logger.info(`淘宝${contextName}已搜索图片名称`, {
    index,
    imageName: searchName,
  });
  if (page) {
    await waitTaobaoActionDelay(page, `${contextName}_after_search_enter`);
    await waitTaobaoSecurityCheckResolved(page, {
      frames: [frame],
      reason: `${contextName}_after_search`,
    });
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
    await waitTaobaoActionDelay(page, `${contextName}_before_select_result_click`);
  }

  const list = frame
    .locator(
      '[class^="PicList_PicturesShow_main-document__"], [class*=" PicList_PicturesShow_main-document__"]',
    )
    .first();
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

  await firstItem.click({ timeout: 5000 });
  logger.info(`淘宝${contextName}已点击搜索结果第一张图片`, {
    index,
    item: itemDebug,
  });
  if (page) {
    await waitTaobaoActionDelay(page, `${contextName}_after_select_result_click`);
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
  const targetImagePaths = (imagePaths || []).filter(Boolean);
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
        await page.waitForTimeout(500);
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

async function uploadTaobaoImageByEmptySlot(page, emptySlot, filePath, index) {
  const beforeEmptyCount = await countTaobaoMainImageEmptySlots(page);
  await waitTaobaoSecurityCheckResolved(page, {
    reason: "main_image_before_open_single_dialog",
  });
  await waitTaobaoActionDelay(page, "main_image_before_open_single_dialog_click");
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
  logger.info("淘宝已直接点击 image-empty 元素:", {
    index,
    file: toUserFriendlyPath(filePath),
    element: clickedElementDebug,
  });
  await waitTaobaoActionDelay(page, "main_image_after_open_single_dialog_click");

  const fileChooser = await waitTaobaoFileChooserFromLocalUpload(page, index);

  if (fileChooser) {
    await fileChooser.setFiles(filePath);
    await waitTaobaoSecurityCheckResolved(page, {
      reason: "main_image_after_set_single_file",
    });
    await waitTaobaoActionDelay(page, "main_image_after_set_single_file");
    logger.info(`淘宝主图已通过文件选择器上传: index=${index}, file=${toUserFriendlyPath(filePath)}`);
    if (await clickTaobaoUploadDoneButton(page, index)) {
      if (await searchTaobaoUploadedImageName(page, filePath, index)) {
        if (await clickTaobaoFirstSearchedImage(page, index)) {
          const applied = await waitTaobaoMainImageSelectionApplied(
            page,
            index,
            beforeEmptyCount,
          );
          if (applied) {
            await blurTaobaoPageAfterImageSelection(page, index);
            await waitTaobaoMainImagesFrameClosed(page, index);
          }
          return applied;
        }
      }
    }
    return false;
  }

  const inputLocator = page.locator('input[type="file"]');
  const inputCount = await inputLocator.count();
  if (inputCount > 0) {
    await inputLocator.last().setInputFiles(filePath);
    logger.info(`淘宝主图已通过文件输入框兜底上传: index=${index}, file=${toUserFriendlyPath(filePath)}`);
    return true;
  }

  logger.warn(`淘宝主图上传失败，未找到文件选择器或文件输入框: index=${index}`);
  return false;
}

async function uploadTaobaoImagesFromSingleDialog(page, emptySlot, filePaths) {
  await waitTaobaoSecurityCheckResolved(page, {
    reason: "main_image_before_open_dialog",
  });
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
  logger.info("淘宝已点击首个 image-empty 打开主图弹窗:", {
    fileCount: filePaths.length,
    element: clickedElementDebug,
  });
  await waitTaobaoActionDelay(page, "main_image_after_open_dialog_click");

  const fileChooser = await waitTaobaoFileChooserFromLocalUpload(page, 0);
  if (!fileChooser) {
    logger.warn("淘宝未触发本地上传文件选择器");
    return [];
  }

  await fileChooser.setFiles(filePaths);
  await waitTaobaoSecurityCheckResolved(page, {
    reason: "main_image_after_set_files",
  });
  await waitTaobaoActionDelay(page, "main_image_after_set_files");
  logger.info("淘宝主图已通过文件选择器批量写入:", {
    fileCount: filePaths.length,
    files: filePaths.map(getPathFileName),
  });

  await waitTaobaoBatchUploadCompleted(page, filePaths);

  if (!(await clickTaobaoUploadDoneButton(page, 0))) {
    return [];
  }

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
    } else {
      logger.warn(`淘宝主图搜索选择未确认回填: index=${index}, names=${searchNames.join(", ")}`);
    }
  }

  await blurTaobaoPageAfterImageSelection(page, selectedFiles.length);
  await waitTaobaoMainImagesFrameClosed(page, selectedFiles.length);
  return selectedFiles;
}

async function uploadTaobaoImages(page, images, imageManager) {
  const targetImages = (images || []).filter(Boolean).slice(0, 5);
  const result = {
    requested: targetImages.length,
    availableInputs: 0,
    availableSlots: 0,
    uploadedPaths: [],
    selectionCompleted: false,
    selectorClosed: null,
  };
  if (!targetImages.length) {
    logger.info("淘宝未提供主图，跳过图片上传");
    return {
      ...result,
      selectionCompleted: true,
      selectorClosed: true,
    };
  }

  const preparedImages = await prepareImages(targetImages, imageManager);
  result.requested = preparedImages.filePaths.length;
  logger.info("淘宝准备上传的图片:", preparedImages.filePaths.map(toUserFriendlyPath));

  if (!preparedImages.filePaths.length) {
    return {
      ...result,
      selectionCompleted: true,
      selectorClosed: true,
      tempFiles: preparedImages.tempFiles,
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
    logger.warn("淘宝未找到主图空位，暂不上传图片");
    return {
      ...result,
      selectionCompleted: false,
      selectorClosed: true,
      tempFiles: preparedImages.tempFiles,
    };
  }

  const maxUploadCount = Math.min(preparedImages.filePaths.length, emptySlotCount, 5);
  result.requested = maxUploadCount;
  const uploadFiles = preparedImages.filePaths.slice(0, maxUploadCount);
  const firstEmptySlot = page.locator(".image-list").first().locator(".image-empty").first();
  if ((await firstEmptySlot.count()) <= 0) {
    logger.info("淘宝主图空位已用完，结束上传");
  } else {
    try {
      result.uploadedPaths = await uploadTaobaoImagesFromSingleDialog(
        page,
        firstEmptySlot,
        uploadFiles,
      );
    } catch (error) {
      logger.warn(`淘宝主图批量上传异常: ${error?.message || error}`);
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
    `淘宝主图上传流程结束: uploaded=${result.uploadedPaths.length}/${result.requested}, selectionCompleted=${result.selectionCompleted}, selectorClosed=${result.selectorClosed}, files=${result.uploadedPaths.map(getPathFileName).join(", ")}`,
  );

  return {
    ...result,
    tempFiles: preparedImages.tempFiles,
  };
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

    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(4000);
    logger.info(`淘宝当前页面: ${page.url()}`);
    logger.info(`淘宝当前标题: ${await page.title().catch(() => "")}`);

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

    const uploadResult = await uploadTaobaoImages(
      page,
      sourceImages,
      imageManager,
    );
    tempFiles.push(...(uploadResult.tempFiles || []));
    const mainImagesReady =
      uploadResult.requested <= 0 ||
      (uploadResult.selectionCompleted && uploadResult.selectorClosed !== false);
    if (!mainImagesReady) {
      return {
        success: false,
        message: "淘宝主图未全部上传并选择完成，已停止后续操作",
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
          mainImagesSelectionCompleted: uploadResult.selectionCompleted,
          mainImagesSelectorClosed: uploadResult.selectorClosed,
          pageKeptOpen: true,
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
        finalUrl: page.url(),
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
        mainImagesSelectionCompleted: uploadResult.selectionCompleted,
        mainImagesSelectorClosed: uploadResult.selectorClosed,
        pageKeptOpen: true,
      },
    };
  } catch (error) {
    logger.error("淘宝发布基础流程失败:", error);
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
