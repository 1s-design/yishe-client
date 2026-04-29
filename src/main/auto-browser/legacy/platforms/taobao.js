import fs from "fs";
import path from "path";
import { getOrCreateBrowser } from "../services/BrowserService.js";
import { ImageManager } from "../services/ImageManager.js";
import { PageOperator } from "../services/PageOperator.js";
import { isShopPlatformLoggedIn } from "./shopLoginFeatures.js";
import { logger } from "../utils/logger.js";

const PLATFORM_KEY = "taobao";
const DEFAULT_PUBLISH_URL = "https://item.upload.taobao.com/sell/v2/publish.htm";

function toUserFriendlyPath(filePath) {
  return String(filePath || "").replace(/\\/g, "/");
}

function getPathFileName(filePath) {
  return path.posix.basename(toUserFriendlyPath(filePath));
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

async function fillTaobaoTitle(page, title) {
  const normalizedTitle = normalizeTitle(title);
  if (!normalizedTitle) {
    logger.info("淘宝标题为空，跳过填写");
    return false;
  }

  const selectors = [
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
      if ((await locator.count()) <= 0) continue;
      await locator.waitFor({ timeout: 3000, state: "visible" });
      await locator.scrollIntoViewIfNeeded().catch(() => undefined);
      await locator.click({ clickCount: 3 }).catch(() => undefined);
      await locator.fill("").catch(() => undefined);
      await locator.fill(normalizedTitle);
      logger.info(`淘宝标题已填写: selector=${selector}, title=${normalizedTitle}`);
      return true;
    } catch (error) {
      logger.warn(`淘宝标题填写尝试失败: selector=${selector}, error=${error?.message || error}`);
    }
  }

  logger.warn("淘宝未找到可填写的标题输入框");
  return false;
}

async function fillTaobaoProductCode(page, productCode) {
  const normalizedProductCode = normalizeProductCode(productCode);
  if (!normalizedProductCode) {
    logger.info("淘宝商家编码为空，跳过填写");
    return 0;
  }

  const selectors = [
    'input[placeholder*="商家编码"]',
    'textarea[placeholder*="商家编码"]',
    'input[placeholder*="商品编码"]',
    'textarea[placeholder*="商品编码"]',
    'input[placeholder*="货号"]',
    'textarea[placeholder*="货号"]',
    'input[placeholder*="SKU"]',
    'textarea[placeholder*="SKU"]',
    'input[name*="outer"]',
    'input[name*="code"]',
  ];

  let filledCount = 0;
  for (const selector of selectors) {
    try {
      const locator = page.locator(selector);
      const count = await locator.count();
      if (count <= 0) continue;

      for (let index = 0; index < count; index += 1) {
        const input = locator.nth(index);
        if (!(await input.isVisible().catch(() => false))) continue;
        await input.scrollIntoViewIfNeeded().catch(() => undefined);
        await input.click({ clickCount: 3 }).catch(() => undefined);
        await input.fill("").catch(() => undefined);
        await input.fill(normalizedProductCode);
        filledCount += 1;
      }

      if (filledCount > 0) {
        logger.info(
          `淘宝商家编码已填写: selector=${selector}, count=${filledCount}, value=${normalizedProductCode}`,
        );
        return filledCount;
      }
    } catch (error) {
      logger.warn(
        `淘宝商家编码填写尝试失败: selector=${selector}, error=${error?.message || error}`,
      );
    }
  }

  logger.warn("淘宝未找到可填写的商家编码输入框");
  return filledCount;
}

async function uploadTaobaoImages(page, images, imageManager) {
  const targetImages = (images || []).filter(Boolean).slice(0, 5);
  const result = {
    requested: targetImages.length,
    availableInputs: 0,
    uploadedPaths: [],
  };
  if (!targetImages.length) {
    logger.info("淘宝未提供主图，跳过图片上传");
    return result;
  }

  const preparedImages = await prepareImages(targetImages, imageManager);
  result.requested = preparedImages.filePaths.length;
  logger.info("淘宝准备上传的图片:", preparedImages.filePaths.map(toUserFriendlyPath));

  if (!preparedImages.filePaths.length) {
    return {
      ...result,
      tempFiles: preparedImages.tempFiles,
    };
  }

  try {
    await page.waitForSelector('input[type="file"]', {
      timeout: 10000,
      state: "attached",
    });
  } catch (error) {
    logger.warn(`淘宝等待文件输入框超时: ${error?.message || error}`);
  }

  const inputLocator = page.locator('input[type="file"]');
  const inputCount = await inputLocator.count();
  result.availableInputs = inputCount;
  if (inputCount <= 0) {
    logger.warn("淘宝未找到文件输入框，暂不上传图片");
    return {
      ...result,
      tempFiles: preparedImages.tempFiles,
    };
  }

  const uploadFiles = preparedImages.filePaths.slice(0, 5);
  await inputLocator.first().setInputFiles(uploadFiles);
  await page.waitForTimeout(2000);
  result.uploadedPaths = uploadFiles;
  logger.info(`淘宝基础图片上传已触发: ${uploadFiles.map(getPathFileName).join(", ")}`);

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

    const titleFilled = await fillTaobaoTitle(page, title);
    const productCodeFilledCount = await fillTaobaoProductCode(page, productCode);
    const uploadResult = await uploadTaobaoImages(
      page,
      sourceImages,
      imageManager,
    );
    tempFiles.push(...(uploadResult.tempFiles || []));

    return {
      success: true,
      message: "淘宝发布基础流程已打开并写入基础数据，后续页面调整逻辑待补充",
      data: {
        itemId,
        targetUrl,
        finalUrl: page.url(),
        titleFilled,
        titleValue: titleFilled ? title : "",
        productCode,
        productCodeFilledCount,
        requested: uploadResult.requested,
        availableInputs: uploadResult.availableInputs,
        uploaded: uploadResult.uploadedPaths.length,
        uploadedPaths: uploadResult.uploadedPaths.map(toUserFriendlyPath),
        uploadedNames: uploadResult.uploadedPaths.map(getPathFileName),
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
