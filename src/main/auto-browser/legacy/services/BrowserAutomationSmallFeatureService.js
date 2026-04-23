import {
  runTemuSessionAcquireSmallFeature,
  runTemuLoginSmallFeature,
  runTemuSessionCollectSmallFeature,
  runTemuSessionRestoreSmallFeature,
  runTemuPublishDetailRequestCaptureSmallFeature,
} from "../platforms/temu/smallFeatures.js";
import {
  runDoudianCheckLoginSmallFeature,
  runKuaishouShopCheckLoginSmallFeature,
} from "../platforms/shopLoginFeatures.js";

const SMALL_FEATURE_REGISTRY = {
  "temu-session-acquire": {
    key: "temu-session-acquire",
    name: "Temu 会话获取",
    platform: "temu",
    category: "session",
    visibility: "public",
    description:
      "统一入口：直接执行 Temu 全量会话采集；可复用当前环境登录态，也可先自动登录，再一次性同步账号、店铺、anti-content 与 global/us/eu Cookie。",
    tips: [
      "默认优先直接获取，适合当前环境已经登录的情况。",
      "切换为“登录并获取”后，会先执行账号密码登录，再继续执行同一套全量采集流程。",
      "成功条件已统一：需要拿到核心 cookies、headersTemplate、anti-content、mallList、mallId、accountId，以及 global/us/eu 三套区域 Cookie；缺一项都会判失败。",
    ],
    fields: [
      {
        key: "acquireMode",
        label: "获取方式",
        type: "select",
        required: true,
        defaultValue: "direct",
        options: [
          { label: "直接获取", value: "direct" },
          { label: "登录并获取", value: "login" },
        ],
        description:
          "直接获取会复用当前环境登录态；登录并获取会先执行账号密码登录。",
      },
      {
        key: "account",
        label: "账号",
        type: "text",
        required: false,
        placeholder: "请输入 Temu 账号",
        description: "仅在“登录并获取”时需要填写。",
        requiredWhen: {
          acquireMode: "login",
        },
        visibleWhen: {
          acquireMode: "login",
        },
      },
      {
        key: "password",
        label: "密码",
        type: "password",
        required: false,
        placeholder: "请输入 Temu 密码",
        description: "仅在“登录并获取”时需要填写。",
        requiredWhen: {
          acquireMode: "login",
        },
        visibleWhen: {
          acquireMode: "login",
        },
      },
      {
        key: "collectRegionCookies",
        label: "采集区域 Cookie",
        type: "boolean",
        required: false,
        defaultValue: true,
        description: "开启后会尽力补抓 global / us / eu 三套 Cookie。",
      },
      {
        key: "keepPageOpen",
        label: "保留页面",
        type: "boolean",
        required: false,
        defaultValue: true,
        description: "默认保留页面，方便继续观察结果或处理风控。",
      },
    ],
    handler: runTemuSessionAcquireSmallFeature,
  },
  "temu-publish-detail-request-capture": {
    key: "temu-publish-detail-request-capture",
    name: "根据商品spuId 获取 商品发布模板",
    platform: "temu",
    category: "inspect",
    visibility: "public",
    description:
      "根据商品 spuId 打开 Temu 发布详情页，自动点击“提交”按钮，并获取商品发布模板请求里的 POST 参数。",
    tips: [
      "只需要输入 spuId，其余流程固定为打开页面后点击“提交”。",
      "工具会固定侦听 `https://agentseller.temu.com/visage-agent-seller/product/edit` 这个请求。",
      "返回结果只保留 postData、postDataJson 和 postDataForm。",
    ],
    fields: [
      {
        key: "spuId",
        label: "SPU ID",
        type: "text",
        required: true,
        placeholder: "请输入 spuId",
      },
    ],
    handler: runTemuPublishDetailRequestCaptureSmallFeature,
  },
  "temu-login": {
    key: "temu-login",
    name: "Temu 登录",
    platform: "temu",
    category: "login",
    visibility: "internal",
    description:
      "打开 Temu 商家登录页，按账号登录流程填写账号密码、勾选协议并提交。",
    tips: [
      "默认会使用当前活动环境；传 profileId 时会优先作用到指定环境。",
      "默认执行后保留页面，方便继续观察登录结果和处理风控。",
    ],
    fields: [
      {
        key: "account",
        label: "账号",
        type: "text",
        required: true,
        placeholder: "请输入 Temu 账号",
      },
      {
        key: "password",
        label: "密码",
        type: "password",
        required: true,
        placeholder: "请输入 Temu 密码",
      },
      {
        key: "profileId",
        label: "环境编号",
        type: "text",
        required: false,
        placeholder: "可选，留空时使用当前活动环境",
      },
      {
        key: "keepPageOpen",
        label: "保留页面",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
    ],
    handler: runTemuLoginSmallFeature,
  },
  "temu-session-collect": {
    key: "temu-session-collect",
    name: "Temu 会话采集",
    platform: "temu",
    category: "session",
    visibility: "internal",
    description:
      "只采集当前浏览器环境里已登录的 Temu 会话，但成功标准按全量采集执行：需要同步拿到账号、店铺、anti-content 与 global/us/eu Cookie。",
    tips: [
      "默认会使用当前活动环境；传 profileId 时会优先作用到指定环境。",
      "这个功能不会自动登录，也不需要输入账号密码。",
      "如需登录，请先单独执行 Temu 登录功能，或者让用户自己手动登录后再采集。",
      "默认会补抓 global/us/eu 三套 cookies，并同步拉取 mallList、mallId、accountId 与 anti-content。",
      "现在成功条件是“全量采集完成”；区域 Cookie、身份信息或 anti-content 缺失都会直接失败，不再按部分成功处理。",
      "若环境浏览器已经打开，默认会以后台页执行，不主动激活浏览器窗口，尽量减少对当前操作的打断。",
      "若环境浏览器尚未启动，则会正常拉起该环境浏览器后再继续采集。",
    ],
    fields: [
      {
        key: "profileId",
        label: "环境编号",
        type: "text",
        required: false,
        placeholder: "可选，留空时使用当前活动环境",
      },
      {
        key: "collectRegionCookies",
        label: "采集区域 Cookie",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
      {
        key: "keepPageOpen",
        label: "保留页面",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
    ],
    handler: runTemuSessionCollectSmallFeature,
  },
  "temu-session-restore": {
    key: "temu-session-restore",
    name: "Temu 会话恢复",
    platform: "temu",
    category: "session",
    visibility: "internal",
    description:
      "默认把已存储的 Temu 会话 Cookie 静默写回当前浏览器环境；按需再做登录态确认。",
    tips: [
      "默认会使用当前活动环境；传 profileId 时会优先作用到指定环境。",
      "这个功能主要用于把数据库里已存储的 Temu Cookie 回灌到当前浏览器环境。",
      "默认不会主动抢焦点打开 Temu 页面；只有显式开启恢复后校验时才会访问卖家首页。",
      "如果写入后仍未识别为登录，通常说明会话已经过期，需要重新采集。",
    ],
    fields: [
      {
        key: "profileId",
        label: "环境编号",
        type: "text",
        required: false,
        placeholder: "可选，留空时使用当前活动环境",
      },
      {
        key: "session",
        label: "会话对象",
        type: "json",
        required: true,
        placeholder: "包含 global/us/eu 的 session 对象",
      },
      {
        key: "keepPageOpen",
        label: "保留页面",
        type: "boolean",
        required: false,
        defaultValue: true,
      },
      {
        key: "validateAfterRestore",
        label: "恢复后校验",
        type: "boolean",
        required: false,
        defaultValue: false,
      },
      {
        key: "activatePage",
        label: "激活页面",
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    ],
    handler: runTemuSessionRestoreSmallFeature,
  },
  "doudian-check-login": {
    key: "doudian-check-login",
    name: "检测是否登录",
    platform: "doudian",
    category: "session",
    visibility: "public",
    description: "打开当前环境的抖店商品发布页，检测该环境是否处于已登录状态。",
    tips: [
      "默认使用当前活动环境；传 profileId 时优先检测指定环境。",
      "该能力是原子化登录检测，后续页面、服务端转发和 AI 调用都可以复用同一个 featureKey。",
      "默认检测完成后自动关闭临时页面。",
    ],
    fields: [
      {
        key: "profileId",
        label: "环境编号",
        type: "text",
        required: false,
        placeholder: "可选，留空时使用当前活动环境",
      },
      {
        key: "keepPageOpen",
        label: "保留页面",
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    ],
    handler: runDoudianCheckLoginSmallFeature,
  },
  "kuaishou-shop-check-login": {
    key: "kuaishou-shop-check-login",
    name: "检测是否登录",
    platform: "kuaishou_shop",
    category: "session",
    visibility: "public",
    description:
      "打开当前环境的快手小店商品发布页，检测该环境是否处于已登录状态。",
    tips: [
      "默认使用当前活动环境；传 profileId 时优先检测指定环境。",
      "该能力是原子化登录检测，后续页面、服务端转发和 AI 调用都可以复用同一个 featureKey。",
      "默认检测完成后自动关闭临时页面。",
    ],
    fields: [
      {
        key: "profileId",
        label: "环境编号",
        type: "text",
        required: false,
        placeholder: "可选，留空时使用当前活动环境",
      },
      {
        key: "keepPageOpen",
        label: "保留页面",
        type: "boolean",
        required: false,
        defaultValue: false,
      },
    ],
    handler: runKuaishouShopCheckLoginSmallFeature,
  },
};

export function listBrowserAutomationSmallFeatures() {
  return Object.values(SMALL_FEATURE_REGISTRY)
    .filter((item) => item.visibility !== "internal")
    .map(({ handler, visibility, ...item }) => ({ ...item }));
}

export function getBrowserAutomationSmallFeature(featureKey) {
  return SMALL_FEATURE_REGISTRY[String(featureKey || "").trim()] || null;
}

export async function runBrowserAutomationSmallFeature(
  featureKey,
  payload = {},
) {
  const feature = getBrowserAutomationSmallFeature(featureKey);
  if (!feature) {
    throw new Error(`不支持的工具: ${featureKey}`);
  }

  return await feature.handler(payload);
}

export default {
  listBrowserAutomationSmallFeatures,
  getBrowserAutomationSmallFeature,
  runBrowserAutomationSmallFeature,
};
