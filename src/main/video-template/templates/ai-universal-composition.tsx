import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
} from "remotion";
import { z } from "zod";

import type {
  AiVideoProps,
  PaletteConfig,
  SceneConfig,
  SceneLayer,
} from "./ai-types";
import {
  GradientStage,
  MediaSurface,
  MetricGrid,
  FeatureStack,
  ProgressBarRow,
  SectionEyebrow,
  TagPill,
  alpha,
  mix,
  useEntrance,
  sceneWindow,
} from "./shared";
import type { Palette, MetricItem, FeatureItem, MediaSource } from "./shared";

// ---------------------------------------------------------------------------
// Palette presets
// ---------------------------------------------------------------------------

const PALETTE_PRESETS: Record<string, Palette> = {
  noirGold: {
    background: "#09070c",
    backgroundAlt: "#1b1118",
    surface: "#23171f",
    text: "#f8f4ee",
    mutedText: "#d2c5b5",
    accent: "#f0c97b",
    accentAlt: "#d88f5c",
    glow: "#ffcf8b",
  },
  pearlSkin: {
    background: "#0e1220",
    backgroundAlt: "#1a2237",
    surface: "#27304c",
    text: "#f5f7fb",
    mutedText: "#c8d0e2",
    accent: "#cbe2ff",
    accentAlt: "#f6d7ff",
    glow: "#9fc2ff",
  },
  flashCrimson: {
    background: "#1c0508",
    backgroundAlt: "#3a0d13",
    surface: "#5c1320",
    text: "#fff4ee",
    mutedText: "#f7c5bc",
    accent: "#ff6b4a",
    accentAlt: "#ffc14a",
    glow: "#ff855b",
  },
  midnightTech: {
    background: "#061018",
    backgroundAlt: "#102335",
    surface: "#17314a",
    text: "#edf5ff",
    mutedText: "#a7c7de",
    accent: "#51d0ff",
    accentAlt: "#8cf2d7",
    glow: "#46c4ff",
  },
  splitBeauty: {
    background: "#110914",
    backgroundAlt: "#261128",
    surface: "#36183b",
    text: "#fff7fb",
    mutedText: "#e7cad8",
    accent: "#ff96c4",
    accentAlt: "#ffc8dd",
    glow: "#ffacd8",
  },
  graphiteAudio: {
    background: "#0a0f17",
    backgroundAlt: "#18222f",
    surface: "#263343",
    text: "#f1f6fb",
    mutedText: "#a4b5c7",
    accent: "#63b8ff",
    accentAlt: "#8ef0d1",
    glow: "#79c4ff",
  },
  creatorBlue: {
    background: "#07101d",
    backgroundAlt: "#0f2039",
    surface: "#16335b",
    text: "#f4f8ff",
    mutedText: "#bdd0ea",
    accent: "#5ec0ff",
    accentAlt: "#8ce7ff",
    glow: "#6db8ff",
  },
  financeAmber: {
    background: "#170f05",
    backgroundAlt: "#2b1b0b",
    surface: "#3d2815",
    text: "#fff8ef",
    mutedText: "#ebd3ab",
    accent: "#ffb84d",
    accentAlt: "#ffe07a",
    glow: "#ffcb6e",
  },
  healingMist: {
    background: "#111522",
    backgroundAlt: "#1d2536",
    surface: "#28334b",
    text: "#f3f6fb",
    mutedText: "#c6d1e0",
    accent: "#8eb6ff",
    accentAlt: "#d5c8ff",
    glow: "#a7b9ff",
  },
  firePulse: {
    background: "#180707",
    backgroundAlt: "#311010",
    surface: "#4e1714",
    text: "#fff5ef",
    mutedText: "#f2c1b3",
    accent: "#ff7e52",
    accentAlt: "#ffb06e",
    glow: "#ff8e63",
  },
  storySlate: {
    background: "#090e14",
    backgroundAlt: "#161f2b",
    surface: "#243244",
    text: "#f7f6f2",
    mutedText: "#c9cec9",
    accent: "#a8d2ff",
    accentAlt: "#f2d3a9",
    glow: "#bfd3ff",
  },
  eduCyan: {
    background: "#08131a",
    backgroundAlt: "#112733",
    surface: "#183746",
    text: "#effbff",
    mutedText: "#b0dce5",
    accent: "#53d7ff",
    accentAlt: "#88ffdf",
    glow: "#62d8ff",
  },
  reportEmerald: {
    background: "#081210",
    backgroundAlt: "#11261f",
    surface: "#17362d",
    text: "#effbf4",
    mutedText: "#b3ddc9",
    accent: "#42d39e",
    accentAlt: "#9cffcd",
    glow: "#6ce0b0",
  },
  brandIvory: {
    background: "#0f1014",
    backgroundAlt: "#191c24",
    surface: "#252936",
    text: "#fbfaf7",
    mutedText: "#d8d5ca",
    accent: "#dcb773",
    accentAlt: "#f1d7b0",
    glow: "#efd19d",
  },
  prismChrome: {
    background: "#090d16",
    backgroundAlt: "#111a2b",
    surface: "#17253d",
    text: "#f4f8ff",
    mutedText: "#b5c3dc",
    accent: "#6ed1ff",
    accentAlt: "#d8b8ff",
    glow: "#8cc8ff",
  },
  keynoteMint: {
    background: "#071612",
    backgroundAlt: "#10261e",
    surface: "#17392d",
    text: "#effcf7",
    mutedText: "#b9dfd0",
    accent: "#52ddb3",
    accentAlt: "#8effc3",
    glow: "#73eac0",
  },
};

