import fs from "fs";
import { basename, extname } from "path";
import { getOrCreateBrowser } from "../services/BrowserService.js";
import { ImageManager } from "../services/ImageManager.js";
import { PageOperator } from "../services/PageOperator.js";
import { isShopPlatformLoggedIn } from "./shopLoginFeatures.js";
import { logger } from "../utils/logger.js";

const PLATFORM_KEY = "pdd";
const PLATFORM_NAME = "拼多多";
const PDD_GOODS_LIST_URL = "https://mms.pinduoduo.com/goods/goods_list";
const PDD_MATERIAL_UPLOAD_URL = "https://mms.pinduoduo.com/material/upload";
const MAIN_IMAGE_LIMIT = 10;
const PDD_UPLOAD_TEXT = {
  uploadFile: "上传文件",
  imageSpaceUpload: "图片空间上传",
  confirm: "确认",
};
const PDD_MATERIAL_UPLOAD_TIMEOUT_MS = 180000;
const PDD_MATERIAL_UPLOADING_TEXT = "正在上传至【全部文件】";
const PDD_MATERIAL_UPLOAD_SUCCESS_PATTERN =
  /本次共成功上传\s*(\d+)\s*个文件至【全部文件】/;
const PDD_MATERIAL_SEARCH_INPUT_SELECTOR =
  'input[placeholder="请输入图片名称"], textarea[placeholder="请输入图片名称"]';
const PDD_MATERIAL_CARD_ITEM_SELECTOR =
  '[class^="MmsUiMaterialModalV3___cardBoxWrapperItem___"], [class*=" MmsUiMaterialModalV3___cardBoxWrapperItem___"]';

function normalizeId(value) {
  return String(value ?? "").trim();
}

function resolveSettings(publishInfo = {}) {
  return (
    publishInfo.platformOptions ||
    publishInfo.publishOptions ||
    publishInfo.platformSettings?.[PLATFORM_KEY] ||
    {}
  );
}

function resolvePddGoodsIdentity(settings = {}, publishInfo = {}) {
  const goodsId = normalizeId(
    settings.goodsId ?? settings.goods_id ?? publishInfo.goodsId ?? publishInfo.goods_id,
  );

  if (!goodsId) {
    throw new Error("拼多多相似商品 goods_id 不能为空");
  }
  if (!/^\d+$/.test(goodsId)) {
    throw new Error("拼多多相似商品 goods_id 必须是数字");
  }

  return {
    goodsId,
  };
}

function normalizePddProductTitle(value) {
  return String(value || "").trim().slice(0, 30);
}

async function checkLogin(page) {
  return await isShopPlatformLoggedIn(page, PLATFORM_KEY);
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
    } else {
      logger.warn(`${PLATFORM_NAME}主图文件不存在，已跳过`, { source });
    }
  }

  return { filePaths, tempFiles };
}

function getPddSearchScopes(page) {
  return [page, ...page.frames()];
}

async function getLocatorSnapshot(locator) {
  return await locator
    .evaluate((element) => ({
      tagName: element.tagName,
      className:
        typeof element.className === "string"
          ? element.className
          : String(element.className || ""),
      text: String(element.textContent || "").trim().slice(0, 80),
      role: element.getAttribute("role") || "",
      type: element.getAttribute("type") || "",
    }))
    .catch(() => null);
}

