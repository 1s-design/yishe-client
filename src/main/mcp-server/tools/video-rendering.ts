/**
 * MCP Tool: video_render_execute
 * 视频渲染工具 - 复用现有 API 流程
 *
 * Actions:
 *   render        - 直接用模板渲染
 *   status        - 查询渲染任务状态
 *   list          - 列出渲染任务
 *   catalog       - 列出可用模板目录
 *   ai-generate   - AI 模板填充模式（关键词匹配模板）
 *   ai-free-generate - AI 自由编排模式（生成 SceneGraph，使用 AiUniversal 组合）
 */

import type { CallToolResult } from '@modelcontextprotocol/sdk/types';

// ---------------------------------------------------------------------------
// Template keyword matching (for ai-generate)
// ---------------------------------------------------------------------------

const TEMPLATE_KEYWORDS: Record<string, string[]> = {
  'luxe-jewelry-drop': ['珠宝', '饰品', '奢侈品', 'jewelry'],
  'skin-serum-cinematic': ['护肤', '精华', '美容', 'skincare'],
  'flash-sale-fashion-rush': ['限时', '抢购', '促销', 'sale'],
  'gadget-midnight-drop': ['数码', '科技', '电子', 'tech'],
  'brand-manifesto-aether': ['品牌', '宣言', 'brand'],
  'prism-logo-reveal-lux': ['logo', '揭示', 'reveal'],
  'creator-growth-hook': ['创作者', '增长', 'creator'],
  'knowledge-learning-map': ['知识', '学习', 'education'],
  'healing-night-letter': ['治愈', '晚安', 'healing'],
  'quarterly-data-pulse': ['数据', '报告', 'data'],
};

// ---------------------------------------------------------------------------
// Palette presets available for AI free-form
// ---------------------------------------------------------------------------

// const PALETTE_PRESETS = [
//   'noirGold', 'pearlSkin', 'flashCrimson', 'midnightTech',
//   'splitBeauty', 'graphiteAudio', 'creatorBlue', 'financeAmber',
//   'healingMist', 'firePulse', 'storySlate', 'eduCyan',
//   'reportEmerald', 'brandIvory', 'prismChrome', 'keynoteMint',
// ];

// ---------------------------------------------------------------------------
// SceneGraph generation from natural language
// ---------------------------------------------------------------------------

interface SceneGenResult {
  videoConfig: {
    meta: { title: string; orientation: 'portrait' | 'landscape' | 'square'; fps: number };
    palette: { preset: string };
    scenes: Array<{
      duration: number;
      background?: { type: 'gradient' };
      layers: Array<Record<string, any>>;
      transition?: string;
      layout?: string;
    }>;
  };
  width: number;
  height: number;
  fps: number;
  durationInFrames: number;
  extracted: Record<string, any>;
}

