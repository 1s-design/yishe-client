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

async function getTaobaoMainImagesFrame(page) {
  const frameElement = page.locator('iframe#mainImagesGroup');
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
  logger.info("淘宝找到上传完成按钮", {
    index,
    frameUrl: getFrameUrl(frame),
  });
  await button.click({ timeout: 5000 });
  logger.info("淘宝已点击上传完成按钮", { index });
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

async function searchTaobaoUploadedImageName(page, searchName, index) {
  const frame = await getTaobaoMainImagesFrame(page);
  if (!frame) {
    logger.warn("淘宝未找到主图上传 iframe，无法搜索图片名称", { index });
    return false;
  }

  const input = frame
    .locator('input[placeholder="搜索图片名称"], input[placeholder*="搜索图片名称"]')
    .first();
  await input.waitFor({ timeout: 10000, state: "visible" });
  await input.click({ clickCount: 3 }).catch(() => undefined);
  await input.fill("");
  await input.fill(searchName);
  await input.press("Enter");
  logger.info("淘宝已搜索上传图片名称", {
    index,
    imageName: searchName,
  });
  return true;
}

async function clickTaobaoFirstSearchedImage(page, index) {
  const frame = await getTaobaoMainImagesFrame(page);
  if (!frame) {
    logger.warn("淘宝未找到主图上传 iframe，无法选择搜索图片", { index });
    return false;
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
  logger.info("淘宝已点击搜索结果第一张图片", {
    index,
    item: itemDebug,
  });
  return true;
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
  await page.waitForTimeout(600);

  const fileChooser = await waitTaobaoFileChooserFromLocalUpload(page, index);

  if (fileChooser) {
    await fileChooser.setFiles(filePath);
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
  await page.waitForTimeout(600);

  const fileChooser = await waitTaobaoFileChooserFromLocalUpload(page, 0);
  if (!fileChooser) {
    logger.warn("淘宝未触发本地上传文件选择器");
    return [];
  }

  await fileChooser.setFiles(filePaths);
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
  return selectedFiles;
}

async function uploadTaobaoImages(page, images, imageManager) {
  const targetImages = (images || []).filter(Boolean).slice(0, 5);
  const result = {
    requested: targetImages.length,
    availableInputs: 0,
    availableSlots: 0,
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

  logger.info(
    `淘宝主图上传流程结束: uploaded=${result.uploadedPaths.length}/${result.requested}, files=${result.uploadedPaths.map(getPathFileName).join(", ")}`,
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
        availableSlots: uploadResult.availableSlots,
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
