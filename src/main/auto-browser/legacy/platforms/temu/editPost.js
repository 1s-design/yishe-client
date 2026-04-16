import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PRODUCT_ADD_URL =
  process.env.TEMU_PRODUCT_ADD_URL ||
  "https://agentseller.temu.com/visage-agent-seller/product/add";
const REQUEST_TIMEOUT_MS = Number(process.env.TEMU_TIMEOUT_MS || 30000);
const OUTPUT_FILE = process.env.TEMU_OUTPUT_FILE || "editPost.response.json";
const VERBOSE = process.env.TEMU_VERBOSE === "1";

// 这里按“只使用你提供的 cookie”来测。
// 如果后续你想对比 cookie + anti-content 的效果，可以在运行时额外传 TEMU_ANTI_CONTENT。
const COOKIE_MAP = {
  _bee: "l23KtNxgFNt0TYQAyQHYmL85x7L25apT",
  dilx: "ivjv3vZyj3vopA3YBBF1N",
  hfsc: "L3yNfosy6Tf91JbLfw==",
  njrpl: "l23KtNxgFNt0TYQAyQHYmL85x7L25apT",
  mallid: "634418228268635",
  api_uid: "CmzkBWne+xdOB7bEIZg9Ag==",
  _nano_fp: "GWiVbWRcxOi27_i2zaizC#LmlcqJ2KAnJ_Uteza4Vx2",
  seller_temp:
    "N_eyJ0IjoiVGU0VUFHZk5sWWNJZU9FeG1BSnVtUHd3SmFKY1dGLzBtVm1oZVhzZUhCTkVIY21BK0FKU0pyakE1QWJjVW1PN2xxcjFwUGRwU1pRd3dOOHZMYTNva2c9PSIsInYiOjEsInMiOjEwMDAxLCJ1IjoyOTUwOTMwNzU2ODU3MX0=",
};