const FALLBACK_PALETTE: Palette = PALETTE_PRESETS.noirGold;

function resolvePalette(config?: PaletteConfig): Palette {
  if (!config) return FALLBACK_PALETTE;
  if ("preset" in config) {
    const base = PALETTE_PRESETS[config.preset] ?? FALLBACK_PALETTE;
    return config.custom ? { ...base, ...config.custom } : base;
  }
  return config.custom ?? FALLBACK_PALETTE;
}

// ---------------------------------------------------------------------------
// Zod schema
// ---------------------------------------------------------------------------

const MediaSourceSchema = z.object({
  type: z.enum(["image", "video"]),
  src: z.string(),
  poster: z.string().optional(),
  alt: z.string().optional(),
});

const MetricItemSchema: z.ZodType<MetricItem> = z.object({
  label: z.string(),
  value: z.string(),
  detail: z.string().optional(),
});

const FeatureItemSchema: z.ZodType<FeatureItem> = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  text: z.string(),
});

const LayerSchema: z.ZodType<SceneLayer> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("eyebrow"),
    text: z.string(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("headline"),
    text: z.string(),
    fontSize: z.number().optional(),
    maxLines: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("subtitle"),
    text: z.string(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
    maxWidth: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("badge-row"),
    badges: z.array(z.string()),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("price"),
    price: z.string(),
    originalPrice: z.string().optional(),
    label: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("metrics"),
    items: z.array(MetricItemSchema),
    columns: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("features"),
    items: z.array(FeatureItemSchema),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("media"),
    media: MediaSourceSchema,
    width: z.string().optional(),
    height: z.string().optional(),
    borderRadius: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("cta"),
    text: z.string(),
    subtext: z.string().optional(),
    buttonStyle: z.enum(["pill", "square", "outline"]).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string(),
    author: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("divider"),
    color: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("progress-bar"),
    items: z.array(
      z.object({
        label: z.string(),
        value: z.number(),
        color: z.string().optional(),
      }),
    ),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("bullet-list"),
    items: z.array(z.string()),
    listStyle: z.enum(["bullet", "number", "check"]).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  // === NEW AI-POWERED LAYER TYPES ===
  z.object({
    type: z.literal("countdown"),
    value: z.number(),
    label: z.string().optional(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    animDuration: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("image-grid"),
    images: z.array(z.object({ src: z.string(), alt: z.string().optional() })),
    columns: z.number().optional(),
    gap: z.number().optional(),
    borderRadius: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("testimonial"),
    text: z.string(),
    author: z.string().optional(),
    stars: z.number().min(1).max(5).optional(),
    avatar: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("logo-reveal"),
    src: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    name: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("comparison"),
    before: z.object({ src: z.string(), label: z.string().optional() }),
    after: z.object({ src: z.string(), label: z.string().optional() }),
    dividerPosition: z.number().min(0).max(100).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("chapter-marker"),
    number: z.union([z.number(), z.string()]),
    title: z.string(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("rating"),
    value: z.number().min(0).max(5),
    max: z.number().optional(),
    count: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("social-proof"),
    value: z.string(),
    label: z.string(),
    icon: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("split-media"),
    media: z.object({ type: z.enum(["image", "video"]), src: z.string() }),
    side: z.enum(["left", "right"]).optional(),
    text: z.string().optional(),
    headline: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("accent-box"),
    text: z.string(),
    boxStyle: z.enum(["filled", "bordered", "glow"]).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
]) as unknown as z.ZodType<SceneLayer>;

const SceneSchema: z.ZodType<SceneConfig> = z.object({
  duration: z.number().min(0.1),
  background: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("gradient") }),
      z.object({ type: z.literal("solid"), color: z.string().optional() }),
      z.object({
        type: z.literal("media"),
        media: MediaSourceSchema,
        opacity: z.number().min(0).max(1).optional(),
      }),
    ])
    .optional(),
  layers: z.array(LayerSchema),
  transition: z.enum(["cut", "fade", "slide-left", "slide-right", "zoom"]).optional(),
  layout: z.enum(["centered", "top", "bottom", "split-left", "split-right", "fullscreen", "grid"]).optional(),
  paddingY: z.number().optional(),
  paddingX: z.number().optional(),
  gap: z.number().optional(),
});

