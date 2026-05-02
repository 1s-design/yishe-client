import { getOrCreateBrowser } from '../../services/BrowserService.js';
import { logger } from '../../utils/logger.js';
import {
  createTemuLiveRequestCapture,
  uploadTemuImagesToCloud
} from './imageUpload.js';

const TEMU_GOODS_STATUS_LABEL_MAP = {
  1: '在售中',
  2: '未发布到站点',
  3: '已下架',
  4: '已终止',
  5: '已删除'
};

const REGION_ORIGIN_MAP = {
  global: 'https://agentseller.temu.com',
  seller: 'https://agentseller.temu.com',
  us: 'https://agentseller-us.temu.com',
  eu: 'https://agentseller-eu.temu.com'
};

function asPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function toNumberArray(value) {
  return Array.isArray(value)
    ? value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    : [];
}

function toStringArray(value) {
  return Array.isArray(value)
    ? value.map((item) => String(item || '').trim()).filter(Boolean)
    : [];
}

function normalizeRegion(region) {
  return REGION_ORIGIN_MAP[region] ? region : 'global';
}

function buildUrl(region, path) {
  if (/^https?:\/\//i.test(String(path || ''))) {
    return String(path);
  }
  const origin = REGION_ORIGIN_MAP[normalizeRegion(region)] || REGION_ORIGIN_MAP.global;
  const normalizedPath = String(path || '').startsWith('/') ? String(path || '') : `/${path || ''}`;
  return `${origin}${normalizedPath}`;
}

function normalizeTemuApiMessage(payload, fallback = '') {
  const source = asPlainObject(payload);
  return String(
    source.message ||
      source.msg ||
      source.errorMsg ||
      source.error_msg ||
      asPlainObject(source.result).message ||
      fallback ||
      ''
  ).trim();
}

function buildFeatureResponse({ action, profileId, region, requestResult, result, successMessage, failureMessage, raw }) {
  const success = !!requestResult?.success;
  return {
    success,
    action,
    message: success
      ? successMessage
      : normalizeTemuApiMessage(requestResult?.payload, requestResult?.message || failureMessage) || failureMessage,
    profileId,
    region,
    request: {
      url: requestResult?.url,
      status: requestResult?.status
    },
    result,
    raw: raw === undefined ? requestResult?.payload ?? null : raw
  };
}

async function requestTemuJson(region, path, json = {}, options = {}) {
  const url = buildUrl(region, path);
  const browser = await getOrCreateBrowser({ profileId: options.profileId });
  const page = await browser.newPage({ background: true, activate: false });
  const requestCapture = createTemuLiveRequestCapture(page.context());
  try {
    const origin = new URL(url).origin;
    await page.goto(`${origin}/`, {
      waitUntil: 'domcontentloaded',
      timeout: Number(options.navigationTimeoutMs || 30_000) || 30_000
    }).catch(() => undefined);
    if (!requestCapture.state.antiContent || !requestCapture.state.mallId) {
      await page.reload({
        waitUntil: 'domcontentloaded',
        timeout: 20_000
      }).catch(() => undefined);
      await page.waitForTimeout(2500).catch(() => undefined);
    }
    const retryCount = Math.max(0, Number(options.retryCount ?? 2) || 0);
    let lastResult = null;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
      const capturedHeaders = {
        ...(requestCapture.state.antiContent ? { 'anti-content': requestCapture.state.antiContent } : {}),
        ...(requestCapture.state.mallId ? { mallid: requestCapture.state.mallId } : {})
      };
      lastResult = await page.evaluate(async ({ requestUrl, requestJson, requestOptions }) => {
        const method = requestOptions.method || 'POST';
        try {
          const response = await fetch(requestUrl, {
            method,
            credentials: 'include',
            headers: {
              accept: 'application/json, text/plain, */*',
              'content-type': 'application/json',
              ...(requestOptions.headers || {})
            },
            body: method === 'GET' ? undefined : JSON.stringify(requestJson || {})
          });
          const rawText = await response.text();
          let payload = null;
          try {
            payload = rawText ? JSON.parse(rawText) : null;
          } catch {
            payload = null;
          }
          return {
            success: response.ok && payload?.success !== false,
            status: response.status,
            payload,
            rawText,
            url: requestUrl
          };
        } catch (error) {
          return {
            success: false,
            status: 0,
            payload: {
              success: false,
              error_msg: error?.message || String(error)
            },
            rawText: error?.stack || error?.message || String(error),
            url: requestUrl,
            message: error?.message || String(error)
          };
        }
      }, {
        requestUrl: url,
        requestJson: json || {},
        requestOptions: {
          method: options.method || 'POST',
          headers: {
            ...capturedHeaders,
            ...(options.headers || {})
          }
        }
      });
      if (lastResult?.status !== 0 || attempt >= retryCount) {
        return lastResult;
      }
      await page.waitForTimeout(800 * (attempt + 1)).catch(() => undefined);
      await page.goto(`${origin}/`, {
        waitUntil: 'domcontentloaded',
        timeout: 20_000
      }).catch(() => undefined);
    }
    return lastResult;
  } finally {
    requestCapture.dispose();
    await page.close().catch(() => undefined);
  }
}