export const editPostPayload = {
  cat1Id: 2542,
  cat2Id: 3715,
  cat3Id: 3716,
  cat4Id: 3891,
  cat5Id: 3895,
  cat6Id: 3896,
  cat7Id: 0,
  cat8Id: 0,
  cat9Id: 0,
  cat10Id: 0,
  materialMultiLanguages: [],
  productName:
    "2D Flat Printing Wall Tapestry 1pc Rainbow Grid Playful Stars Kawaii Cartoon Fun Festive, Digital Nature Aesthetic Landscape, High-Definition Surreal Art, Fabric Backdrop for Bedroom, Summer Sports Carnival Atmosphere with Easy Install Kit",
  productPropertyReqs: [
    {
      valueUnit: "",
      propValue: "橡胶",
      propName: "材质",
      refPid: 12,
      vid: 417,
      numberInputValue: "",
      controlType: 1,
      pid: 1,
      templatePid: 911267,
      valueExtendInfo: "",
    },
    {
      valueUnit: "",
      propValue: "防滑",
      propName: "特殊功能",
      refPid: 143,
      vid: 3884,
      numberInputValue: "",
      controlType: 1,
      pid: 94,
      templatePid: 403078,
      valueExtendInfo: "",
    },
    {
      valueUnit: "",
      propValue: "2mm",
      propName: "厚度",
      refPid: 4004,
      vid: 403997,
      numberInputValue: "",
      controlType: 1,
      pid: 275,
      templatePid: 1748831,
      valueExtendInfo: "",
    },
  ],
  productSkcReqs: [
    {
      previewImgUrls: [
        "https://img.kwcdn.com/product/fancy/e461993a-5314-4f8a-b491-71770ba58891.jpg",
      ],
      productSkcCarouselImageI18nReqs: [],
      extCode: "",
      mainProductSkuSpecReqs: [
        {
          parentSpecId: 0,
          parentSpecName: "",
          specId: 0,
          specName: "",
        },
      ],
      productSkuReqs: [
        {
          thumbUrl:
            "https://img.kwcdn.com/product/fancy/eaf51fa9-bd02-4e66-9649-8377ce018c7b.jpg",
          productSkuThumbUrlI18nReqs: [],
          extCode: "test02",
          supplierPrice: 2000,
          currencyType: "CNY",
          productSkuSpecReqs: [
            {
              parentSpecId: 1001,
              parentSpecName: "颜色",
              specId: 95406591,
              specName: "24*12inch(60*30cm)",
              specLangSimpleList: [],
            },
          ],
          productSkuId: 0,
          productSkuSuggestedPriceReq: {
            suggestedPrice: 2000,
            suggestedPriceCurrencyType: "CNY",
          },
          productSkuUsSuggestedPriceReq: {},
          productSkuWhExtAttrReq: {
            productSkuVolumeReq: {
              len: 315,
              width: 60,
              height: 60,
            },
            productSkuWeightReq: {
              value: 270000,
            },
            productSkuBarCodeReqs: [],
            productSkuSensitiveAttrReq: {
              isSensitive: 0,
              sensitiveList: [],
            },
            productSkuSensitiveLimitReq: {},
          },
          productSkuMultiPackReq: {
            skuClassification: 1,
            numberOfPieces: 1,
            pieceUnitCode: 1,
            productSkuNetContentReq: {},
            totalNetContent: {},
          },
          productSkuAccessoriesReq: {
            productSkuAccessories: [],
          },
          productSkuNonAuditExtAttrReq: {},
        },
      ],
      productSkcId: 0,
      isBasePlate: 0,
    },
  ],
  productSpecPropertyReqs: [
    {
      parentSpecId: 1001,
      parentSpecName: "颜色",
      specId: 95406591,
      specName: "24*12inch(60*30cm)",
      vid: 0,
      specLangSimpleList: [],
      refPid: 0,
      pid: 0,
      templatePid: 0,
      propName: "颜色",
      propValue: "24*12inch(60*30cm)",
      valueUnit: "",
      valueGroupId: 0,
      valueGroupName: "",
      valueExtendInfo: "",
    },
  ],
  carouselImageUrls: [
    "https://img.kwcdn.com/product/fancy/e461993a-5314-4f8a-b491-71770ba58891.jpg",
    "https://img.kwcdn.com/product/fancy/d5406229-52f6-4593-9703-bb99603860e8.jpg",
    "https://img.kwcdn.com/product/fancy/710d17cd-e9ea-47cc-aab2-f0f62db68b8b.jpg",
    "https://img.kwcdn.com/product/fancy/e05e6774-e449-4183-9442-146e63fb7fb9.jpg",
    "https://img.kwcdn.com/product/fancy/687e0b15-9c5c-46e5-aec0-978a1e751a00.jpg",
    "https://img.kwcdn.com/product/fancy/eaf51fa9-bd02-4e66-9649-8377ce018c7b.jpg",
    "https://img.kwcdn.com/product/fancy/49201c5e-b8f8-479a-ab85-4dce83a4a9c7.jpg",
  ],
  carouselImageI18nReqs: [],
  materialImgUrl:
    "https://img.kwcdn.com/product/fancy/e461993a-5314-4f8a-b491-71770ba58891.jpg",
  goodsLayerDecorationReqs: [],
  goodsLayerDecorationCustomizeI18nReqs: [],
  sizeTemplateIds: [],
  showSizeTemplateIds: [],
  goodsModelReqs: [],
  productWhExtAttrReq: {
    outerGoodsUrl: "",
    productOrigin: {
      countryShortName: "CN",
      region2Id: 43000000000018,
    },
  },
  productCarouseVideoReqList: [],
  goodsAdvantageLabelTypes: [],
  productDetailVideoReqList: [],
  productOuterPackageImageReqs: [
    {
      imageUrl:
        "https://pfs.file.temu.com/product-material-private-tag/21140d6a4b8/7f61003e-6969-44c6-9ab3-9030667ade13_1080x1080.jpeg",
    },
  ],
  productOuterPackageReq: {
    packageShape: 1,
    packageType: 2,
  },
  sensitiveTransNormalFileReqs: [],
  productGuideFileNewReqList: [],
  productGuideFileI18nReqs: [],
  productSaleExtAttrReq: {},
  productNonAuditExtAttrReq: {
    california65WarningInfoReq: {},
    cosmeticInfoReq: {},
  },
  personalizationSwitch: 0,
  productComplianceStatementReq: {
    protocolVersion: "V2.0",
    protocolUrl:
      "https://dl.kwcdn.com/seller-public-file-us-tag/2079f603b6/56888d17d8166a6700c9f3e82972e813.html",
  },
  productOriginCertFileReqs: [],
  // productDraftId: 8968424492,
};

function buildCookieHeader(cookieMap) {
  return Object.entries(cookieMap)
    .filter(([key, value]) => String(key || "").trim() && value !== undefined && value !== null)
    .map(([key, value]) => `${key}=${value}`)
    .join("; ");
}

function buildHeaders(cookieHeader) {
  const mallId = String(COOKIE_MAP.mallid || "").trim();
  const antiContent = String(process.env.TEMU_ANTI_CONTENT || "").trim();
  const headers = {
    accept: "application/json, text/plain, */*",
    "content-type": "application/json",
    origin: "https://agentseller.temu.com",
    referer: process.env.TEMU_REFERER || "https://agentseller.temu.com/",
    "user-agent":
      process.env.TEMU_USER_AGENT ||
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
    cookie: cookieHeader,
  };

  if (mallId) {
    headers.mallid = mallId;
  }

  if (antiContent) {
    headers["anti-content"] = antiContent;
  }

  return headers;
}