function generateSceneGraphFromPrompt(prompt: string, params?: Record<string, any>): SceneGenResult {
  const extracted: Record<string, any> = {};

  // Extract structured info
  const brandMatch = prompt.match(/品牌[名]?[：:]\s*(.+?)(?:[，,。.）)\n])/);
  if (brandMatch) extracted.brandName = brandMatch[1].trim();

  const titleMatch = prompt.match(/标题[：:]\s*(.+?)(?:[，,。.）)\n])/);
  if (titleMatch) extracted.headline = titleMatch[1].trim();

  const sloganMatch = prompt.match(/口号[：:]\s*(.+?)(?:[，,。.）)\n])/);
  if (sloganMatch) extracted.slogan = sloganMatch[1].trim();

  const priceMatch = prompt.match(/(\d+(?:\.\d+)?(?:元|¥|￥|\$))/);
  if (priceMatch) extracted.price = priceMatch[1];

  const discountMatch = prompt.match(/(\d+折)/);
  if (discountMatch) extracted.discount = discountMatch[1];

  const imageUrls: string[] = [];
  const urlRegex = /https?:\/\/[^\s）)]+\.(?:jpg|jpeg|png|gif|webp)/gi;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlRegex.exec(prompt)) !== null) {
    imageUrls.push(urlMatch[0]);
  }
  if (imageUrls.length > 0) extracted.images = imageUrls;

  // Detect orientation (params overrides prompt detection)
  let orientation: 'portrait' | 'landscape' | 'square' = 'portrait';
  if (params?.orientation && ['portrait', 'landscape', 'square'].includes(params.orientation)) {
    orientation = params.orientation;
  } else {
    const isLandscape = /横[屏版]|landscape|16:9|宽/i.test(prompt);
    const isSquare = /方[屏版]|square|1:1/i.test(prompt);
    orientation = isLandscape ? 'landscape' : isSquare ? 'square' : 'portrait';
  }
  const isLandscape = orientation === 'landscape';
  const isSquare = orientation === 'square';

  // Detect palette from content or params
  let palettePreset = params?.palette || 'noirGold';
  if (!params?.palette) {
    if (/奢侈|高端|珠宝|金|奢|luxury|gold/i.test(prompt)) palettePreset = 'noirGold';
    else if (/护肤|美容|skin|beauty|粉|紫/i.test(prompt)) palettePreset = 'splitBeauty';
    else if (/限时|促销|sale|红|crimson/i.test(prompt)) palettePreset = 'flashCrimson';
    else if (/科技|数码|tech|蓝|cyan/i.test(prompt)) palettePreset = 'midnightTech';
    else if (/治愈|晚安|healing|mint/i.test(prompt)) palettePreset = 'healingMist';
    else if (/数据|报告|data|emerald/i.test(prompt)) palettePreset = 'reportEmerald';
    else if (/咖啡|餐|食|amber|暖/i.test(prompt)) palettePreset = 'financeAmber';
    else if (/创作|creator|蓝/i.test(prompt)) palettePreset = 'creatorBlue';
    else if (/教育|学习|edu|青/i.test(prompt)) palettePreset = 'eduCyan';
  }

  // Build scenes from extracted info
  const scenes: SceneGenResult['videoConfig']['scenes'] = [];
  const headline = params?.title || extracted.headline || extracted.brandName || prompt.slice(0, 30);
  const slogan = extracted.slogan || '';
  const hasImages = imageUrls.length > 0;
  const defaultSceneDuration = params?.sceneDuration ? Math.max(1, Number(params.sceneDuration)) : 3;

  // Scene 1: Opening / Brand Intro
  const scene1Layers: Array<Record<string, any>> = [];
  if (extracted.brandName) {
    scene1Layers.push({ type: 'eyebrow', text: extracted.brandName, animation: 'fade-in' });
  }
  scene1Layers.push({ type: 'headline', text: headline, animation: 'zoom-in' });
  if (slogan) {
    scene1Layers.push({ type: 'subtitle', text: slogan, animation: 'fade-up', delayFrames: 12 });
  }
  scenes.push({ duration: defaultSceneDuration, layers: scene1Layers, transition: 'fade' });

  // Scene 2: Product showcase (if images) or feature highlights
  if (hasImages) {
    const scene2Layers: Array<Record<string, any>> = [];
    if (imageUrls.length === 1) {
      scene2Layers.push({
        type: 'media',
        media: { type: 'image', src: imageUrls[0] },
        height: isLandscape ? '420px' : '520px',
        animation: 'zoom-in',
      });
    } else {
      scene2Layers.push({
        type: 'image-grid',
        images: imageUrls.slice(0, 4).map(url => ({ src: url })),
        columns: imageUrls.length <= 2 ? 1 : 2,
        animation: 'fade-up',
      });
    }
    if (extracted.discount || extracted.price) {
      scene2Layers.push({ type: 'divider', animation: 'fade-in' });
      if (extracted.discount) {
        scene2Layers.push({
          type: 'accent-box',
          badge: '限时特惠',
          title: extracted.discount,
          description: extracted.price ? `券后仅需 ${extracted.price}` : undefined,
          accentColor: '#ef4444',
          animation: 'bounce',
        });
      }
    }
    scenes.push({ duration: defaultSceneDuration + 1, layers: scene2Layers, transition: 'slide-left' });
  } else {
    // Feature highlights scene
    const featureLayers: Array<Record<string, any>> = [];
    featureLayers.push({ type: 'headline', text: '核心亮点', animation: 'fade-up' });
    const features = generateFeatureList(prompt);
    featureLayers.push({
      type: 'bullet-list',
      items: features.map((f, i) => ({
        icon: ['✨', '💎', '🚀', '⭐', '🔥'][i % 5],
        title: f,
      })),
      animation: 'fade-up',
    });
    scenes.push({ duration: defaultSceneDuration + 1, layers: featureLayers, transition: 'slide-left' });
  }

  // Scene 3: Price / Social proof
  if (extracted.price || /评价|好评|用户|customers|reviews/i.test(prompt)) {
    const scene3Layers: Array<Record<string, any>> = [];
    if (extracted.price) {
      scene3Layers.push({
        type: 'price',
        price: extracted.price,
        label: extracted.discount ? `原价优惠 ${extracted.discount}` : '限时价格',
        animation: 'bounce',
      });
    }
    if (/(\d+[\+]?\s*(?:人|位|位用户|好评|customers|reviews))/i.test(prompt)) {
      const socialMatch = prompt.match(/(\d+[\+]?\s*(?:人|位|位用户|好评|customers|reviews)[^，,。\n]*)/i);
      if (socialMatch) {
        scene3Layers.push({
          type: 'social-proof',
          value: socialMatch[1].replace(/人|位|好评|customers|reviews/gi, '').trim() + '+',
          label: '用户好评',
          icon: '👥',
          animation: 'fade-up',
        });
      }
    }
    if (scene3Layers.length > 0) {
      scenes.push({ duration: defaultSceneDuration + 0.5, layers: scene3Layers, transition: 'zoom' });
    }
  }

  // Scene 4: CTA / Outro
  const ctaLayers: Array<Record<string, any>> = [];
  const ctaText = /立即|马上|点击|购买|下单|体验|咨询/i.test(prompt)
    ? prompt.match(/(立即[^，,。\n]*|马上[^，,。\n]*|点击[^，,。\n]*|购买[^，,。\n]*|下单[^，,。\n]*|体验[^，,。\n]*|咨询[^，,。\n]*)/)?.[1] || '立即体验'
    : '立即体验';
  ctaLayers.push({ type: 'cta', text: ctaText, animation: 'zoom-in' });
  if (extracted.brandName) {
    ctaLayers.push({
      type: 'text',
      text: extracted.brandName,
      animation: 'fade-in',
    });
  }
  scenes.push({ duration: defaultSceneDuration, layers: ctaLayers, transition: 'fade' });

  // If target duration specified, scale scene durations to match exactly
  const targetDuration = params?.duration ? Math.max(2, Number(params.duration)) : null;
  if (targetDuration && scenes.length > 0) {
    const currentSum = scenes.reduce((sum, s) => sum + s.duration, 0);
    const ratio = targetDuration / currentSum;
    let accumulated = 0;
    for (let i = 0; i < scenes.length - 1; i++) {
      const d = Math.max(1, Math.round(scenes[i].duration * ratio * 10) / 10);
      scenes[i].duration = d;
      accumulated += d;
    }
    scenes[scenes.length - 1].duration = Math.max(1, Math.round((targetDuration - accumulated) * 10) / 10);
  }

  // Calculate total duration
  const fps = params?.fps ? Number(params.fps) : 30;
  const totalSeconds = scenes.reduce((sum, s) => sum + s.duration, 0);
  const durationInFrames = Math.round(totalSeconds * fps);

  const width = params?.width || (isLandscape ? 1920 : isSquare ? 1080 : 1080);
  const height = params?.height || (isLandscape ? 1080 : isSquare ? 1080 : 1920);

  // Background audio
  const bgmUrl = params?.bgmUrl || params?.audioUrl || prompt.match(/(https?:\/\/[^\s）)]+\.(?:mp3|wav|m4a|aac|ogg))/i)?.[1];
  const audioConfig = bgmUrl ? {
    bgmUrl,
    bgmVolume: params?.bgmVolume !== undefined ? Number(params.bgmVolume) : 0.8,
    loop: true,
  } : undefined;

  return {
    videoConfig: {
      meta: { title: params?.title || `AI生成 · ${headline}`, orientation, fps },
      palette: { preset: palettePreset },
      scenes,
      ...(audioConfig ? { audio: audioConfig } : {}),
    },
    width,
    height,
    fps,
    durationInFrames,
    extracted,
  };
}