function buildPddTextLocators(scope, text) {
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

async function clickPddText(page, text, label, options = {}) {
  const timeout = options.timeout ?? 15000;
  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    for (const locator of buildPddTextLocators(scope, text)) {
      try {
        await locator.waitFor({ state: "visible", timeout: 1200 });
        const snapshot = await getLocatorSnapshot(locator);
        await locator.click({ timeout: 5000 });
        logger.info(`${PLATFORM_NAME}${label}点击成功`, {
          text,
          element: snapshot,
        });
        return { clicked: true, text, element: snapshot };
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }
  }

  await page.waitForTimeout(Math.min(timeout, 1000));
  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label}：${text}（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function clickPddTextInScope(scope, text, label, options = {}) {
  const timeout = options.timeout ?? 15000;
  const errors = [];

  for (const locator of buildPddTextLocators(scope, text)) {
    try {
      await locator.waitFor({ state: "visible", timeout });
      const snapshot = await getLocatorSnapshot(locator);
      await locator.click({ timeout: 5000 });
      logger.info(`${PLATFORM_NAME}${label}点击成功`, {
        text,
        element: snapshot,
      });
      return { clicked: true, text, element: snapshot };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label}：${text}（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function clickFirstPddButtonByText(page, text, label, options = {}) {
  const timeout = options.timeout ?? 30000;
  const scopes = getPddSearchScopes(page);
  const rootSelector = String(options.rootSelector || "").trim();
  const errors = [];

  for (const scope of scopes) {
    const root = rootSelector
      ? scope.locator(rootSelector).first()
      : null;
    const locator = (
      root ? root.locator("button") : scope.locator("button")
    )
      .filter({ hasText: text })
      .first();
    try {
      if (root) {
        await root.waitFor({ state: "attached", timeout: 1200 });
      }
      await locator.waitFor({ state: "attached", timeout: 1200 });
      const snapshot = await getLocatorSnapshot(locator);
      const disabled = await locator
        .evaluate((element) => !!element.disabled)
        .catch(() => false);
      if (disabled) {
        throw new Error("button disabled");
      }
      await locator.evaluate((element) => element.click());
      logger.info(`${PLATFORM_NAME}${label}点击成功`, {
        text,
        element: snapshot,
      });
      return { clicked: true, text, element: snapshot };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  await page.waitForTimeout(Math.min(timeout, 1000));
  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label} button：${text}${rootSelector ? ` root=${rootSelector}` : ""}（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function fillPddGoodsIdSearchInput(page, goodsId) {
  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    const searchItems = scope.locator(".search-item");
    const count = await searchItems.count().catch(() => 0);
    for (let index = 0; index < count; index += 1) {
      const item = searchItems.nth(index);
      try {
        const text = await item.innerText({ timeout: 1000 }).catch(() => "");
        if (!String(text || "").includes("商品ID")) {
          continue;
        }
        const input = item.locator("input").first();
        await input.waitFor({ state: "attached", timeout: 3000 });
        await input.fill("");
        await input.fill(goodsId);
        logger.info(`${PLATFORM_NAME}商品列表已输入商品ID`, { goodsId });
        return true;
      } catch (error) {
        errors.push(error?.message || String(error));
      }
    }
  }

  throw new Error(
    `${PLATFORM_NAME}商品列表未找到“商品ID”搜索输入框（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function clickPddTextLink(page, text, label, options = {}) {
  const timeout = options.timeout ?? 30000;
  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    const locator = scope.locator("a").filter({ hasText: text }).first();
    try {
      await locator.waitFor({ state: "attached", timeout: 1200 });
      const snapshot = await getLocatorSnapshot(locator);
      await locator.evaluate((element) => element.click());
      logger.info(`${PLATFORM_NAME}${label}点击成功`, {
        text,
        element: snapshot,
      });
      return { clicked: true, text, element: snapshot };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  await page.waitForTimeout(Math.min(timeout, 1000));
  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label} a：${text}（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function clickPddLabelByText(page, text, label, options = {}) {
  const timeout = options.timeout ?? 30000;
  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    const locator = scope.locator("label").filter({ hasText: text }).first();
    try {
      await locator.waitFor({ state: "attached", timeout: 1200 });
      const snapshot = await getLocatorSnapshot(locator);
      await locator.evaluate((element) => element.click());
      logger.info(`${PLATFORM_NAME}${label}点击成功`, {
        text,
        element: snapshot,
      });
      return { clicked: true, text, element: snapshot };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  await page.waitForTimeout(Math.min(timeout, 1000));
  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label} label：${text}（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function clickPddButtonByExactText(page, text, label, options = {}) {
  const timeout = options.timeout ?? 30000;
  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    const locator = scope
      .locator("button")
      .filter({ hasText: new RegExp(`^\\s*${text}\\s*$`) })
      .first();
    try {
      await locator.waitFor({ state: "attached", timeout: 1200 });
      const snapshot = await getLocatorSnapshot(locator);
      await locator.evaluate((element) => element.click());
      logger.info(`${PLATFORM_NAME}${label}点击成功`, {
        text,
        element: snapshot,
      });
      return { clicked: true, text, element: snapshot };
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  await page.waitForTimeout(Math.min(timeout, 1000));
  throw new Error(
    `${PLATFORM_NAME}未找到或无法点击${label} button：${text}（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function openPddSimilarPublishPage(page, goodsId) {
  logger.info(`${PLATFORM_NAME}进入商品列表准备发布相似品`, {
    goodsId,
    url: PDD_GOODS_LIST_URL,
  });
  await page.goto(PDD_GOODS_LIST_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  await page.waitForTimeout(3000);

  await fillPddGoodsIdSearchInput(page, goodsId);
  await clickPddButtonByExactText(page, "查询", "商品列表查询按钮", {
    timeout: 30000,
  });
  await page.waitForTimeout(3000);

  const currentPages = new Set(page.context().pages());
  await clickPddTextLink(page, "发布相似品", "发布相似品链接", {
    timeout: 30000,
  });
  await page.waitForTimeout(1200);

  await clickPddLabelByText(
    page,
    "同步复制商品图、商详内容",
    "同步复制商品图商详内容选项",
    { timeout: 30000 },
  );

  const pagePromise = page
    .context()
    .waitForEvent("page", { timeout: 15000 })
    .catch(() => null);
  await clickPddButtonByExactText(page, "确认", "发布相似品确认按钮", {
    timeout: 30000,
  });

  const nextPage = await pagePromise;
  const publishPage =
    nextPage && !currentPages.has(nextPage) ? nextPage : page;
  await publishPage.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
  await publishPage.waitForTimeout(4000);
  await publishPage.bringToFront().catch(() => {});

  logger.info(`${PLATFORM_NAME}相似品发布页已打开`, {
    goodsId,
    url: publishPage.url(),
    reusedPage: publishPage === page,
  });

  return publishPage;
}

async function fillPddProductTitle(page, title) {
  const normalizedTitle = normalizePddProductTitle(title);
  if (!normalizedTitle) {
    logger.info(`${PLATFORM_NAME}未提供标题，跳过商品标题填写`);
    return "";
  }

  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    const input = scope
      .locator('input[placeholder*="商品标题"], textarea[placeholder*="商品标题"]')
      .first();
    try {
      await input.waitFor({ state: "attached", timeout: 1500 });
      await input.fill("");
      await input.fill(normalizedTitle);
      logger.info(`${PLATFORM_NAME}商品标题已填写`, {
        title: normalizedTitle,
        length: normalizedTitle.length,
      });
      return normalizedTitle;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  throw new Error(
    `${PLATFORM_NAME}未找到商品标题输入框（placeholder 包含“商品标题”）（${errors
      .slice(-3)
      .join(" | ")}）`,
  );
}

async function submitPddProduct(page) {
  await clickPddButtonByExactText(page, "提交并上架", "提交并上架按钮", {
    timeout: 30000,
  });
  logger.info(`${PLATFORM_NAME}已点击提交并上架，等待提交成功提示`);

  await page.waitForFunction(
    () => String(document.body?.innerText || "").includes("提交成功"),
    { timeout: 120000 },
  );

  logger.info(`${PLATFORM_NAME}商品提交成功提示已出现`);
  return true;
}

async function getPddPageText(page) {
  return await page
    .evaluate(() => String(document.body?.innerText || ""))
    .catch(() => "");
}

async function waitPddMaterialUploadFinished(page, expectedCount) {
  const startedAt = Date.now();

  try {
    await page.waitForFunction(
      (uploadingText) =>
        String(document.body?.innerText || "").includes(uploadingText),
      PDD_MATERIAL_UPLOADING_TEXT,
      { timeout: 30000 },
    );
    logger.info(`${PLATFORM_NAME}图片空间检测到上传中状态`, {
      text: PDD_MATERIAL_UPLOADING_TEXT,
      expectedCount,
    });
  } catch {
    logger.warn(`${PLATFORM_NAME}图片空间未检测到上传中提示，继续等待成功提示`, {
      text: PDD_MATERIAL_UPLOADING_TEXT,
      expectedCount,
    });
  }

  const successHandle = await page.waitForFunction(
    (patternSource) => {
      const pageText = String(document.body?.innerText || "");
      const match = pageText.match(new RegExp(patternSource));
      return match
        ? {
            message: match[0],
            successCount: Number(match[1] || 0),
          }
        : false;
    },
    PDD_MATERIAL_UPLOAD_SUCCESS_PATTERN.source,
    { timeout: PDD_MATERIAL_UPLOAD_TIMEOUT_MS },
  );

  const successResult = await successHandle.jsonValue();
  const successCount = Number(successResult?.successCount || 0);
  const elapsedMs = Date.now() - startedAt;

  logger.info(`${PLATFORM_NAME}图片空间检测到上传成功提示`, {
    message: successResult?.message || "",
    successCount,
    expectedCount,
    elapsedMs,
  });

  if (successCount !== expectedCount) {
    const pageText = await getPddPageText(page);
    throw new Error(
      `拼多多图片空间上传数量不匹配：期望 ${expectedCount} 个，页面提示成功 ${successCount} 个。页面提示：${pageText
        .replace(/\s+/g, " ")
        .slice(0, 300)}`,
    );
  }

  return {
    successCount,
    message: successResult?.message || "",
    elapsedMs,
  };
}

async function uploadPddImagesFromImageSpace(page, filePaths) {
  const result = {
    materialPageOpened: false,
    uploadFileClicked: false,
    fileInputFound: false,
    uploadSuccessCount: 0,
    uploadSuccessMessage: "",
    uploadElapsedMs: 0,
  };

  logger.info(`${PLATFORM_NAME}进入图片空间上传页`, {
    url: PDD_MATERIAL_UPLOAD_URL,
    fileCount: filePaths.length,
  });

  await page.goto(PDD_MATERIAL_UPLOAD_URL, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });
  result.materialPageOpened = true;
  await page.waitForTimeout(2500);

  const uploadFileClick = await clickPddText(
    page,
    PDD_UPLOAD_TEXT.uploadFile,
    "上传文件按钮",
    {
      timeout: 30000,
    },
  );
  result.uploadFileClicked = uploadFileClick.clicked;
  await page.waitForTimeout(1000);

  const fileInput = page.locator("input[type=file]").first();
  await fileInput.waitFor({ state: "attached", timeout: 30000 });
  result.fileInputFound = true;

  const inputSnapshot = await fileInput
    .evaluate((element) => ({
      tagName: element.tagName,
      type: element.getAttribute("type") || "",
      accept: element.getAttribute("accept") || "",
      multiple: !!element.multiple,
      disabled: !!element.disabled,
    }))
    .catch(() => null);

  if (inputSnapshot?.disabled) {
    throw new Error("拼多多图片空间上传 input 不可用（disabled）");
  }

  logger.info(`${PLATFORM_NAME}准备通过图片空间 input 批量上传图片`, {
    fileCount: filePaths.length,
    inputSnapshot,
  });

  await fileInput.setInputFiles(filePaths);
  const uploadResult = await waitPddMaterialUploadFinished(
    page,
    filePaths.length,
  );
  result.uploadSuccessCount = uploadResult.successCount;
  result.uploadSuccessMessage = uploadResult.message;
  result.uploadElapsedMs = uploadResult.elapsedMs;

  return result;
}

function getPddImageSearchNames(filePath) {
  const fullName = basename(filePath);
  const ext = extname(fullName);
  const nameWithoutExt = ext ? fullName.slice(0, -ext.length) : fullName;
  return Array.from(new Set([nameWithoutExt, fullName].filter(Boolean)));
}

function parsePddImageIndexes(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => Number.parseInt(String(item), 10))
      .filter((item) => Number.isInteger(item) && item > 0);
  }

  return String(value || "")
    .split(/[,，\s]+/)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0);
}

function resolvePddIndexedFilePaths(filePaths, rawIndexes, label) {
  const indexes = parsePddImageIndexes(rawIndexes);
  const resolved = [];

  for (const index of indexes) {
    const filePath = filePaths[index - 1];
    if (filePath) {
      resolved.push({ imageIndex: index, filePath });
    } else {
      logger.warn(`${PLATFORM_NAME}${label}图片序号超出范围，已跳过`, {
        imageIndex: index,
        fileCount: filePaths.length,
      });
    }
  }

  return resolved;
}

async function getPddMaterialModalScope(page) {
  const scopes = getPddSearchScopes(page);
  for (const scope of scopes) {
    const input = scope.locator(PDD_MATERIAL_SEARCH_INPUT_SELECTOR).first();
    try {
      await input.waitFor({ state: "visible", timeout: 1200 });
      return scope;
    } catch {}
  }
  throw new Error("拼多多图片空间弹窗未找到图片名称输入框");
}

async function searchAndSelectPddMaterialImage(
  page,
  filePath,
  index,
  contextLabel = "轮播图",
) {
  const searchNames = getPddImageSearchNames(filePath);
  let lastError = null;

  for (const imageName of searchNames) {
    try {
      const scope = await getPddMaterialModalScope(page);
      const input = scope.locator(PDD_MATERIAL_SEARCH_INPUT_SELECTOR).first();
      await input.fill("");
      await input.fill(imageName);
      logger.info(`${PLATFORM_NAME}${contextLabel}已输入图片名称`, {
        index,
        imageName,
      });

      await input.press("Enter");
      logger.info(`${PLATFORM_NAME}${contextLabel}图片名称已回车查询`, {
        index,
        imageName,
      });
      await page.waitForTimeout(1200);

      const firstCardLabel = scope
        .locator(`${PDD_MATERIAL_CARD_ITEM_SELECTOR} label`)
        .first();
      await firstCardLabel.waitFor({ state: "visible", timeout: 15000 });
      const snapshot = await getLocatorSnapshot(firstCardLabel);
      await firstCardLabel.click({ timeout: 5000 });

      logger.info(`${PLATFORM_NAME}${contextLabel}已选择图片空间首个素材`, {
        index,
        imageName,
        fileName: basename(filePath),
        element: snapshot,
      });
      return {
        selected: true,
        imageName,
        filePath,
      };
    } catch (error) {
      lastError = error;
      logger.warn(`${PLATFORM_NAME}${contextLabel}搜索选择图片失败`, {
        index,
        imageName,
        fileName: basename(filePath),
        error: error?.message || String(error),
      });
    }
  }

  return {
    selected: false,
    filePath,
    error: lastError?.message || String(lastError || "unknown"),
  };
}

async function clearPddImageArea(page, areaSelector, contextLabel) {
  const scopes = getPddSearchScopes(page);
  const errors = [];

  for (const scope of scopes) {
    const area = scope.locator(areaSelector).first();
    try {
      await area.waitFor({ state: "attached", timeout: 1200 });
      const icons = area.locator("i");
      const count = await icons.count();
      let clicked = 0;

      for (let index = count - 1; index >= 0; index -= 1) {
        const icon = icons.nth(index);
        try {
          await icon.evaluate((element) => element.click());
          clicked += 1;
          await page.waitForTimeout(150);
        } catch (error) {
          logger.warn(`${PLATFORM_NAME}${contextLabel}删除按钮点击失败，继续`, {
            index,
            error: error?.message || String(error),
          });
        }
      }

      logger.info(`${PLATFORM_NAME}${contextLabel}旧图清理完成`, {
        areaSelector,
        iconCount: count,
        clicked,
      });
      return clicked;
    } catch (error) {
      errors.push(error?.message || String(error));
    }
  }

  logger.warn(`${PLATFORM_NAME}未找到${contextLabel}区域 ${areaSelector}，跳过旧图清理`, {
    errors: errors.slice(-3),
  });
  return 0;
}

async function selectPddImagesFromMaterialArea(
  page,
  filePaths,
  options = {},
) {
  const contextLabel = options.contextLabel || "轮播图";
  const areaSelector = options.areaSelector || "#picture";
  const result = {
    requested: filePaths.length,
    selected: 0,
    selectedImages: [],
    failedImages: [],
    imageSpaceUploadClicked: false,
    confirmClicked: false,
  };

  if (!filePaths.length) {
    return result;
  }

  await clearPddImageArea(page, areaSelector, contextLabel);

  await clickFirstPddButtonByText(
    page,
    PDD_UPLOAD_TEXT.imageSpaceUpload,
    `${contextLabel}图片空间上传按钮`,
    { timeout: 30000, rootSelector: areaSelector },
  );
  result.imageSpaceUploadClicked = true;
  await page.waitForTimeout(1500);

  for (const [index, filePath] of filePaths.entries()) {
    const selectResult = await searchAndSelectPddMaterialImage(
      page,
      filePath,
      index,
      contextLabel,
    );
    if (selectResult.selected) {
      result.selected += 1;
      result.selectedImages.push(selectResult);
    } else {
      result.failedImages.push(selectResult);
    }
  }

  if (result.selected !== filePaths.length) {
    throw new Error(
      `拼多多${contextLabel}图片空间选择数量不匹配：期望 ${filePaths.length} 张，实际选中 ${result.selected} 张`,
    );
  }

  const scope = await getPddMaterialModalScope(page);
  await clickPddTextInScope(scope, PDD_UPLOAD_TEXT.confirm, "图片空间确定按钮", {
    timeout: 15000,
  });
  result.confirmClicked = true;
  await page.waitForTimeout(2000);

  logger.info(`${PLATFORM_NAME}${contextLabel}图片空间选择已确认`, {
    selected: result.selected,
    requested: result.requested,
  });

  return result;
}

async function selectPddCarouselImagesFromMaterial(page, filePaths) {
  return selectPddImagesFromMaterialArea(page, filePaths, {
    areaSelector: "#picture",
    contextLabel: "轮播图",
  });
}

async function selectPddDetailImagesFromMaterial(page, filePaths) {
  return selectPddImagesFromMaterialArea(page, filePaths, {
    areaSelector: "#detail_pic",
    contextLabel: "详情图",
  });
}

async function selectPddSkuImagesFromMaterial(page, skuImageItems) {
  const result = {
    requested: skuImageItems.length,
    selected: 0,
    selectedImages: [],
    failedImages: [],
  };

  if (!skuImageItems.length) {
    logger.info(`${PLATFORM_NAME}未配置 SKU 图片序号，跳过 SKU 图选择`);
    return result;
  }

  const skuImageBlocks = page.locator(".goods-sku-img");
  await skuImageBlocks.first().waitFor({ state: "visible", timeout: 30000 });
  const skuCount = await skuImageBlocks.count();

  logger.info(`${PLATFORM_NAME}开始处理 SKU 图片`, {
    skuCount,
    configuredCount: skuImageItems.length,
  });

  for (const [index, item] of skuImageItems.entries()) {
    if (index >= skuCount) {
      result.failedImages.push({
        skuIndex: index,
        imageIndex: item.imageIndex,
        filePath: item.filePath,
        error: "SKU 图片节点数量不足",
      });
      logger.warn(`${PLATFORM_NAME}SKU 图片节点数量不足，跳过`, {
        skuIndex: index,
        imageIndex: item.imageIndex,
        skuCount,
      });
      continue;
    }

    try {
      const skuBlock = skuImageBlocks.nth(index);
      await skuBlock.scrollIntoViewIfNeeded();

      const deleteIcon = skuBlock.locator("i").first();
      if ((await deleteIcon.count()) > 0) {
        await deleteIcon.click({ timeout: 3000 }).catch((error) => {
          logger.warn(`${PLATFORM_NAME}SKU 图删除旧图点击失败，继续尝试上传`, {
            skuIndex: index,
            error: error?.message || String(error),
          });
        });
        await page.waitForTimeout(500);
      }

      const preview = skuBlock.locator(".sku-preview-img").first();
      await preview.waitFor({ state: "visible", timeout: 15000 });
      await preview.click({ timeout: 5000 });
      logger.info(`${PLATFORM_NAME}SKU 图已打开图片空间弹窗`, {
        skuIndex: index,
        imageIndex: item.imageIndex,
        fileName: basename(item.filePath),
      });
      await page.waitForTimeout(1200);

      const selectResult = await searchAndSelectPddMaterialImage(
        page,
        item.filePath,
        index,
        "SKU图",
      );
      if (!selectResult.selected) {
        result.failedImages.push({
          skuIndex: index,
          imageIndex: item.imageIndex,
          filePath: item.filePath,
          error: selectResult.error,
        });
        continue;
      }

      const scope = await getPddMaterialModalScope(page);
      await clickPddTextInScope(
        scope,
        PDD_UPLOAD_TEXT.confirm,
        "SKU 图图片空间确认按钮",
        { timeout: 15000 },
      );
      await page.waitForTimeout(1200);

      result.selected += 1;
      result.selectedImages.push({
        skuIndex: index,
        imageIndex: item.imageIndex,
        filePath: item.filePath,
        imageName: selectResult.imageName,
      });
      logger.info(`${PLATFORM_NAME}SKU 图已确认选择`, {
        skuIndex: index,
        imageIndex: item.imageIndex,
        fileName: basename(item.filePath),
      });
    } catch (error) {
      result.failedImages.push({
        skuIndex: index,
        imageIndex: item.imageIndex,
        filePath: item.filePath,
        error: error?.message || String(error),
      });
      logger.warn(`${PLATFORM_NAME}SKU 图选择失败`, {
        skuIndex: index,
        imageIndex: item.imageIndex,
        fileName: basename(item.filePath),
        error: error?.message || String(error),
      });
    }
  }

  if (result.selected !== skuImageItems.length) {
    throw new Error(
      `拼多多 SKU 图选择数量不匹配：期望 ${skuImageItems.length} 张，实际选中 ${result.selected} 张`,
    );
  }

  logger.info(`${PLATFORM_NAME}SKU 图选择完成`, {
    selected: result.selected,
    requested: result.requested,
  });

  return result;
}

async function uploadMainImages(
  page,
  sourceImages,
  imageManager,
  targetUrl,
  settings = {},
) {
  const targetImages = (Array.isArray(sourceImages) ? sourceImages : []).filter(
    (item) => String(item || "").trim(),
  );

  const result = {
    requested: targetImages.length,
    prepared: 0,
    uploaded: 0,
    filePaths: [],
    tempFiles: [],
    inputFound: false,
    uploadDialogOpened: false,
    localUploadClicked: false,
    selectImagesClicked: false,
    fileChooserTriggered: false,
    materialPageOpened: false,
    uploadFileClicked: false,
    uploadSuccessCount: 0,
    uploadSuccessMessage: "",
    uploadElapsedMs: 0,
    carouselSelected: 0,
    carouselConfirmClicked: false,
    detailSelected: 0,
    detailConfirmClicked: false,
    skuSelected: 0,
  };

  if (!targetImages.length) {
    logger.info(`${PLATFORM_NAME}未提供图片，跳过图片空间上传`);
    return result;
  }

  const preparedImages = await prepareImages(targetImages, imageManager);
  result.prepared = preparedImages.filePaths.length;
  result.filePaths = preparedImages.filePaths;
  result.tempFiles = preparedImages.tempFiles;

  if (!preparedImages.filePaths.length) {
    throw new Error("拼多多没有可上传的本地图片文件");
  }

  logger.info(`${PLATFORM_NAME}准备上传整套图片到图片空间`, {
    requested: result.requested,
    prepared: result.prepared,
    uploadCount: preparedImages.filePaths.length,
  });

  const dialogUploadResult = await uploadPddImagesFromImageSpace(
    page,
    preparedImages.filePaths,
  );

  result.inputFound = dialogUploadResult.fileInputFound;
  result.uploadDialogOpened = dialogUploadResult.materialPageOpened;
  result.localUploadClicked = dialogUploadResult.uploadFileClicked;
  result.selectImagesClicked = dialogUploadResult.fileInputFound;
  result.fileChooserTriggered = false;
  result.materialPageOpened = dialogUploadResult.materialPageOpened;
  result.uploadFileClicked = dialogUploadResult.uploadFileClicked;
  result.uploadSuccessCount = dialogUploadResult.uploadSuccessCount;
  result.uploadSuccessMessage = dialogUploadResult.uploadSuccessMessage;
  result.uploadElapsedMs = dialogUploadResult.uploadElapsedMs;
  result.uploaded = preparedImages.filePaths.length;

  logger.info(`${PLATFORM_NAME}图片空间上传已完成`, {
    uploaded: result.uploaded,
    requested: result.requested,
    materialPageOpened: result.materialPageOpened,
    uploadFileClicked: result.uploadFileClicked,
    inputFound: result.inputFound,
    uploadSuccessCount: result.uploadSuccessCount,
    uploadSuccessMessage: result.uploadSuccessMessage,
    uploadElapsedMs: result.uploadElapsedMs,
  });

  if (targetUrl) {
    logger.info(`${PLATFORM_NAME}图片空间上传后返回商品发布页`, {
      targetUrl,
    });
    await page.goto(targetUrl, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(3000);
  }

  const carouselFilePaths = resolvePddIndexedFilePaths(
    preparedImages.filePaths,
    settings.psdImageIndexes ||
      Array.from(
        { length: Math.min(MAIN_IMAGE_LIMIT, preparedImages.filePaths.length) },
        (_, index) => index + 1,
      ),
    "轮播图",
  );
  const carouselSelectedFilePaths = carouselFilePaths.map((item) => item.filePath);

  const carouselSelectResult = await selectPddCarouselImagesFromMaterial(
    page,
    carouselSelectedFilePaths,
  );
  result.carouselSelected = carouselSelectResult.selected;
  result.carouselConfirmClicked = carouselSelectResult.confirmClicked;

  const detailSelectResult = await selectPddDetailImagesFromMaterial(
    page,
    carouselSelectedFilePaths,
  );
  result.detailSelected = detailSelectResult.selected;
  result.detailConfirmClicked = detailSelectResult.confirmClicked;

  const skuImageItems = resolvePddIndexedFilePaths(
    preparedImages.filePaths,
    settings.skuImageIndexes,
    "SKU",
  );
  const skuSelectResult = await selectPddSkuImagesFromMaterial(
    page,
    skuImageItems,
  );
  result.skuSelected = skuSelectResult.selected;

  return result;
}

export async function publishToPdd(publishInfo = {}) {
  const imageManager = new ImageManager();
  const pageOperator = new PageOperator();
  const tempFiles = [];
  let page = null;

  try {
    const settings = resolveSettings(publishInfo);
    const { goodsId } = resolvePddGoodsIdentity(settings, publishInfo);
    const title = String(publishInfo.title || publishInfo.name || "").trim();
    const productCode = String(
      settings.productCode ?? publishInfo.productCode ?? "",
    ).trim();
    const sourceImages =
      Array.isArray(publishInfo.images) && publishInfo.images.length
        ? publishInfo.images
        : Array.isArray(publishInfo.imageSources)
          ? publishInfo.imageSources
          : [];

    logger.info(`${PLATFORM_NAME}开始执行商品发布基础流程`, {
      goodsId,
      goodsListUrl: PDD_GOODS_LIST_URL,
      title,
      productCode,
      imageCount: sourceImages.length,
      profileId: publishInfo?.profileId || "default",
    });

    const browser = await getOrCreateBrowser({
      profileId: publishInfo?.profileId,
    });
    page = await browser.newPage({ foreground: true });
    await pageOperator.setupAntiDetection(page);

    await page.goto(PDD_GOODS_LIST_URL, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
    await page.waitForTimeout(4000);

    const currentUrl = page.url();
    const pageTitle = await page.title().catch(() => "");
    logger.info(`${PLATFORM_NAME}当前页面`, {
      currentUrl,
      pageTitle,
    });

    if (!(await checkLogin(page))) {
      return {
        success: false,
        message: "请先登录拼多多商家后台",
        data: {
          goodsId,
          goodsListUrl: PDD_GOODS_LIST_URL,
          finalUrl: currentUrl,
          pageTitle,
          pageKeptOpen: true,
        },
      };
    }

    page = await openPddSimilarPublishPage(page, goodsId);
    const targetUrl = page.url();

    const mainImageUploadResult = await uploadMainImages(
      page,
      sourceImages,
      imageManager,
      targetUrl,
      settings,
    );
    tempFiles.push(...(mainImageUploadResult.tempFiles || []));
    const filledTitle = await fillPddProductTitle(page, title);
    const submitted = await submitPddProduct(page);

    return {
      success: true,
      message: "拼多多商品提交成功",
      data: {
        goodsId,
        goodsListUrl: PDD_GOODS_LIST_URL,
        targetUrl,
        finalUrl: page.url(),
        pageTitle: await page.title().catch(() => ""),
        title,
        filledTitle,
        productCode,
        imageCount: sourceImages.length,
        mainImageRequested: mainImageUploadResult.requested,
        mainImagePrepared: mainImageUploadResult.prepared,
        mainImageUploaded: mainImageUploadResult.uploaded,
        mainImageInputFound: mainImageUploadResult.inputFound,
        mainImageUploadDialogOpened: mainImageUploadResult.uploadDialogOpened,
        mainImageLocalUploadClicked: mainImageUploadResult.localUploadClicked,
        mainImageSelectImagesClicked: mainImageUploadResult.selectImagesClicked,
        mainImageFileChooserTriggered:
          mainImageUploadResult.fileChooserTriggered,
        mainImageMaterialPageOpened:
          mainImageUploadResult.materialPageOpened,
        mainImageUploadFileClicked: mainImageUploadResult.uploadFileClicked,
        mainImageUploadSuccessCount:
          mainImageUploadResult.uploadSuccessCount,
        mainImageUploadSuccessMessage:
          mainImageUploadResult.uploadSuccessMessage,
        mainImageUploadElapsedMs: mainImageUploadResult.uploadElapsedMs,
        mainImageCarouselSelected: mainImageUploadResult.carouselSelected,
        mainImageCarouselConfirmClicked:
          mainImageUploadResult.carouselConfirmClicked,
        mainImageDetailSelected: mainImageUploadResult.detailSelected,
        mainImageDetailConfirmClicked:
          mainImageUploadResult.detailConfirmClicked,
        mainImageSkuSelected: mainImageUploadResult.skuSelected,
        submitted,
        pageKeptOpen: true,
        automationStage: "submitted",
      },
    };
  } catch (error) {
    logger.error(`${PLATFORM_NAME}发布基础流程失败:`, error);
    return {
      success: false,
      message: error?.message || `${PLATFORM_NAME}发布基础流程失败`,
      data: {
        finalUrl: page?.url?.() || "",
        pageKeptOpen: !!page,
      },
    };
  } finally {
    tempFiles.forEach((file) => imageManager.deleteTempFile(file));
  }
}

export const pddPublisher = { publish: publishToPdd };

export default pddPublisher;