function summarizePayload(payload) {
  const skcList = Array.isArray(payload.productSkcReqs) ? payload.productSkcReqs : [];
  const skuCount = skcList.reduce((count, skc) => {
    const skuList = Array.isArray(skc.productSkuReqs) ? skc.productSkuReqs : [];
    return count + skuList.length;
  }, 0);

  return {
    productName: payload.productName,
    draftId: payload.productDraftId,
    categoryIds: [
      payload.cat1Id,
      payload.cat2Id,
      payload.cat3Id,
      payload.cat4Id,
      payload.cat5Id,
      payload.cat6Id,
    ],
    propertyCount: Array.isArray(payload.productPropertyReqs)
      ? payload.productPropertyReqs.length
      : 0,
    skcCount: skcList.length,
    skuCount,
    carouselImageCount: Array.isArray(payload.carouselImageUrls)
      ? payload.carouselImageUrls.length
      : 0,
    hasComplianceStatement: !!payload.productComplianceStatementReq,
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(`timeout after ${timeoutMs}ms`), timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function parseResponse(response) {
  const rawText = await response.text();
  try {
    return {
      rawText,
      parsed: rawText ? JSON.parse(rawText) : null,
    };
  } catch {
    return {
      rawText,
      parsed: null,
    };
  }
}

async function saveResponseLog(result) {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const outputPath = path.resolve(currentDir, OUTPUT_FILE);
  await writeFile(outputPath, JSON.stringify(result, null, 2), "utf8");
  return outputPath;
}

async function main() {
  const startedAt = new Date();
  const cookieHeader = buildCookieHeader(COOKIE_MAP);
  const headers = buildHeaders(cookieHeader);
  const payloadSummary = summarizePayload(editPostPayload);

  console.log("[temu-edit-post] start");
  console.log("[temu-edit-post] time:", startedAt.toISOString());
  console.log("[temu-edit-post] url:", PRODUCT_ADD_URL);
  console.log(
    "[temu-edit-post] auth mode:",
    headers["anti-content"] ? "cookie + anti-content" : "cookie-only",
  );
  console.log("[temu-edit-post] cookie keys:", Object.keys(COOKIE_MAP).join(", "));
  console.log("[temu-edit-post] payload summary:", payloadSummary);

  if (VERBOSE) {
    console.log("[temu-edit-post] request headers:", headers);
    console.log(
      "[temu-edit-post] request payload:",
      JSON.stringify(editPostPayload, null, 2),
    );
  }

  const requestStartedAt = Date.now();

  try {
    const response = await fetchWithTimeout(
      PRODUCT_ADD_URL,
      {
        method: "POST",
        headers,
        body: JSON.stringify(editPostPayload),
      },
      REQUEST_TIMEOUT_MS,
    );

    const durationMs = Date.now() - requestStartedAt;
    const { rawText, parsed } = await parseResponse(response);
    const result = {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      durationMs,
      url: PRODUCT_ADD_URL,
      authMode: headers["anti-content"] ? "cookie + anti-content" : "cookie-only",
      payloadSummary,
      response: parsed,
      rawText,
    };

    console.log("[temu-edit-post] status:", response.status, response.statusText);
    console.log("[temu-edit-post] durationMs:", durationMs);
    console.log(
      "[temu-edit-post] response preview:",
      parsed ? JSON.stringify(parsed, null, 2) : rawText || "<empty>",
    );

    const outputPath = await saveResponseLog(result);
    console.log("[temu-edit-post] response saved:", outputPath);

    if (!response.ok) {
      process.exitCode = 1;
      return;
    }

    if (parsed?.success === false || parsed?.status === false) {
      process.exitCode = 1;
    }
  } catch (error) {
    const durationMs = Date.now() - requestStartedAt;
    const result = {
      ok: false,
      durationMs,
      url: PRODUCT_ADD_URL,
      authMode: headers["anti-content"] ? "cookie + anti-content" : "cookie-only",
      payloadSummary,
      error: {
        name: error?.name || "Error",
        message: error?.message || String(error),
        stack: error?.stack || "",
      },
    };

    console.error("[temu-edit-post] request failed:", result.error.message);
    console.error("[temu-edit-post] durationMs:", durationMs);
    const outputPath = await saveResponseLog(result);
    console.error("[temu-edit-post] response saved:", outputPath);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error("[temu-edit-post] fatal:", error?.stack || error?.message || error);
  process.exitCode = 1;
});