function generateFeatureList(prompt: string): string[] {
  const features: string[] = [];
  // Extract bullet points from prompt
  const bulletMatches = prompt.match(/[•·\-\*]\s*(.+)/g);
  if (bulletMatches) {
    return bulletMatches.map(m => m.replace(/^[•·\-\*]\s*/, '')).slice(0, 5);
  }
  // Generate from keywords
  if (/品质|质量|quality/i.test(prompt)) features.push('精选品质，严格把控');
  if (/价格|实惠|便宜|price/i.test(prompt)) features.push('超值价格，限时优惠');
  if (/服务|售后|service/i.test(prompt)) features.push('贴心服务，售后保障');
  if (/速度|快递|物流|speed/i.test(prompt)) features.push('极速发货，闪电到货');
  if (/设计|颜值|design/i.test(prompt)) features.push('精美设计，颜值在线');
  if (features.length === 0) {
    features.push('精心打造，品质保证', '限时优惠，不容错过');
  }
  return features;
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

export async function executeVideoRender(args: {
  templateId?: string;
  inputProps?: Record<string, any>;
  action?: 'render' | 'status' | 'list' | 'catalog' | 'ai-generate' | 'ai-free-generate';
  jobId?: string;
  prompt?: string;
  params?: Record<string, any>;
  width?: number;
  height?: number;
}): Promise<CallToolResult> {
  try {
    const { templateId, inputProps, jobId, prompt, params = {}, width, height } = args;
    // 默认如果传了 prompt 则优先进行 AI 生成，否则 render
    const action = args.action || (prompt ? 'ai-free-generate' : 'render');
    const base =
      process.env.VITE_BASE_URL ||
      (process.env.NODE_ENV === "development"
        ? "http://localhost:1520"
        : "https://api.1s.design");
    const serverUrl = base.endsWith('/api') ? base : `${base}/api`;

    // 列出模板目录
    if (action === 'catalog') {
      const res = await fetchJson(`${serverUrl}/remotion-video-record/templates`);
      return jsonResult({ success: true, templates: res.data || [], total: res.total || 0 });
    }

    // 列出渲染任务
    if (action === 'list') {
      const res = await fetchJson(`${serverUrl}/remotion-video-record/page?currentPage=1&pageSize=20`);
      return jsonResult({ success: true, records: res.data?.items || [] });
    }

    // 查询任务状态
    if (action === 'status' && jobId) {
      const res = await fetchJson(`${serverUrl}/remotion-video-record/${jobId}`);
      return jsonResult({ success: true, record: res.data || res });
    }

    // AI 生成（自由编排模式 或 模板匹配模式）
    if (action === 'ai-free-generate' || action === 'ai-generate') {
      if (!prompt) throw new Error(`${action} 需要 prompt 参数`);

      const mergedParams: Record<string, any> = {
        ...(params || {}),
      };
      if (width && !mergedParams.width) mergedParams.width = width;
      if (height && !mergedParams.height) mergedParams.height = height;

      // 1. 优先通过服务端的 /remotion-video-record/ai-generate 进行完整的 AI 解析并下发异步渲染任务
      try {
        const res = await fetchJson(`${serverUrl}/remotion-video-record/ai-generate`, {
          method: 'POST',
          body: JSON.stringify({
            action,
            prompt,
            params: Object.keys(mergedParams).length > 0 ? mergedParams : undefined,
          }),
        });

        if (res?.data?.id || res?.success || res?.code === 200) {
          return jsonResult({
            success: true,
            recordId: res.data?.id,
            status: res.data?.status || 'processing',
            action,
            prompt,
            params: mergedParams,
            message: res.message || 'AI 视频生成任务已提交，将在后台异步渲染',
            data: res.data,
          });
        }
      } catch (remoteErr: any) {
        console.warn('[VideoRender] 远程 ai-generate 接口调用失败，降级使用本地编排规则:', remoteErr?.message);
      }

      // 2. 降级方案：本地规则解析 + 调用 /remotion-video-record/generate 提交任务
      if (action === 'ai-generate') {
        const config = parsePromptToConfig(prompt, mergedParams);
        const res = await fetchJson(`${serverUrl}/remotion-video-record/generate`, {
          method: 'POST',
          body: JSON.stringify({
            templateId: config.templateId,
            title: mergedParams.title || `AI生成 · ${config.templateId}`,
            inputProps: {
              ...config.inputProps,
              ...(mergedParams.inputProps || {}),
            },
          }),
        });

        return jsonResult({
          success: true,
          recordId: res.data?.id,
          templateUsed: config.templateId,
          mode: 'template-fill-fallback',
          params: mergedParams,
          extracted: config.extracted,
        });
      } else {
        const sceneGraph = generateSceneGraphFromPrompt(prompt, mergedParams);
        if (width) sceneGraph.width = width;
        if (height) sceneGraph.height = height;

        const res = await fetchJson(`${serverUrl}/remotion-video-record/generate`, {
          method: 'POST',
          body: JSON.stringify({
            templateId: 'ai-universal',
            title: sceneGraph.videoConfig.meta.title,
            inputProps: {
              videoConfig: sceneGraph.videoConfig,
              width: sceneGraph.width,
              height: sceneGraph.height,
              fps: sceneGraph.fps,
              durationInFrames: sceneGraph.durationInFrames,
            },
          }),
        });

        return jsonResult({
          success: true,
          recordId: res.data?.id,
          templateUsed: 'ai-universal',
          mode: 'ai-free-scenegraph-fallback',
          sceneCount: sceneGraph.videoConfig.scenes.length,
          totalDuration: sceneGraph.durationInFrames / sceneGraph.fps,
          palette: (sceneGraph.videoConfig.palette as any)?.preset || 'custom',
          orientation: sceneGraph.videoConfig.meta.orientation,
          params: mergedParams,
          extracted: sceneGraph.extracted,
          videoConfig: sceneGraph.videoConfig,
        });
      }
    }

    // 直接指定模板渲染
    if (!templateId) throw new Error('缺少 templateId 或 prompt');

    const res = await fetchJson(`${serverUrl}/remotion-video-record/generate`, {
      method: 'POST',
      body: JSON.stringify({
        templateId,
        inputProps: {
          ...(inputProps || {}),
          ...(params || {}),
        },
      }),
    });

    return jsonResult({ success: true, recordId: res.data?.id, templateId });
  } catch (error: any) {
    return jsonResult({ success: false, error: error?.message || String(error) }, true);
  }
}

function parsePromptToConfig(prompt: string, params?: Record<string, any>) {
  const extracted: Record<string, any> = {};

  const brandMatch = prompt.match(/品牌[名]?[：:]\s*(.+?)(?:[，,。.）)])/);
  if (brandMatch) extracted.brandName = brandMatch[1].trim();

  const titleMatch = prompt.match(/标题[：:]\s*(.+?)(?:[，,。.）)])/);
  if (titleMatch) extracted.headline = titleMatch[1].trim();

  const sloganMatch = prompt.match(/口号[：:]\s*(.+?)(?:[，,。.）)])/);
  if (sloganMatch) extracted.slogan = sloganMatch[1].trim();

  const priceMatch = prompt.match(/(\d+(?:\.\d+)?(?:元|¥|￥|\$))/);
  if (priceMatch) extracted.price = priceMatch[1];

  let selectedTemplate = params?.templateId || 'prism-logo-reveal-lux';
  if (!params?.templateId) {
    for (const [templateId, keywords] of Object.entries(TEMPLATE_KEYWORDS)) {
      if (keywords.some(kw => prompt.includes(kw))) {
        selectedTemplate = templateId;
        break;
      }
    }
  }

  const inputProps: Record<string, any> = {};
  if (extracted.brandName) inputProps.brandName = extracted.brandName;
  if (extracted.headline) inputProps.headline = extracted.headline;
  if (extracted.slogan) inputProps.slogan = extracted.slogan;
  if (extracted.price) inputProps.price = extracted.price;
  if (params?.inputProps) Object.assign(inputProps, params.inputProps);

  return { templateId: selectedTemplate, inputProps, extracted };
}

async function fetchJson(url: string, options?: RequestInit) {
  let authHeaders: Record<string, string> = {};
  try {
    const { getTokenValue } = await import('../../server');
    const token = getTokenValue?.();
    if (token) {
      authHeaders['Authorization'] = `Bearer ${token}`;
    }
  } catch {}

  const res = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...options?.headers,
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${res.statusText}`);
  return res.json();
}

function jsonResult(data: any, isError = false) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data) }],
    isError,
  };
}