function extractLifecycleSkcSpuPairs(payload) {
  const dataList = Array.isArray(payload?.result?.dataList) ? payload.result.dataList : [];
  const seen = new Set();
  const result = [];
  dataList.forEach((item) => {
    const spuId = Number(item?.productId || 0);
    const skcList = Array.isArray(item?.skcList) ? item.skcList : [];
    skcList.forEach((skc) => {
      const skcId = Number(skc?.skcId || 0);
      const key = `${spuId}:${skcId}`;
      if (spuId && skcId && !seen.has(key)) {
        seen.add(key);
        result.push({ spuId, skcId });
      }
    });
  });
  return result;
}

function extractGoodsRelations(payload) {
  const pageItems = Array.isArray(payload?.result?.pageItems) ? payload.result.pageItems : [];
  return pageItems.map((item) => ({
    spuId: Number(item?.productId || 0) || null,
    skcId: Number(item?.productSkcId || 0) || null,
    skuList: Array.isArray(item?.productSkuSummaries)
      ? item.productSkuSummaries.map((sku) => ({
          skuId: Number(sku?.productSkuId || 0) || null,
          virtualStock: sku?.virtualStock == null ? null : Number(sku.virtualStock)
        }))
      : []
  }));
}

function buildJitStockUpdatePayload({ goodsRelations, skcId, finalNum }) {
  const target = goodsRelations.find((item) => item.skcId === skcId);
  if (!target?.spuId || !target.skcId) {
    return null;
  }
  const skuVirtualStockChangeList = (Array.isArray(target.skuList) ? target.skuList : [])
    .map((sku) => {
      const currentStock = sku.virtualStock === null ? 0 : Number(sku.virtualStock || 0);
      const virtualStockDiff = Number(finalNum) - currentStock;
      if (!sku.skuId || virtualStockDiff === 0) {
        return null;
      }
      return {
        productSkuId: sku.skuId,
        currentStockAvailable: currentStock,
        virtualStockDiff
      };
    })
    .filter(Boolean);
  if (!skuVirtualStockChangeList.length) {
    return { skipped: true, productId: target.spuId, productSkcId: target.skcId, skuVirtualStockChangeList: [] };
  }
  return {
    productId: target.spuId,
    skcVirtualStockChangeDTOList: [
      {
        productSkcId: target.skcId,
        stockUpdateSource: 1,
        skuVirtualStockChangeList
      }
    ]
  };
}