const PaletteConfigSchema: z.ZodType<PaletteConfig> = z.union([
  z.object({
    preset: z.string(),
    custom: z.record(z.string(), z.string().optional()).optional(),
  }),
  z.object({
    custom: z.object({
      background: z.string(),
      backgroundAlt: z.string(),
      surface: z.string(),
      text: z.string(),
      mutedText: z.string(),
      accent: z.string(),
      accentAlt: z.string(),
      glow: z.string(),
    }),
  }),
]);

export const AiVideoSchema = z.object({
  videoConfig: z.object({
    meta: z.object({
      title: z.string(),
      orientation: z.enum(["portrait", "landscape", "square"]).optional(),
      fps: z.number().optional(),
    }),
    palette: PaletteConfigSchema,
    scenes: z.array(SceneSchema).min(1),
  }),
});

// ---------------------------------------------------------------------------
// Animation helpers
// ---------------------------------------------------------------------------

import type { AnimationStyle, SceneLayout } from "./ai-types";

function computeAnimation(
  style: AnimationStyle | undefined,
  entrance: number,
  _frame: number,
): React.CSSProperties {
  const progress = clamp01(entrance);
  switch (style) {
    case "fade-in":
      return { opacity: progress };
    case "slide-left":
      return { opacity: progress, transform: `translateX(${mix(-60, 0, progress)}px)` };
    case "slide-right":
      return { opacity: progress, transform: `translateX(${mix(60, 0, progress)}px)` };
    case "zoom-in":
      return { opacity: progress, transform: `scale(${mix(0.6, 1, progress)})` };
    case "zoom-out":
      return { opacity: progress, transform: `scale(${mix(1.4, 1, progress)})` };
    case "rotate-in":
      return { opacity: progress, transform: `rotate(${mix(-15, 0, progress)}deg) scale(${mix(0.8, 1, progress)})` };
    case "bounce":
      return { opacity: progress, transform: `translateY(${mix(40, 0, progress)}px) scale(${1 + Math.sin(progress * Math.PI) * 0.05})` };
    case "typewriter":
      return { opacity: progress };
    case "fade-up":
    default:
      return { opacity: progress, transform: `translateY(${mix(28, 0, progress)}px)` };
  }
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

// ---------------------------------------------------------------------------
// Layer renderers
// ---------------------------------------------------------------------------

const textBase: React.CSSProperties = {
  fontFamily: "'Segoe UI', 'Trebuchet MS', system-ui, sans-serif",
  lineHeight: 1.35,
  textAlign: "center",
};

const LayerRenderer: React.FC<{
  layer: SceneLayer;
  palette: Palette;
  index: number;
}> = ({ layer, palette, index }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const delay = layer.delayFrames ?? index * 6;
  const entrance = useEntrance(delay);
  const anim = computeAnimation(layer.animation, entrance, frame);
  const baseOpacity = layer.opacity ?? 1;

  const wrapper: React.CSSProperties = {
    opacity: ((anim.opacity as number) ?? 1) * baseOpacity,
    transform: anim.transform,
  };

  // Typewriter effect for text layers
  const typewriterText = (text: string, maxChars?: number) => {
    if (layer.animation !== "typewriter") return text;
    const charsToShow = Math.floor(
      interpolate(frame - delay, [0, text.length * 2], [0, text.length], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      }),
    );
    return text.slice(0, maxChars ? Math.min(charsToShow, maxChars) : charsToShow);
  };

  switch (layer.type) {
    case "eyebrow":
      return (
        <div style={wrapper}>
          <SectionEyebrow text={typewriterText(layer.text)} palette={palette} />
        </div>
      );

    case "headline":
      return (
        <div style={{ ...wrapper, ...textBase }}>
          <div
            style={{
              fontSize: layer.fontSize ?? 58,
              fontWeight: 800,
              color: palette.text,
              letterSpacing: "-0.02em",
              whiteSpace: "pre-line",
              overflow: "hidden",
            }}
          >
            {typewriterText(layer.text)}
          </div>
        </div>
      );

    case "subtitle":
      return (
        <div style={{ ...wrapper, ...textBase }}>
          <div
            style={{
              fontSize: 32,
              fontWeight: 500,
              color: palette.mutedText,
              whiteSpace: "pre-line",
            }}
          >
            {typewriterText(layer.text)}
          </div>
        </div>
      );

    case "text":
      return (
        <div style={{ ...wrapper, ...textBase }}>
          <div
            style={{
              fontSize: 26,
              color: palette.mutedText,
              maxWidth: layer.maxWidth ?? 720,
              margin: "0 auto",
              lineHeight: 1.6,
              whiteSpace: "pre-line",
            }}
          >
            {typewriterText(layer.text)}
          </div>
        </div>
      );

    case "badge-row":
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            flexWrap: "wrap",
            justifyContent: "center",
            gap: 12,
          }}
        >
          {layer.badges.map((b, i) => (
            <TagPill key={i} text={b} palette={palette} light />
          ))}
        </div>
      );

    case "price":
      return (
        <div
          style={{
            ...wrapper,
            ...textBase,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          {layer.label && (
            <div
              style={{
                fontSize: 20,
                color: palette.mutedText,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
              }}
            >
              {layer.label}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "baseline", gap: 16 }}>
            <span
              style={{ fontSize: 56, fontWeight: 800, color: palette.accent }}
            >
              {layer.price}
            </span>
            {layer.originalPrice && (
              <span
                style={{
                  fontSize: 28,
                  color: alpha(palette.mutedText, 0.5),
                  textDecoration: "line-through",
                }}
              >
                {layer.originalPrice}
              </span>
            )}
          </div>
        </div>
      );

    case "metrics":
      return (
        <div style={wrapper}>
          <MetricGrid
            items={layer.items}
            palette={palette}
            columns={layer.columns ?? 2}
          />
        </div>
      );

    case "features":
      return (
        <div style={wrapper}>
          <FeatureStack items={layer.items} palette={palette} />
        </div>
      );

    case "media":
      return (
        <div style={wrapper}>
          <MediaSurface
            media={layer.media as MediaSource}
            palette={palette}
            style={{
              width: layer.width ?? "100%",
              height: layer.height ?? "480px",
              borderRadius: layer.borderRadius ?? 0,
            }}
          />
        </div>
      );

    case "cta": {
      const pulse = 1 + Math.sin(frame / 18) * 0.02;
      const btnRadius =
        layer.buttonStyle === "square"
          ? 8
          : layer.buttonStyle === "outline"
            ? 999
            : 999;
      const btnBg =
        layer.buttonStyle === "outline"
          ? "transparent"
          : `linear-gradient(135deg, ${palette.accent}, ${palette.accentAlt})`;
      const btnBorder =
        layer.buttonStyle === "outline"
          ? `2px solid ${palette.accent}`
          : "none";
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div
            style={{
              padding: "18px 52px",
              borderRadius: btnRadius,
              background: btnBg,
              border: btnBorder,
              color: palette.background,
              fontSize: 28,
              fontWeight: 800,
              letterSpacing: "0.04em",
              transform: `scale(${pulse})`,
              boxShadow: `0 18px 48px ${alpha(palette.accent, 0.4)}`,
            }}
          >
            {layer.text}
          </div>
          {layer.subtext && (
            <div style={{ fontSize: 20, color: palette.mutedText }}>
              {layer.subtext}
            </div>
          )}
        </div>
      );
    }

    case "quote":
      return (
        <div style={{ ...wrapper, ...textBase }}>
          <div
            style={{
              fontSize: 42,
              fontStyle: "italic",
              color: palette.text,
              maxWidth: 700,
              margin: "0 auto",
              lineHeight: 1.5,
            }}
          >
            <span
              style={{
                fontSize: 64,
                color: alpha(palette.accent, 0.6),
                verticalAlign: "top",
              }}
            >
              "
            </span>
            {typewriterText(layer.text)}
            <span
              style={{
                fontSize: 64,
                color: alpha(palette.accent, 0.6),
                verticalAlign: "bottom",
              }}
            >
              "
            </span>
          </div>
          {layer.author && (
            <div
              style={{ marginTop: 16, fontSize: 22, color: palette.mutedText }}
            >
              — {layer.author}
            </div>
          )}
        </div>
      );

    case "divider":
      return (
        <div style={{ ...wrapper, display: "flex", justifyContent: "center" }}>
          <div
            style={{
              width: "60%",
              height: 1,
              background: `linear-gradient(90deg, transparent, ${alpha(layer.color || palette.accent, 0.5)}, transparent)`,
            }}
          />
        </div>
      );

    case "progress-bar":
      return (
        <div style={wrapper}>
          <ProgressBarRow items={layer.items} palette={palette} />
        </div>
      );

    case "bullet-list": {
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            flexDirection: "column",
            gap: 14,
            alignItems: "flex-start",
            padding: "0 40px",
          }}
        >
          {layer.items.map((item, i) => (
            <div
              key={i}
              style={{ display: "flex", alignItems: "flex-start", gap: 14 }}
            >
              {layer.listStyle === "number" ? (
                <span
                  style={{
                    fontSize: 22,
                    fontWeight: 700,
                    color: palette.accent,
                    minWidth: 30,
                    textAlign: "right",
                  }}
                >
                  {i + 1}.
                </span>
              ) : layer.listStyle === "check" ? (
                <span
                  style={{
                    fontSize: 22,
                    color: palette.accent,
                    marginTop: 2,
                    flexShrink: 0,
                  }}
                >
                  ✓
                </span>
              ) : (
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: palette.accent,
                    marginTop: 10,
                    flexShrink: 0,
                  }}
                />
              )}
              <span
                style={{ fontSize: 26, color: palette.text, lineHeight: 1.5 }}
              >
                {item}
              </span>
            </div>
          ))}
        </div>
      );
    }

    // === NEW AI-POWERED LAYER TYPES ===

    case "countdown": {
      const target = layer.value;
      const dur = (layer.animDuration ?? 1.5) * fps;
      const countProgress = interpolate(frame - delay, [0, dur], [0, 1], {
        extrapolateLeft: "clamp",
        extrapolateRight: "clamp",
      });
      const current = Math.round(countProgress * target);
      return (
        <div
          style={{
            ...wrapper,
            ...textBase,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "baseline" }}>
            {layer.prefix && (
              <span style={{ fontSize: 40, color: palette.mutedText }}>
                {layer.prefix}
              </span>
            )}
            <span
              style={{
                fontSize: 96,
                fontWeight: 900,
                color: palette.accent,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {current}
            </span>
            {layer.suffix && (
              <span style={{ fontSize: 40, color: palette.mutedText }}>
                {layer.suffix}
              </span>
            )}
          </div>
          {layer.label && (
            <div style={{ fontSize: 24, color: palette.mutedText }}>
              {layer.label}
            </div>
          )}
        </div>
      );
    }

    case "image-grid": {
      const cols = layer.columns ?? 2;
      const gap = layer.gap ?? 8;
      const radius = layer.borderRadius ?? 12;
      return (
        <div
          style={{
            ...wrapper,
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap,
            width: "100%",
            maxWidth: 800,
          }}
        >
          {layer.images.map((img, i) => (
            <Img
              key={i}
              src={img.src}
              style={{
                width: "100%",
                aspectRatio: "1",
                objectFit: "cover",
                borderRadius: radius,
              }}
            />
          ))}
        </div>
      );
    }

    case "testimonial":
      return (
        <div
          style={{
            ...wrapper,
            ...textBase,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 16,
            maxWidth: 680,
          }}
        >
          {layer.stars != null && (
            <div style={{ fontSize: 32, letterSpacing: 4 }}>
              {Array.from({ length: 5 }).map((_, i) => (
                <span
                  key={i}
                  style={{ color: i < layer.stars! ? "#fbbf24" : alpha(palette.mutedText, 0.3) }}
                >
                  ★
                </span>
              ))}
            </div>
          )}
          <div
            style={{
              fontSize: 28,
              fontStyle: "italic",
              color: palette.text,
              lineHeight: 1.6,
            }}
          >
            "{typewriterText(layer.text)}"
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            {layer.avatar && (
              <Img
                src={layer.avatar}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: "50%",
                  objectFit: "cover",
                }}
              />
            )}
            {layer.author && (
              <div style={{ fontSize: 22, color: palette.mutedText }}>
                — {layer.author}
              </div>
            )}
          </div>
        </div>
      );

    case "logo-reveal": {
      const logoScale = mix(0.6, 1, entrance);
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 20,
          }}
        >
          <Img
            src={layer.src}
            style={{
              width: layer.width ?? 200,
              height: layer.height ?? 200,
              objectFit: "contain",
              transform: `scale(${logoScale})`,
            }}
          />
          {layer.name && (
            <div
              style={{
                fontSize: 36,
                fontWeight: 700,
                color: palette.text,
                letterSpacing: "0.08em",
              }}
            >
              {layer.name}
            </div>
          )}
        </div>
      );
    }

    case "comparison":
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            width: "100%",
            maxWidth: 900,
            gap: 4,
            borderRadius: 16,
            overflow: "hidden",
          }}
        >
          <div style={{ flex: 1, position: "relative" }}>
            <Img
              src={layer.before.src}
              style={{ width: "100%", height: 300, objectFit: "cover" }}
            />
            {layer.before.label && (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: 12,
                  padding: "6px 14px",
                  borderRadius: 8,
                  background: alpha(palette.background, 0.8),
                  color: palette.text,
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {layer.before.label}
              </div>
            )}
          </div>
          <div style={{ flex: 1, position: "relative" }}>
            <Img
              src={layer.after.src}
              style={{ width: "100%", height: 300, objectFit: "cover" }}
            />
            {layer.after.label && (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: 12,
                  padding: "6px 14px",
                  borderRadius: 8,
                  background: alpha(palette.accent, 0.9),
                  color: palette.background,
                  fontSize: 18,
                  fontWeight: 600,
                }}
              >
                {layer.after.label}
              </div>
            )}
          </div>
        </div>
      );

    case "chapter-marker":
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            alignItems: "center",
            gap: 20,
          }}
        >
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentAlt})`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 28,
              fontWeight: 800,
              color: palette.background,
            }}
          >
            {layer.number}
          </div>
          <div
            style={{
              fontSize: 32,
              fontWeight: 700,
              color: palette.text,
            }}
          >
            {layer.title}
          </div>
        </div>
      );

    case "rating": {
      const max = layer.max ?? 5;
      const filled = Math.round(layer.value);
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 8,
          }}
        >
          <div style={{ fontSize: 48, letterSpacing: 6 }}>
            {Array.from({ length: max }).map((_, i) => (
              <span
                key={i}
                style={{ color: i < filled ? "#fbbf24" : alpha(palette.mutedText, 0.3) }}
              >
                ★
              </span>
            ))}
          </div>
          {layer.count && (
            <div style={{ fontSize: 20, color: palette.mutedText }}>
              {layer.count}
            </div>
          )}
        </div>
      );
    }

    case "social-proof":
      return (
        <div
          style={{
            ...wrapper,
            ...textBase,
            display: "flex",
            alignItems: "center",
            gap: 16,
          }}
        >
          {layer.icon && (
            <span style={{ fontSize: 40 }}>{layer.icon}</span>
          )}
          <div>
            <div
              style={{
                fontSize: 48,
                fontWeight: 900,
                color: palette.accent,
              }}
            >
              {layer.value}
            </div>
            <div style={{ fontSize: 22, color: palette.mutedText }}>
              {layer.label}
            </div>
          </div>
        </div>
      );

    case "split-media":
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            width: "100%",
            maxWidth: 900,
            gap: 24,
            alignItems: "center",
            flexDirection: layer.side === "right" ? "row-reverse" : "row",
          }}
        >
          <div style={{ flex: 1 }}>
            {layer.media.type === "video" ? (
              <OffthreadVideo
                src={layer.media.src}
                style={{ width: "100%", height: 300, objectFit: "cover", borderRadius: 16 }}
              />
            ) : (
              <Img
                src={layer.media.src}
                style={{ width: "100%", height: 300, objectFit: "cover", borderRadius: 16 }}
              />
            )}
          </div>
          <div style={{ flex: 1, ...textBase }}>
            {layer.headline && (
              <div
                style={{
                  fontSize: 36,
                  fontWeight: 800,
                  color: palette.text,
                  marginBottom: 12,
                }}
              >
                {layer.headline}
              </div>
            )}
            {layer.text && (
              <div
                style={{
                  fontSize: 22,
                  color: palette.mutedText,
                  lineHeight: 1.6,
                }}
              >
                {layer.text}
              </div>
            )}
          </div>
        </div>
      );

    case "accent-box": {
      const boxBg =
        layer.boxStyle === "glow"
          ? `linear-gradient(135deg, ${alpha(palette.accent, 0.15)}, ${alpha(palette.accentAlt, 0.1)})`
          : layer.boxStyle === "bordered"
            ? "transparent"
            : alpha(palette.accent, 0.12);
      const boxBorder =
        layer.boxStyle === "bordered"
          ? `2px solid ${alpha(palette.accent, 0.4)}`
          : layer.boxStyle === "glow"
            ? `1px solid ${alpha(palette.accent, 0.3)}`
            : "none";
      const boxShadow =
        layer.boxStyle === "glow"
          ? `0 0 40px ${alpha(palette.accent, 0.2)}, 0 0 80px ${alpha(palette.accent, 0.1)}`
          : "none";
      return (
        <div
          style={{
            ...wrapper,
            ...textBase,
            padding: "24px 36px",
            borderRadius: 16,
            background: boxBg,
            border: boxBorder,
            boxShadow,
            maxWidth: 700,
          }}
        >
          <div
            style={{
              fontSize: 28,
              fontWeight: 600,
              color: palette.text,
              lineHeight: 1.5,
            }}
          >
            {typewriterText(layer.text)}
          </div>
        </div>
      );
    }

    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Scene renderer
// ---------------------------------------------------------------------------

function getLayoutStyle(layout: SceneLayout | undefined): React.CSSProperties {
  switch (layout) {
    case "top":
      return { justifyContent: "flex-start", alignItems: "center" };
    case "bottom":
      return { justifyContent: "flex-end", alignItems: "center" };
    case "split-left":
      return { flexDirection: "row", justifyContent: "center", alignItems: "center" };
    case "split-right":
      return { flexDirection: "row-reverse", justifyContent: "center", alignItems: "center" };
    case "fullscreen":
      return { padding: 0, justifyContent: "center", alignItems: "center" };
    case "grid":
      return { justifyContent: "center", alignItems: "center" };
    case "centered":
    default:
      return { justifyContent: "center", alignItems: "center" };
  }
}

const SceneRenderer: React.FC<{
  scene: SceneConfig;
  palette: Palette;
  sceneFrames: number;
}> = ({ scene, palette, sceneFrames }) => {
  const frame = useCurrentFrame();
  const transition = scene.transition ?? "fade";
  const fadeIn = transition === "fade" ? 18 : 0;
  const fadeOut = transition === "fade" ? 18 : 0;
  const sceneOpacity = sceneWindow({
    frame,
    start: 0,
    end: sceneFrames,
    fadeIn,
    fadeOut,
  });

  // Scene-level transition transforms
  let sceneTransform = "";
  if (transition === "slide-left") {
    sceneTransform = `translateX(${mix(100, 0, sceneOpacity)}%)`;
  } else if (transition === "slide-right") {
    sceneTransform = `translateX(${mix(-100, 0, sceneOpacity)}%)`;
  } else if (transition === "zoom") {
    sceneTransform = `scale(${mix(0.8, 1, sceneOpacity)})`;
  }

  const bgType = scene.background?.type ?? "gradient";
  const layoutStyle = getLayoutStyle(scene.layout);

  return (
    <AbsoluteFill
      style={{
        opacity: sceneOpacity,
        transform: sceneTransform || undefined,
      }}
    >
      {/* Background */}
      {bgType === "gradient" ? (
        <GradientStage palette={palette} frame={frame}>
          <AbsoluteFill />
        </GradientStage>
      ) : bgType === "solid" ? (
        <AbsoluteFill
          style={{
            background: scene.background && "color" in scene.background
              ? (scene.background as any).color || palette.background
              : palette.background,
          }}
        />
      ) : bgType === "media" &&
        scene.background &&
        "media" in scene.background ? (
        <AbsoluteFill>
          {scene.background.media.type === "video" ? (
            <OffthreadVideo
              src={scene.background.media.src}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          ) : (
            <Img
              src={scene.background.media.src}
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
          <AbsoluteFill
            style={{
              background: `linear-gradient(180deg, ${alpha(palette.background, 0.6)} 0%, ${alpha(palette.background, 0.4)} 40%, ${alpha(palette.background, 0.7)} 100%)`,
            }}
          />
        </AbsoluteFill>
      ) : (
        <GradientStage palette={palette} frame={frame}>
          <AbsoluteFill />
        </GradientStage>
      )}

      {/* Layers */}
      <AbsoluteFill
        style={{
          display: "flex",
          flexDirection: "column",
          padding: `${scene.paddingY ?? 60}px ${scene.paddingX ?? 48}px`,
          gap: scene.gap ?? 22,
          ...layoutStyle,
        }}
      >
        {scene.layers.map((layer, i) => (
          <LayerRenderer key={i} layer={layer} palette={palette} index={i} />
        ))}
      </AbsoluteFill>
    </AbsoluteFill>
  );
};

// ---------------------------------------------------------------------------
// Main composition
// ---------------------------------------------------------------------------

export const AiUniversalComposition: React.FC<AiVideoProps> = ({
  videoConfig,
}) => {
  const { fps } = useVideoConfig();
  void fps; // fps used by child SceneRenderer via useVideoConfig context
  const palette = resolvePalette(videoConfig?.palette);
  const scenes = videoConfig?.scenes ?? [];

  // Pre-compute cumulative frame offsets
  const offsets: number[] = [];
  let cumulative = 0;
  for (const s of scenes) {
    offsets.push(cumulative);
    cumulative += Math.max(1, Math.round((s.duration || 3) * fps));
  }

  return (
    <AbsoluteFill style={{ background: palette.background }}>
      {scenes.map((scene, i) => {
        const sceneFrames = Math.max(
          1,
          Math.round((scene.duration || 3) * fps),
        );
        return (
          <Sequence
            key={i}
            from={offsets[i]}
            durationInFrames={sceneFrames}
            name={`scene-${i}`}
          >
            <SceneRenderer
              scene={scene}
              palette={palette}
              sceneFrames={sceneFrames}
            />
          </Sequence>
        );
      })}
    </AbsoluteFill>
  );
};