function normalizeRemoteUrlList(value) {
  return toStringArray(value).filter((item) => /^https?:\/\//i.test(item));
}

function normalizeRealPicturePositionMap(value) {
  const result = {};
  const payloadMap = asPlainObject(value);
  Object.entries(payloadMap).forEach(([position, urls]) => {
    const normalizedPosition = String(position || '').trim();
    if (!normalizedPosition) return;
    const normalized = Array.isArray(urls)
      ? normalizeRemoteUrlList(urls)
      : /^https?:\/\//i.test(String(urls || '').trim())
        ? [String(urls).trim()]
        : [];
    if (normalized.length) {
      result[normalizedPosition] = normalized;
    }
  });
  return result;
}

function mergePositionImages(...maps) {
  return maps.reduce((result, map) => {
    Object.entries(asPlainObject(map)).forEach(([position, urls]) => {
      const normalizedUrls = normalizeRemoteUrlList(urls);
      if (!result[position]) result[position] = [];
      result[position].push(...normalizedUrls);
      result[position] = Array.from(new Set(result[position]));
    });
    return result;
  }, {});
}

function groupExistingLabelImages(labelImageList) {
  return (Array.isArray(labelImageList) ? labelImageList : []).reduce((result, item) => {
    const position = String(item?.position ?? '').trim();
    const imageUrl = String(item?.image || item?.image_url || '').trim();
    if (position && imageUrl) {
      if (!result[position]) result[position] = [];
      result[position].push(imageUrl);
    }
    return result;
  }, {});
}

function extractRealPictureItems(payload) {
  const items = Array.isArray(payload?.result?.items) ? payload.result.items : [];
  return items.map((item) => {
    const skuInfo = Array.isArray(item?.sku_info)
      ? item.sku_info
      : asPlainObject(item?.same_sku_vo) && Array.isArray(item.same_sku_vo?.sku_list)
        ? item.same_sku_vo.sku_list
        : [];
    return {
      raw: item,
      spuId: Number(item?.spu_id || 0) || null,
      goodsId: Number(item?.goods_id || 0) || null,
      isSameSku: item?.is_same_sku === true || Number(item?.is_same_sku || 0) === 1,
      skuIdList: skuInfo.map((sku) => Number(sku?.sku_id || 0)).filter((skuId) => skuId > 0),
      labelImageList: Array.isArray(item?.label_image_list) ? item.label_image_list : []
    };
  });
}

function extractRealPictureListItems(payload) {
  const items = Array.isArray(payload?.result?.items) ? payload.result.items : [];
  return items.map((item) => {
    const skuInfo = Array.isArray(item?.skuInfo)
      ? item.skuInfo
      : Array.isArray(item?.sku_info)
      ? item.sku_info
      : asPlainObject(item?.same_sku_vo) && Array.isArray(item.same_sku_vo?.sku_list)
        ? item.same_sku_vo.sku_list
        : [];
    const labelImageList = Array.isArray(item?.labelImageList)
      ? item.labelImageList
      : Array.isArray(item?.label_image_list)
        ? item.label_image_list
        : [];
    const ruleCheckResultList = Array.isArray(item?.ruleCheckResultList)
      ? item.ruleCheckResultList
      : Array.isArray(item?.rule_check_result_list)
        ? item.rule_check_result_list
        : [];
    const positionDetail = Array.isArray(item?.positionDetail)
      ? item.positionDetail
      : Array.isArray(item?.position_detail)
        ? item.position_detail
        : [];
    const goodsStatus = (item?.goodsStatus ?? item?.goods_status) === undefined ||
      (item?.goodsStatus ?? item?.goods_status) === null
      ? null
      : Number(item?.goodsStatus ?? item?.goods_status);

    return {
      spuId: Number(item?.spuId ?? item?.spu_id ?? 0) || null,
      spuName: String(item?.spuName ?? item?.spu_name ?? item?.product_name ?? '').trim(),
      goodsId: Number(item?.goodsId ?? item?.goods_id ?? 0) || null,
      goodsStatus,
      goodsStatusLabel: String(item?.goodsStatusLabel || '').trim() ||
        (goodsStatus === null ? '' : TEMU_GOODS_STATUS_LABEL_MAP[goodsStatus] || ''),
      uploadStatus: (item?.uploadStatus ?? item?.upload_status) === undefined ||
        (item?.uploadStatus ?? item?.upload_status) === null
        ? null
        : Number(item?.uploadStatus ?? item?.upload_status),
      buttonStatus: (item?.buttonStatus ?? item?.button_status) === undefined ||
        (item?.buttonStatus ?? item?.button_status) === null
        ? null
        : Number(item?.buttonStatus ?? item?.button_status),
      canAudit: item?.canAudit === true || item?.can_audit === true,
      canEdit: item?.canEdit === true || item?.can_edit === true,
      noHavePack: item?.noHavePack === true || item?.no_have_pack === true,
      materialImgUrl: String(item?.materialImgUrl ?? item?.material_img_url ?? '').trim(),
      isSameSku: item?.isSameSku === true ||
        item?.is_same_sku === true ||
        Number(item?.isSameSku ?? item?.is_same_sku ?? 0) === 1,
      skuInfo: skuInfo.map((sku) => ({
        skuId: Number(sku?.skuId ?? sku?.sku_id ?? 0) || null,
        skuCode: String(sku?.skuCode ?? sku?.sku_code ?? sku?.ext_code ?? '').trim(),
        skuName: String(sku?.skuName ?? sku?.sku_name ?? sku?.name ?? '').trim()
      })),
      skuIdList: skuInfo
        .map((sku) => Number(sku?.skuId ?? sku?.sku_id ?? 0))
        .filter((skuId) => skuId > 0),
      labelImageList: labelImageList.map((image) => ({
        position: image?.position === undefined || image?.position === null ? null : Number(image.position),
        image: String(image?.image ?? image?.imageUrl ?? image?.image_url ?? '').trim(),
        positionType: (image?.positionType ?? image?.position_type) === undefined ||
          (image?.positionType ?? image?.position_type) === null
          ? null
          : Number(image?.positionType ?? image?.position_type)
      })),
      positionDetail: positionDetail.map((detail) => ({
        position: detail?.position === undefined || detail?.position === null ? null : Number(detail.position),
        isSameSku: detail?.isSameSku === true ||
          detail?.is_same_sku === true ||
          Number(detail?.isSameSku ?? detail?.is_same_sku ?? 0) === 1,
        skuPhotoInfoList: (Array.isArray(detail?.skuPhotoInfoList)
          ? detail.skuPhotoInfoList
          : Array.isArray(detail?.sku_photo_info_list)
            ? detail.sku_photo_info_list
            : []
        ).map((skuPhoto) => ({
              skuId: Number(skuPhoto?.skuId ?? skuPhoto?.sku_id ?? 0) || null,
              imageList: (Array.isArray(skuPhoto?.imageList)
                ? skuPhoto.imageList
                : Array.isArray(skuPhoto?.image_list)
                  ? skuPhoto.image_list
                  : []
              ).map((image) => ({
                    imageUrl: String(image?.imageUrl ?? image?.image_url ?? image?.image ?? '').trim(),
                    positionType: (image?.positionType ?? image?.position_type) === undefined ||
                      (image?.positionType ?? image?.position_type) === null
                      ? null
                      : Number(image?.positionType ?? image?.position_type)
                  }))
            }))
      })),
      ruleCheckResultList: ruleCheckResultList.map((rule) => ({
        checkType: (rule?.checkType ?? rule?.check_type) === undefined ||
          (rule?.checkType ?? rule?.check_type) === null
          ? null
          : Number(rule?.checkType ?? rule?.check_type),
        checkTypeName: String(rule?.checkTypeName ?? rule?.check_type_name ?? '').trim(),
        ruleName: String(rule?.ruleName ?? rule?.rule_name ?? '').trim(),
        ruleStatus: (rule?.ruleStatus ?? rule?.rule_status) === undefined ||
          (rule?.ruleStatus ?? rule?.rule_status) === null
          ? null
          : Number(rule?.ruleStatus ?? rule?.rule_status),
        ruleStatusToast: String(rule?.ruleStatusToast ?? rule?.rule_status_toast ?? '').trim()
      }))
    };
  });
}

function summarizeRealPictureListResult(result = {}) {
  const items = Array.isArray(result.items) ? result.items : [];
  return {
    total: Number(result.total || 0) || 0,
    itemCount: items.length,
    page: Number(result.page || 1) || 1,
    pageSize: Number(result.pageSize || result.page_size || 0) || 0,
    fetchedAll: result.fetchedAll === true,
    fetchedPages: Number(result.fetchedPages || 0) || 0
  };
}

function buildRealPictureSubmitPayload(target, uploadImgUrls, confirmType = 4) {
  const positions = Object.keys(asPlainObject(uploadImgUrls))
    .map((position) => Number(position))
    .filter((position) => Number.isFinite(position) && position > 0)
    .sort((a, b) => a - b);
  if (!positions.length) {
    throw new Error('至少需要提供一个 position 的图片');
  }
  return {
    confirm_type: Number(confirmType || 4),
    spu_id: target.spuId,
    goods_id: target.goodsId,
    real_picture_info_list: positions.map((position) => {
      const imageUrls = uploadImgUrls[String(position)] || [];
      if (!imageUrls.length) {
        throw new Error(`position ${position} 至少需要一张图片`);
      }
      return {
        position,
        is_same_sku: target.isSameSku ? 1 : 0,
        sku_photo_info_list: target.skuIdList.map((skuId) => ({
          sku_id: skuId,
          image_list: imageUrls.map((imageUrl) => ({
            image_url: imageUrl,
            position_type: 2
          }))
        }))
      };
    })
  };
}

function buildRealPictureListPayload(payload = {}) {
  const fetchAll = !!(payload.fetchAll || payload.fetch_all || payload.allPages || payload.all_pages);
  const pageSize = fetchAll
    ? Math.min(50, Math.max(1, Number(payload.pageSize || payload.page_size || 50) || 50))
    : Math.max(1, Number(payload.pageSize || payload.page_size || 20) || 20);
  const result = {
    page: Math.max(1, Number(payload.page || payload.pageNum || payload.page_num || 1) || 1),
    page_size: pageSize
  };
  const checkTypeList = toNumberArray(payload.checkTypeList || payload.check_type_list);
  const hasCheckTypeStatusList = Object.prototype.hasOwnProperty.call(payload, 'checkTypeStatusList') ||
    Object.prototype.hasOwnProperty.call(payload, 'check_type_status_list');
  const checkTypeStatusList = toNumberArray(
    payload.checkTypeStatusList || payload.check_type_status_list
  );
  const rapidScreenStatusList = toNumberArray(payload.rapidScreenStatusList || payload.rapid_screen_status_list);
  const goodsStatusList = toNumberArray(payload.goodsStatusList || payload.goods_status_list || [1, 2]);
  const blackWordTypeList = toNumberArray(payload.blackWordTypeList || payload.black_word_type_list);
  const spuIdList = toStringArray(payload.spuIdList || payload.spu_id_list);
  if (checkTypeList.length) result.check_type_list = checkTypeList;
  if (hasCheckTypeStatusList) result.check_type_status_list = checkTypeStatusList;
  if (rapidScreenStatusList.length) result.rapid_screen_status_list = rapidScreenStatusList;
  result.goods_status_list = goodsStatusList.length ? goodsStatusList : [1, 2];
  if (blackWordTypeList.length) result.black_word_type_list = blackWordTypeList;
  if (spuIdList.length) result.spu_id_list = spuIdList;
  return result;
}

function buildCompliancePageQueryPayload(payload = {}) {
  const fetchAll = !!(payload.fetchAll || payload.fetch_all || payload.allPages || payload.all_pages);
  const pageSize = fetchAll
    ? Math.min(50, Math.max(1, Number(payload.pageSize ?? payload.page_size ?? 50) || 50))
    : Math.max(1, Number(payload.pageSize ?? payload.page_size ?? 10) || 10);
  const goodsStatusList = toNumberArray(payload.goodsStatusList ?? payload.goods_status_list ?? [1, 2]);
  const taskStatusList = toNumberArray(payload.taskStatusList ?? payload.task_status_list ?? [2]);
  const spuIdList = toNumberArray(payload.spuIdList ?? payload.spu_id_list)
    .map((item) => String(item));
  const result = {
    page_num: Math.max(1, Number(payload.pageNum ?? payload.page_num ?? 1) || 1),
    page_size: pageSize,
    type: payload.type === undefined || payload.type === null || payload.type === ''
      ? 2
      : Number(payload.type),
    goods_status_list: goodsStatusList.length ? goodsStatusList : [1, 2],
    task_status_list: taskStatusList.length ? taskStatusList : [2]
  };
  if (spuIdList.length) {
    result.spu_id_list = spuIdList;
  }
  return result;
}

function isIgnoredComplianceTask(task) {
  return false;
}

function isActionableComplianceStatus(status) {
  return [2, 5, 10, 11].includes(Number(status));
}

function filterComplianceTaskList(taskList) {
  return (Array.isArray(taskList) ? taskList : [])
    .map((task) => {
      const nextTask = { ...asPlainObject(task) };
      const children = Array.isArray(nextTask.wait_task_dtolist)
        ? nextTask.wait_task_dtolist
        : Array.isArray(nextTask.waitTaskDtoList)
          ? nextTask.waitTaskDtoList
          : [];
      const filteredChildren = filterComplianceTaskList(children);
      if (Array.isArray(nextTask.wait_task_dtolist)) {
        nextTask.wait_task_dtolist = filteredChildren;
      }
      if (Array.isArray(nextTask.waitTaskDtoList)) {
        nextTask.waitTaskDtoList = filteredChildren;
      }
      return nextTask;
    })
    .filter((task) => !isIgnoredComplianceTask(task));
}

function normalizeComplianceItem(item) {
  const nextItem = { ...asPlainObject(item) };
  const rawTaskList = Array.isArray(nextItem.wait_task_dtolist)
    ? nextItem.wait_task_dtolist
    : Array.isArray(nextItem.waitTaskDtoList)
      ? nextItem.waitTaskDtoList
      : [];
  const rawShowTaskList = Array.isArray(nextItem.wait_task_show_dtolist)
    ? nextItem.wait_task_show_dtolist
    : Array.isArray(nextItem.waitTaskShowDtoList)
      ? nextItem.waitTaskShowDtoList
      : [];
  const filteredTaskList = filterComplianceTaskList(rawTaskList);
  const filteredShowTaskList = filterComplianceTaskList(rawShowTaskList);
  nextItem.wait_task_dtolist = filteredTaskList;
  nextItem.waitTaskDtoList = filteredTaskList;
  nextItem.wait_task_show_dtolist = filteredShowTaskList;
  nextItem.waitTaskShowDtoList = filteredShowTaskList;
  const visibleTaskList = filteredShowTaskList.length ? filteredShowTaskList : filteredTaskList;
  const hasPendingTask = visibleTaskList.some((task) => {
    const status = Number(task?.status);
    const childList = Array.isArray(task?.wait_task_dtolist)
      ? task.wait_task_dtolist
      : Array.isArray(task?.waitTaskDtoList)
        ? task.waitTaskDtoList
        : [];
    return isActionableComplianceStatus(status) || childList.some((child) => isActionableComplianceStatus(child?.status));
  });
  return hasPendingTask ? nextItem : null;
}

async function uploadRealPicturePositionImages(profileId, region, positionImageUrls) {
  const sourceEntries = [];
  Object.entries(positionImageUrls).forEach(([position, urls]) => {
    normalizeRemoteUrlList(urls).forEach((sourceUrl) => {
      sourceEntries.push({ position, sourceUrl });
    });
  });
  const sources = Array.from(new Set(sourceEntries.map((item) => item.sourceUrl)));
  const browser = await getOrCreateBrowser({ profileId });
  const page = await browser.newPage({ background: true, activate: false });
  try {
    const origin = REGION_ORIGIN_MAP[normalizeRegion(region)] || REGION_ORIGIN_MAP.global;
    await page.goto(`${origin}/`, { waitUntil: 'domcontentloaded', timeout: 30_000 }).catch(() => undefined);
    const uploadResult = await uploadTemuImagesToCloud(page, sources, {
      resourceLabel: '实拍图',
      emptyMessage: '未提供实拍图图片，跳过上传'
    });
    if (!uploadResult?.success) {
      throw new Error(uploadResult?.message || '实拍图上传 Temu 云文件失败');
    }
    const sourceUrlMap = new Map(
      (Array.isArray(uploadResult.uploadedImages) ? uploadResult.uploadedImages : [])
        .map((item) => [String(item?.source || '').trim(), String(item?.url || '').trim()])
        .filter(([source, url]) => source && /^https?:\/\//i.test(url))
    );
    const uploadedPositionMap = {};
    sourceEntries.forEach(({ position, sourceUrl }) => {
      const uploadedUrl = sourceUrlMap.get(sourceUrl);
      if (!uploadedUrl) return;
      if (!uploadedPositionMap[position]) uploadedPositionMap[position] = [];
      uploadedPositionMap[position].push(uploadedUrl);
    });
    Object.keys(uploadedPositionMap).forEach((position) => {
      uploadedPositionMap[position] = Array.from(new Set(uploadedPositionMap[position]));
    });
    return {
      uploadedPositionMap,
      uploadedImages: sourceEntries
        .map(({ position, sourceUrl }) => ({
          position,
          sourceUrl,
          uploadedUrl: sourceUrlMap.get(sourceUrl) || ''
        }))
        .filter((item) => item.uploadedUrl)
    };
  } finally {
    await page.close().catch(() => undefined);
  }
}

async function runPagedSearchForChainSupplier({ action, profileId, region, payload, pageSize, successMessage, failureMessage }) {
  const fetchAll = !!(payload.fetchAll || payload.fetch_all || payload.allPages || payload.all_pages);
  const basePayload = { ...payload, pageSize };
  delete basePayload.fetchAll;
  delete basePayload.fetch_all;
  delete basePayload.allPages;
  delete basePayload.all_pages;
  const requestPage = (pageNum) =>
    requestTemuJson(region, '/api/kiana/mms/robin/searchForChainSupplier', {
      ...basePayload,
      pageNum,
      pageSize
    }, { profileId });
  const response = await requestPage(Number(basePayload.pageNum || 1) || 1);
  const firstResult = response.payload?.result || {};
  const total = Number(firstResult.total || 0) || 0;
  const items = Array.isArray(firstResult.dataList) ? [...firstResult.dataList] : [];
  let fetchedPages = 1;
  if (fetchAll && total > items.length) {
    const totalPages = Math.max(1, Math.ceil(total / pageSize));
    for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
      const pageResponse = await requestPage(pageNum);
      const pageItems = Array.isArray(pageResponse.payload?.result?.dataList)
        ? pageResponse.payload.result.dataList
        : [];
      items.push(...pageItems);
      fetchedPages = pageNum;
      if (!pageItems.length || pageItems.length < pageSize) break;
    }
  }
  return buildFeatureResponse({
    action,
    profileId,
    region,
    requestResult: response,
    successMessage,
    failureMessage,
    result: {
      total,
      pageNum: Number(basePayload.pageNum || 1) || 1,
      pageSize,
      items,
      fetchedAll: fetchAll,
      fetchedPages,
      skcSpuList: extractLifecycleSkcSpuPairs({ result: { total, dataList: items } })
    }
  });
}

async function executeAction(actionKey, profileId, region, payload) {
  if (actionKey === 'goods.price-review.list') {
    return runPagedSearchForChainSupplier({
      action: actionKey,
      profileId,
      region,
      payload: {
        pageNum: Number(payload.pageNum || 1),
        priceReviewStatusList: [0, 1, 2, 3],
        removeStatus: 0,
        secondarySelectStatusList: [7],
        supplierTodoTypeList: [1],
        ...payload
      },
      pageSize: Math.min(1000, Math.max(1, Number(payload.pageSize || 1000) || 1000)),
      successMessage: '获取待核价商品列表成功',
      failureMessage: '获取待核价商品列表失败'
    });
  }

  if (actionKey === 'jit.list') {
    return runPagedSearchForChainSupplier({
      action: actionKey,
      profileId,
      region,
      payload: {
        removeStatus: 0,
        supplierTodoTypeList: [],
        secondarySelectStatusList: [10],
        ...payload
      },
      pageSize: Math.min(1000, Math.max(1, Number(payload.pageSize || 1000) || 1000)),
      successMessage: '获取 JIT 列表成功',
      failureMessage: '获取 JIT 列表失败'
    });
  }

  if (actionKey === 'goods.modify-price') {
    const supplierResult = Number(payload.supplierResult || 0);
    const response =
      supplierResult === 3
        ? await requestTemuJson(region, '/api/kiana/mms/magneto/api/price-review-order/no-bom/review', {
            priceOrderId: Number(payload.priceOrderId || 0)
          }, { profileId })
        : await requestTemuJson(region, '/api/kiana/mms/magneto/price/bargain-no-bom', {
            supplierResult,
            priceOrderId: Number(payload.priceOrderId || 0),
            items: Array.isArray(payload.items) ? payload.items : [],
            bargainReasonList: Array.isArray(payload.bargainReasonList) ? payload.bargainReasonList : []
          }, { profileId });
    return buildFeatureResponse({
      action: actionKey,
      profileId,
      region,
      requestResult: response,
      successMessage: supplierResult === 3 ? '提交放弃报价成功' : supplierResult === 2 ? '提交重新报价成功' : '提交确认报价成功',
      failureMessage: supplierResult === 3 ? '提交放弃报价失败' : supplierResult === 2 ? '提交重新报价失败' : '提交确认报价失败',
      result: { priceOrderId: Number(payload.priceOrderId || 0), supplierResult }
    });
  }

  if (actionKey === 'jit.open') {
    const skcSpuList = Array.isArray(payload.skcSpuList) ? payload.skcSpuList : [];
    const response = await requestTemuJson(region, '/visage-agent-seller/product/skc/batchOpenJit', {
      productSkcSubSellModeReqList: skcSpuList.map((item) => ({
        productSkcId: Number(item?.skcId || item?.productSkcId || 0),
        productId: Number(item?.spuId || item?.productId || 0)
      }))
    }, { profileId });
    return buildFeatureResponse({
      action: actionKey,
      profileId,
      region,
      requestResult: response,
      successMessage: '开通 JIT 成功',
      failureMessage: '开通 JIT 失败',
      result: {
        failedSkcList: Array.isArray(response.payload?.result?.handleProductFailedMsgList)
          ? response.payload.result.handleProductFailedMsgList
          : []
      }
    });
  }

  if (actionKey === 'jit.stock.update') {
    const skcId = Number(payload.skcId || 0);
    const finalNum = Number(payload.finalNum || 500);
    const goodsResponse = await requestTemuJson(region, '/visage-agent-seller/product/skc/pageQuery', {
      page: 1,
      pageSize: 50,
      productSkcIds: [skcId]
    }, { profileId });
    const stockPayload = buildJitStockUpdatePayload({
      goodsRelations: extractGoodsRelations(goodsResponse.payload),
      skcId,
      finalNum
    });
    if (!stockPayload) {
      return { success: false, action: actionKey, message: '未找到对应的 SKC 商品信息', profileId, region, request: {}, result: { skcId, finalNum }, raw: goodsResponse.payload ?? null };
    }
    if (stockPayload.skipped) {
      return { success: true, action: actionKey, message: '当前库存已满足目标数量，无需调整', profileId, region, request: {}, result: { skcId, finalNum, skipped: true }, raw: goodsResponse.payload ?? null };
    }
    const response = await requestTemuJson(region, '/darwin-mms/api/kiana/foredawn/sales/stock/updateMmsProductSalesStock', stockPayload, { profileId });
    return buildFeatureResponse({
      action: actionKey,
      profileId,
      region,
      requestResult: response,
      successMessage: '更新 JIT 库存成功',
      failureMessage: '更新 JIT 库存失败',
      result: { skcId, finalNum, requestPayload: stockPayload }
    });
  }

  if (actionKey === 'goods.real-picture.submit') {
    const spuId = Number(payload.spuId || payload.spu_id || 0);
    if (!spuId) {
      throw new Error('spuId 不能为空');
    }
    const listResponse = await requestTemuJson(region, '/api/flash/real_picture/list', {
      page: 1,
      page_size: 20,
      check_type_status_list: [1],
      goods_status_list: [1, 2],
      spu_id_list: [String(spuId)]
    }, { profileId });
    const fallbackItem = extractRealPictureItems(listResponse.payload)
      .find((item) => Number(item.spuId || 0) === spuId);
    const target = {
      spuId,
      goodsId: Number(payload.goodsId || payload.goods_id || fallbackItem?.goodsId || 0),
      isSameSku: payload.isSameSku !== undefined && payload.isSameSku !== null
        ? !!payload.isSameSku
        : !!fallbackItem?.isSameSku,
      skuIdList: toNumberArray(
        Array.isArray(payload.skuIdList) && payload.skuIdList.length
          ? payload.skuIdList
          : fallbackItem?.skuIdList || []
      ),
      labelImageList: Array.isArray(payload.existingLabelImageList)
        ? payload.existingLabelImageList
        : fallbackItem?.labelImageList || []
    };
    if (!target.goodsId) throw new Error('未能自动解析 goodsId，请手动传入 goodsId 后重试');
    if (!target.skuIdList.length) throw new Error('未能自动解析 skuIdList，请手动传入 skuIdList 后重试');

    const uploadedReusableMap = normalizeRealPicturePositionMap(
      payload.uploadedPositionImageUrls || payload.uploaded_position_image_urls
    );
    const positionImageUrls = normalizeRealPicturePositionMap(payload.positionImageUrls || payload.position_image_urls);
    const uploadResult = Object.keys(uploadedReusableMap).length
      ? {
          uploadedPositionMap: uploadedReusableMap,
          uploadedImages: Object.entries(uploadedReusableMap).flatMap(([position, urls]) =>
            normalizeRemoteUrlList(urls).map((imageUrl) => ({
              position,
              sourceUrl: imageUrl,
              uploadedUrl: imageUrl,
              cacheHit: true
            }))
          )
        }
      : await uploadRealPicturePositionImages(profileId, region, positionImageUrls);
    const existingMap = payload.appendToExisting === false ? {} : groupExistingLabelImages(target.labelImageList);
    const finalImageMap = mergePositionImages(existingMap, uploadResult.uploadedPositionMap);
    const submitPayload = buildRealPictureSubmitPayload(target, finalImageMap, Number(payload.confirmType || 4));
    const response = await requestTemuJson(region, '/api/flash/real_picture/upload_new', submitPayload, { profileId });
    return buildFeatureResponse({
      action: actionKey,
      profileId,
      region,
      requestResult: response,
      successMessage: '提交实拍图成功',
      failureMessage: '提交实拍图失败',
      result: {
        spuId: target.spuId,
        goodsId: target.goodsId,
        skuIdList: target.skuIdList,
        uploadedImages: uploadResult.uploadedImages,
        finalPositionImageCount: Object.fromEntries(
          Object.entries(finalImageMap).map(([position, urls]) => [position, urls.length])
        ),
        usedExistingImages: payload.appendToExisting !== false,
        autoResolvedFromList: !!fallbackItem
      }
    });
  }

  const genericMap = {
    'compliance.page-query': ['/ms/bg-flux-ms/compliance_property/page_query', '获取合规分页数据成功', '获取合规分页数据失败'],
    'compliance.detail': [payload.detailType === 'detail' ? '/ms/bg-flux-ms/compliance_property/query_detail' : '/ms/bg-flux-ms/compliance_property/query_template', '获取合规详情成功', '获取合规详情失败'],
    'compliance.submit': ['/ms/bg-flux-ms/compliance_property/edit_compliance', '提交合规信息成功', '提交合规信息失败'],
    'goods.real-picture.list': ['/api/flash/real_picture/list', '获取实拍图列表成功', '获取实拍图列表失败']
  };
  const generic = genericMap[actionKey];
  if (generic) {
    const [path, successMessage, failureMessage] = generic;
    if (actionKey === 'compliance.page-query') {
      const requestPayload = buildCompliancePageQueryPayload(payload);
      const fetchAll = !!(payload.fetchAll || payload.fetch_all || payload.allPages || payload.all_pages);
      const requestPage = (pageNum) => requestTemuJson(region, path, {
        ...requestPayload,
        page_num: pageNum,
        page_size: requestPayload.page_size
      }, { profileId });
      const response = await requestPage(Number(requestPayload.page_num || 1) || 1);
      const firstResult = response.payload?.result || {};
      const total = Number(firstResult.total || 0) || 0;
      const items = (Array.isArray(firstResult.data) ? firstResult.data : [])
        .map(normalizeComplianceItem)
        .filter(Boolean);
      let fetchedPages = 1;
      if (fetchAll && total > (Array.isArray(firstResult.data) ? firstResult.data.length : items.length)) {
        const totalPages = Math.max(1, Math.ceil(total / requestPayload.page_size));
        for (let pageNum = 2; pageNum <= totalPages; pageNum += 1) {
          const pageResponse = await requestPage(pageNum);
          const pageRawItems = Array.isArray(pageResponse.payload?.result?.data)
            ? pageResponse.payload.result.data
            : [];
          const pageItems = pageRawItems.map(normalizeComplianceItem).filter(Boolean);
          items.push(...pageItems);
          fetchedPages = pageNum;
          if (!pageRawItems.length || pageRawItems.length < requestPayload.page_size) break;
        }
      }
      return buildFeatureResponse({
        action: actionKey,
        profileId,
        region,
        requestResult: response,
        successMessage,
        failureMessage,
        result: {
          total: items.length,
          rawTotal: total,
          items,
          pageNum: Number(requestPayload.page_num || 1) || 1,
          pageSize: requestPayload.page_size,
          fetchedAll: fetchAll,
          fetchedPages
        }
      });
    }
    if (actionKey === 'goods.real-picture.list') {
      const requestPayload = buildRealPictureListPayload(payload);
      const fetchAll = !!(payload.fetchAll || payload.fetch_all || payload.allPages || payload.all_pages);
      const requestPage = (page) => requestTemuJson(region, path, {
        ...requestPayload,
        page,
        page_size: requestPayload.page_size
      }, { profileId });
      logger.info('[temu-api-action] 实拍图列表开始获取', {
        profileId,
        region,
        fetchAll,
        requestPayload
      });
      const response = await requestPage(Number(requestPayload.page || 1) || 1);
      const firstResult = response.payload?.result || {};
      const firstRawItems = Array.isArray(firstResult.items) ? firstResult.items : [];
      const items = extractRealPictureListItems({ result: { items: firstRawItems } });
      const total = Number(firstResult.total || items.length || 0) || 0;
      let fetchedPages = 1;
      logger.info('[temu-api-action] 实拍图列表第 1 页完成', {
        status: response.status,
        success: response.success,
        total,
        rawItemCount: firstRawItems.length,
        slimItemCount: items.length,
        pageSize: requestPayload.page_size
      });
      if (fetchAll && total > items.length) {
        const totalPages = Math.max(1, Math.ceil(total / requestPayload.page_size));
        for (let page = 2; page <= totalPages; page += 1) {
          logger.info('[temu-api-action] 实拍图列表继续获取分页', {
            page,
            totalPages,
            currentItemCount: items.length
          });
          const pageResponse = await requestPage(page);
          const pageRawItems = Array.isArray(pageResponse.payload?.result?.items)
            ? pageResponse.payload.result.items
            : [];
          const pageItems = extractRealPictureListItems({ result: { items: pageRawItems } });
          items.push(...pageItems);
          fetchedPages = page;
          logger.info('[temu-api-action] 实拍图列表分页完成', {
            page,
            status: pageResponse.status,
            success: pageResponse.success,
            rawItemCount: pageRawItems.length,
            slimItemCount: pageItems.length,
            accumulatedItemCount: items.length
          });
          if (!pageRawItems.length || pageRawItems.length < requestPayload.page_size) break;
        }
      }
      const result = {
        total,
        items,
        page: Number(requestPayload.page || 1) || 1,
        pageSize: requestPayload.page_size,
        fetchedAll: fetchAll,
        fetchedPages
      };
      logger.info('[temu-api-action] 实拍图列表获取完成，准备回传', summarizeRealPictureListResult(result));
      return buildFeatureResponse({
        action: actionKey,
        profileId,
        region,
        requestResult: response,
        successMessage,
        failureMessage,
        result,
        raw: {
          success: response.payload?.success,
          error_code: response.payload?.error_code,
          error_msg: response.payload?.error_msg,
          result: {
            total,
            items
          }
        }
      });
    }
    const requestPayload =
      actionKey === 'compliance.detail' || actionKey === 'compliance.submit'
        ? asPlainObject(payload.payload)
        : payload;
    const response = await requestTemuJson(region, path, requestPayload, { profileId });
    return buildFeatureResponse({
      action: actionKey,
      profileId,
      region,
      requestResult: response,
      successMessage,
      failureMessage,
      result: response.payload?.result ?? {}
    });
  }

  throw new Error(`客户端暂不支持 Temu 动作: ${actionKey}`);
}

export async function runTemuApiActionSmallFeature(input = {}) {
  const root = asPlainObject(input);
  const nestedCommandPayload = asPlainObject(asPlainObject(root.command).payload);
  const nestedData = asPlainObject(root.data);
  const actionEnvelope = {
    ...nestedCommandPayload,
    ...nestedData,
    ...root
  };
  const rawPayload = asPlainObject(actionEnvelope.payload);
  const innerPayload = asPlainObject(rawPayload.payload);
  const payload = {
    ...rawPayload,
    ...innerPayload
  };
  const actionKey = String(
    actionEnvelope.actionKey ||
      rawPayload.actionKey ||
      innerPayload.actionKey ||
      ''
  ).trim();
  const profileId = String(
    actionEnvelope.profileId ||
      rawPayload.profileId ||
      innerPayload.profileId ||
      ''
  ).trim();
  const region = normalizeRegion(
    actionEnvelope.region ||
      rawPayload.region ||
      innerPayload.region ||
      'global'
  );
  if (!actionKey) {
    throw new Error('缺少 actionKey');
  }
  if (!profileId) {
    throw new Error('缺少 profileId');
  }
  logger.info('[temu-api-action] 开始执行 Temu 动作', {
    actionKey,
    profileId,
    region
  });
  let result;
  try {
    result = await executeAction(actionKey, profileId, region, {
      ...payload,
      profileId,
      region
    });
  } catch (error) {
    logger.error('[temu-api-action] Temu 动作执行异常', {
      actionKey,
      profileId,
      region,
      message: error?.message || String(error)
    });
    throw error;
  }
  if (actionKey === 'goods.real-picture.list') {
    logger.info('[temu-api-action] Temu 动作执行完成', {
      actionKey,
      success: !!result.success,
      message: result.message || '',
      resultSummary: summarizeRealPictureListResult(result.result || {})
    });
  } else {
    logger.info('[temu-api-action] Temu 动作执行完成', {
      actionKey,
      success: !!result.success,
      message: result.message || ''
    });
  }
  return {
    success: !!result.success,
    message: result.message || (result.success ? 'Temu 动作执行成功' : 'Temu 动作执行失败'),
    data: result
  };
}
