import React from "react";
import * as RemotionModule from "remotion";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
  interpolate,
  spring,
  Easing,
  Audio,
} from "remotion";
import { z } from "zod";

import type {
  AiVideoProps,
  ArtDirection,
  PaletteConfig,
  SceneConfig,
  SceneLayer,
  CustomCodeLayer,
  DynamicComponentLayer,
  KineticTextLayer,
  SoundWaveLayer,
  ParticlesLayer,
  CodeBlockLayer,
  ChartLayer,
} from "./ai-types";
import {
  ArtDirectionContext,
  DENSITY_PRESETS,
  GradientStage,
  MediaSurface,
  MetricGrid,
  FeatureStack,
  FooterNote,
  ProgressBarRow,
  SectionEyebrow,
  StageFrame,
  TagPill,
  TYPOGRAPHY_STACKS,
  alpha,
  clamp01,
  formatDurationLabel,
  isCyberPalette,
  isLightPalette,
  mix,
  useArtDirection,
  useEntrance,
  sceneWindow,
} from "./shared";
import type { Palette, MetricItem, FeatureItem, MediaSource } from "./shared";

// ---------------------------------------------------------------------------
// Palette presets
// ---------------------------------------------------------------------------

const PALETTE_PRESETS: Record<string, Palette> = {
  // === NEW DIVERSE & LIGHT-MODE PALETTES ===
  cleanLight: {
    background: "#f8fafc",
    backgroundAlt: "#eef2f6",
    surface: "#ffffff",
    text: "#0f172a",
    mutedText: "#475569",
    accent: "#2563eb",
    accentAlt: "#0284c7",
    glow: "#60a5fa",
  },
  warmCream: {
    background: "#fcf8f2",
    backgroundAlt: "#f4ece1",
    surface: "#ffffff",
    text: "#291a10",
    mutedText: "#786252",
    accent: "#c86b3c",
    accentAlt: "#d97706",
    glow: "#f59e0b",
  },
  nordicMinimal: {
    background: "#f2f6f3",
    backgroundAlt: "#e3ede5",
    surface: "#ffffff",
    text: "#13261b",
    mutedText: "#4a6353",
    accent: "#059669",
    accentAlt: "#10b981",
    glow: "#34d399",
  },
  vibrantPop: {
    background: "#fff5f7",
    backgroundAlt: "#ffe4ea",
    surface: "#ffffff",
    text: "#201226",
    mutedText: "#6e475d",
    accent: "#ff2a70",
    accentAlt: "#7c3aed",
    glow: "#ec4899",
  },
  solarYellow: {
    background: "#111111",
    backgroundAlt: "#1c1c1e",
    surface: "#27272a",
    text: "#fafafa",
    mutedText: "#a1a1aa",
    accent: "#facc15",
    accentAlt: "#fb923c",
    glow: "#fde047",
  },
  editorialVogue: {
    background: "#faf9f6",
    backgroundAlt: "#f0ece3",
    surface: "#ffffff",
    text: "#0a0a0a",
    mutedText: "#525252",
    accent: "#e11d48",
    accentAlt: "#991b1b",
    glow: "#f43f5e",
  },
  cyberNeon: {
    background: "#080318",
    backgroundAlt: "#160a36",
    surface: "#241254",
    text: "#ffffff",
    mutedText: "#c4b5fd",
    accent: "#00f5d4",
    accentAlt: "#f72585",
    glow: "#7209b7",
  },
  auroraBorealis: {
    background: "#05131e",
    backgroundAlt: "#0c2838",
    surface: "#133d54",
    text: "#f0fdfa",
    mutedText: "#99f6e4",
    accent: "#2dd4bf",
    accentAlt: "#818cf8",
    glow: "#38bdf8",
  },

  // === CLASSIC PRESETS ===
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
  // === SCHEME 3: DYNAMIC REMOTION ENGINE LAYERS ===
  z.object({
    type: z.literal("custom-code"),
    code: z.string(),
    props: z.record(z.any()).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("dynamic-component"),
    componentName: z.string(),
    props: z.record(z.any()).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("kinetic-text"),
    text: z.string(),
    subtext: z.string().optional(),
    style: z.enum(["marquee", "bold-impact", "neon-glow", "outline-stroke", "glitch"]).optional(),
    fontSize: z.number().optional(),
    rotate: z.number().optional(),
    speed: z.number().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("sound-wave"),
    bars: z.number().optional(),
    height: z.number().optional(),
    waveStyle: z.enum(["bars", "wave", "circle", "mirror"]).optional(),
    color: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("particles"),
    count: z.number().optional(),
    style: z.enum(["bokeh", "sparks", "dust", "grid-dots"]).optional(),
    color: z.string().optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("code-block"),
    code: z.string(),
    language: z.string().optional(),
    title: z.string().optional(),
    highlightLines: z.array(z.number()).optional(),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
  z.object({
    type: z.literal("chart"),
    chartType: z.enum(["bar", "ring", "gauge"]),
    title: z.string().optional(),
    items: z.array(z.object({ label: z.string(), value: z.number(), max: z.number().optional(), color: z.string().optional() })),
    delayFrames: z.number().optional(),
    animation: z.enum(["fade-up", "fade-in", "slide-left", "slide-right", "zoom-in", "zoom-out", "rotate-in", "bounce", "typewriter"]).optional(),
    opacity: z.number().min(0).max(1).optional(),
  }),
]) as unknown as z.ZodType<SceneLayer>;

const SceneSchema: z.ZodType<SceneConfig> = z.object({
  duration: z.number().min(0.1),
  background: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("gradient"), style: z.string().optional() }).passthrough(),
      z.object({ type: z.literal("solid"), color: z.string().optional() }).passthrough(),
      z.object({
        type: z.literal("media"),
        media: MediaSourceSchema,
        opacity: z.number().min(0).max(1).optional(),
      }).passthrough(),
    ])
    .optional(),
  layers: z.array(LayerSchema),
  transition: z.enum(["cut", "fade", "slide-left", "slide-right", "zoom"]).optional(),
  camera: z.enum(["none", "dolly-in", "dolly-out", "pan-left", "pan-right", "shake", "zoom-twist"]).optional(),
  decorations: z
    .object({
      watermark: z.string().optional(),
      headerBadge: z.string().optional(),
      footerText: z.string().optional(),
      showExhibition: z.boolean().optional(),
    })
    .optional(),
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

const ArtDirectionSchema: z.ZodType<ArtDirection> = z
  .object({
    mood: z.string().optional(),
    motionEnergy: z.enum(["low", "medium", "high"]).optional(),
    density: z.enum(["airy", "balanced", "packed"]).optional(),
    typography: z
      .enum([
        "serif-editorial",
        "sans-modern",
        "mono-tech",
        "display-condensed",
        "rounded-friendly",
      ])
      .optional(),
    transitionStyle: z.enum(["soft", "punchy", "geometric"]).optional(),
    signature: z.string().optional(),
  })
  .optional();

export const AiVideoSchema = z.object({
  videoConfig: z
    .object({
      meta: z
        .object({
          title: z.string().optional(),
          orientation: z.enum(["portrait", "landscape", "square"]).optional(),
          fps: z.number().optional(),
        })
        .optional()
        .default({ title: "AI Video", orientation: "portrait", fps: 30 }),
      palette: PaletteConfigSchema.optional().default({ preset: "cyberpunk" }),
      artDirection: ArtDirectionSchema,
      scenes: z.array(SceneSchema).min(1),
      audio: z
        .object({
          bgmUrl: z.string().optional(),
          bgmVolume: z.number().optional(),
          loop: z.boolean().optional(),
        })
        .optional(),
    })
    .passthrough(),
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

// Palette-aware font families
function getPaletteFont(palette: Palette): string {
  // artDirection.typography override wins — the director's explicit voice
  if (palette.fontFamily) return palette.fontFamily;
  const bg = palette.background.toLowerCase();
  const accent = palette.accent.toLowerCase();
  // Warm / editorial style → elegant serif
  if (bg.startsWith("#faf9") || accent === "#e11d48" || accent === "#c86b3c") {
    return "'Playfair Display', 'Songti SC', 'STSong', Georgia, serif";
  }
  // Nordic / natural → rounded geo-sans
  if (accent === "#059669" || accent === "#10b981") {
    return "'Nunito', 'PingFang SC', 'Helvetica Neue', system-ui, sans-serif";
  }
  // Vibrant / dopamine → playful display
  if (accent === "#ff2a70" || accent === "#7c3aed") {
    return "'Outfit', 'Poppins', 'PingFang SC', system-ui, sans-serif";
  }
  // Cyber / neon → mono-techy
  if (bg === "#080318" || bg === "#061018" || accent === "#00f5d4" || accent === "#51d0ff") {
    return "'JetBrains Mono', 'Courier New', 'SF Mono', monospace";
  }
  // Solar yellow / high energy → condensed bold
  if (accent === "#facc15" || accent === "#fb923c" || accent === "#ff7e52") {
    return "'Barlow Condensed', 'Arial Narrow', 'PingFang SC', system-ui, sans-serif";
  }
  // Default: modern sans
  return "'Inter', 'Segoe UI', 'PingFang SC', system-ui, sans-serif";
}

// ---------------------------------------------------------------------------
// Dynamic Component Renderers (Scheme 3: Remotion Open Engine)
// ---------------------------------------------------------------------------

const DynamicCodeRenderer: React.FC<{
  code: string;
  props?: Record<string, any>;
  palette: Palette;
  frame: number;
  fps: number;
  width?: number;
  height?: number;
  durationInFrames?: number;
}> = ({ code, props = {}, palette, frame, fps, width, height, durationInFrames }) => {
  const videoConfig = useVideoConfig();
  const w = width ?? videoConfig.width;
  const h = height ?? videoConfig.height;
  const d = durationInFrames ?? videoConfig.durationInFrames;
  try {
    const exportsObj: Record<string, any> = {};
    const moduleObj = { exports: exportsObj };

    const reactModule = Object.assign({}, React, { default: React, __esModule: true });
    const remModule = Object.assign({}, RemotionModule, { default: RemotionModule, __esModule: true });

    const virtualRequire = (mod: string) => {
      if (mod === "react") return reactModule;
      if (mod === "remotion" || mod === "@remotion/core") return remModule;
      return {};
    };

    const scope = {
      React: reactModule,
      ...React,
      remotion: remModule,
      ...RemotionModule,
      // Remotion hook and context bridges
      useCurrentFrame: () => frame,
      useVideoConfig: () => ({ fps, width: w, height: h, durationInFrames: d }),
      AbsoluteFill,
      Img,
      OffthreadVideo,
      Sequence,
      Audio,
      interpolate,
      spring,
      Easing,
      frame,
      fps,
      width: w,
      height: h,
      durationInFrames: d,
      palette,
      props,
      alpha,
      mix,
      clamp01,
      isLightPalette,
      isCyberPalette,
      formatDurationLabel,
      // shared template building blocks (for component templates)
      GradientStage,
      StageFrame,
      TagPill,
      SectionEyebrow,
      MediaSurface,
      MetricGrid,
      FeatureStack,
      ProgressBarRow,
      FooterNote,
      sceneWindow,
      useEntrance,
      require: virtualRequire,
      exports: exportsObj,
      module: moduleObj,
    };

    const fn = new Function(
      "scope",
      `
      const {
        React,
        remotion,
        useCurrentFrame,
        useVideoConfig,
        AbsoluteFill,
        Sequence,
        Img,
        OffthreadVideo,
        Audio,
        interpolate,
        spring,
        Easing,
        frame,
        fps,
        width,
        height,
        durationInFrames,
        palette,
        props,
        alpha,
        mix,
        clamp01,
        isLightPalette,
        isCyberPalette,
        formatDurationLabel,
        GradientStage,
        StageFrame,
        TagPill,
        SectionEyebrow,
        MediaSurface,
        MetricGrid,
        FeatureStack,
        ProgressBarRow,
        FooterNote,
        sceneWindow,
        useEntrance,
        require,
        exports,
        module,
      } = scope;

      try {
        ${code.includes("return") || code.includes("export") || code.includes("module.exports") ? code : `return (${code});`}

        // Check if a React component was exported
        const exported = module.exports?.default || exports.default || module.exports;
        if (typeof exported === 'function') {
          return React.createElement(exported, { frame, fps, palette, props });
        }
        if (React.isValidElement(exported)) {
          return exported;
        }
      } catch (err) {
        return React.createElement('div', {
          style: { padding: 16, color: '#f87171', background: 'rgba(0,0,0,0.5)', borderRadius: 10, fontSize: 16 }
        }, 'Dynamic Code Execution Error: ' + (err.message || String(err)));
      }
    `
    );
    const result = fn(scope);
    return React.isValidElement(result) ? result : <div>{String(result ?? "")}</div>;
  } catch (err: any) {
    return (
      <div style={{ color: "#f87171", fontSize: 14, background: "rgba(0,0,0,0.6)", padding: 12, borderRadius: 8 }}>
        Render Evaluation Error: {err?.message || String(err)}
      </div>
    );
  }
};

const KineticTextRenderer: React.FC<{
  layer: KineticTextLayer;
  palette: Palette;
  frame: number;
  fps: number;
}> = ({ layer, palette, frame }) => {
  const style = layer.style || "bold-impact";
  const fontSize = layer.fontSize || (style === "marquee" ? 44 : 76);
  const rotate = layer.rotate ?? (style === "bold-impact" ? -3 : 0);
  const speed = layer.speed ?? 1;

  if (style === "marquee") {
    const offset = ((frame * speed * 4) % 1200) * -1;
    return (
      <div
        style={{
          width: "100%",
          overflow: "hidden",
          whiteSpace: "nowrap",
          padding: "16px 0",
          background: `linear-gradient(90deg, transparent, ${alpha(palette.accent, 0.15)}, transparent)`,
          transform: `rotate(${rotate}deg)`,
        }}
      >
        <div
          style={{
            display: "inline-block",
            transform: `translateX(${offset}px)`,
            fontSize,
            fontWeight: 900,
            letterSpacing: 4,
            textTransform: "uppercase",
            color: palette.accent,
            textShadow: `0 0 20px ${alpha(palette.glow, 0.5)}`,
          }}
        >
          {`${layer.text}  ✦  ${layer.subtext || layer.text}  ✦  ${layer.text}  ✦  ${layer.subtext || layer.text}  ✦  `}
        </div>
      </div>
    );
  }

  const isOutline = style === "outline-stroke";
  const isNeon = style === "neon-glow";
  const isGlitch = style === "glitch";

  const glitchX = isGlitch && frame % 12 < 3 ? Math.sin(frame) * 8 : 0;
  const glitchY = isGlitch && frame % 12 < 3 ? Math.cos(frame) * 4 : 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        transform: `rotate(${rotate}deg) translate(${glitchX}px, ${glitchY}px)`,
        padding: "20px 30px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize,
          fontWeight: 900,
          lineHeight: 1.05,
          letterSpacing: -1,
          textTransform: "uppercase",
          color: isOutline ? "transparent" : palette.text,
          WebkitTextStroke: isOutline ? `3px ${palette.accent}` : undefined,
          textShadow: isNeon
            ? `0 0 15px ${palette.glow}, 0 0 40px ${palette.accent}`
            : `0 8px 30px ${alpha("#000000", 0.4)}`,
        }}
      >
        {layer.text}
      </div>
      {layer.subtext && (
        <div
          style={{
            marginTop: 12,
            fontSize: Math.round(fontSize * 0.38),
            fontWeight: 700,
            letterSpacing: 3,
            color: palette.accent,
            textTransform: "uppercase",
          }}
        >
          {layer.subtext}
        </div>
      )}
    </div>
  );
};

const SoundWaveRenderer: React.FC<{
  layer: SoundWaveLayer;
  palette: Palette;
  frame: number;
}> = ({ layer, palette, frame }) => {
  const bars = layer.bars || 28;
  const height = layer.height || 100;
  const color = layer.color || palette.accent;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height,
        padding: "10px 20px",
        borderRadius: 16,
        background: alpha(palette.surface, 0.4),
        backdropFilter: "blur(8px)",
      }}
    >
      {Array.from({ length: bars }).map((_, i) => {
        const wave1 = Math.sin(frame * 0.18 + i * 0.4);
        const wave2 = Math.cos(frame * 0.12 - i * 0.25);
        const wave3 = Math.sin(frame * 0.28 + i * 0.6);
        const normalized = Math.max(0.12, (wave1 * 0.4 + wave2 * 0.35 + wave3 * 0.25 + 1) / 2);
        const barHeight = Math.round(normalized * (height - 16));

        return (
          <div
            key={i}
            style={{
              width: 5,
              height: barHeight,
              borderRadius: 3,
              background: `linear-gradient(180deg, ${palette.glow} 0%, ${color} 100%)`,
              boxShadow: `0 0 10px ${alpha(color, 0.4)}`,
            }}
          />
        );
      })}
    </div>
  );
};

const ParticlesRenderer: React.FC<{
  layer: ParticlesLayer;
  palette: Palette;
  frame: number;
}> = ({ layer, palette, frame }) => {
  const count = layer.count || 24;
  const color = layer.color || palette.glow;

  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {Array.from({ length: count }).map((_, i) => {
        const seedX = (i * 137.5) % 100;
        const seedY = (i * 223.1) % 100;
        const size = 4 + ((i * 7) % 18);
        const driftX = Math.sin(frame * 0.04 + i) * 20;
        const driftY = ((frame * (0.3 + (i % 5) * 0.1) + seedY * 10) % 110) - 10;
        const opacity = 0.2 + (Math.sin(frame * 0.08 + i) + 1) * 0.25;

        return (
          <div
            key={i}
            style={{
              position: "absolute",
              left: `${seedX}%`,
              bottom: `${driftY}%`,
              transform: `translateX(${driftX}px)`,
              width: size,
              height: size,
              borderRadius: "50%",
              backgroundColor: color,
              opacity,
              boxShadow: `0 0 ${size * 2}px ${color}`,
            }}
          />
        );
      })}
    </div>
  );
};

const CodeBlockRenderer: React.FC<{
  layer: CodeBlockLayer;
  palette: Palette;
  frame: number;
}> = ({ layer, palette, frame }) => {
  const lines = layer.code.split("\n");
  const visibleLineCount = Math.min(lines.length, Math.floor(frame / 6) + 1);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 720,
        background: "rgba(15, 23, 42, 0.88)",
        borderRadius: 16,
        overflow: "hidden",
        border: `1px solid ${alpha(palette.accent, 0.35)}`,
        boxShadow: `0 20px 50px rgba(0, 0, 0, 0.5), 0 0 25px ${alpha(palette.glow, 0.2)}`,
        backdropFilter: "blur(14px)",
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "10px 16px",
          background: "rgba(0, 0, 0, 0.35)",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <div style={{ display: "flex", gap: 8 }}>
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#ef4444" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#eab308" }} />
          <div style={{ width: 12, height: 12, borderRadius: "50%", background: "#22c55e" }} />
        </div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.6)", fontWeight: 600 }}>
          {layer.title || (layer.language ? `snippet.${layer.language}` : "main.tsx")}
        </div>
        <div style={{ width: 44 }} />
      </div>

      <div style={{ padding: "16px 20px", fontSize: 17, lineHeight: 1.6, color: "#f8fafc" }}>
        {lines.slice(0, visibleLineCount).map((line, idx) => {
          const isHighlighted = layer.highlightLines?.includes(idx + 1);
          return (
            <div
              key={idx}
              style={{
                display: "flex",
                background: isHighlighted ? alpha(palette.accent, 0.2) : undefined,
                padding: "2px 8px",
                borderRadius: 4,
              }}
            >
              <span style={{ width: 36, color: "rgba(255,255,255,0.3)", userSelect: "none" }}>
                {idx + 1}
              </span>
              <span style={{ color: isHighlighted ? palette.glow : "#e2e8f0" }}>{line}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const ChartRenderer: React.FC<{
  layer: ChartLayer;
  palette: Palette;
  frame: number;
}> = ({ layer, palette, frame }) => {
  const progress = Math.min(1, frame / 30);

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 720,
        padding: "24px 28px",
        borderRadius: 20,
        background: `linear-gradient(135deg, ${alpha(palette.surface, 0.8)}, ${alpha(palette.backgroundAlt, 0.85)})`,
        border: `1px solid ${alpha(palette.accent, 0.3)}`,
        boxShadow: `0 16px 40px rgba(0, 0, 0, 0.35)`,
        backdropFilter: "blur(12px)",
      }}
    >
      {layer.title && (
        <div
          style={{
            fontSize: 22,
            fontWeight: 800,
            marginBottom: 20,
            color: palette.text,
            letterSpacing: -0.2,
          }}
        >
          {layer.title}
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {layer.items.map((item, idx) => {
          const max = item.max || 100;
          const currentPercent = Math.min(100, Math.round((item.value / max) * 100 * progress));
          const barColor = item.color || (idx % 2 === 0 ? palette.accent : palette.accentAlt);

          return (
            <div key={idx} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 16, fontWeight: 700, color: palette.text }}>
                <span>{item.label}</span>
                <span style={{ color: barColor }}>{currentPercent}%</span>
              </div>
              <div
                style={{
                  width: "100%",
                  height: 12,
                  borderRadius: 6,
                  background: alpha(palette.text, 0.1),
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${currentPercent}%`,
                    height: "100%",
                    borderRadius: 6,
                    background: `linear-gradient(90deg, ${barColor}, ${palette.glow})`,
                    boxShadow: `0 0 12px ${alpha(barColor, 0.5)}`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const DynamicComponentRenderer: React.FC<{
  layer: DynamicComponentLayer;
  palette: Palette;
  frame: number;
  fps: number;
}> = ({ layer, palette, frame, fps }) => {
  const name = layer.componentName?.toLowerCase() || "";
  const props = layer.props || {};

  if (name.includes("sound-wave") || name.includes("audio-visualizer") || name.includes("equalizer")) {
    return <SoundWaveRenderer layer={{ type: "sound-wave", ...props }} palette={palette} frame={frame} />;
  }
  if (name.includes("kinetic") || name.includes("marquee") || name.includes("ticker")) {
    return <KineticTextRenderer layer={{ type: "kinetic-text", text: props.text || "DYNAMIC KEYNOTE", ...props }} palette={palette} frame={frame} fps={fps} />;
  }
  if (name.includes("particle") || name.includes("spark") || name.includes("bokeh")) {
    return <ParticlesRenderer layer={{ type: "particles", ...props }} palette={palette} frame={frame} />;
  }
  if (name.includes("code") || name.includes("terminal")) {
    return <CodeBlockRenderer layer={{ type: "code-block", code: props.code || "// AI Dynamic Engine", ...props }} palette={palette} frame={frame} />;
  }
  if (name.includes("chart") || name.includes("gauge") || name.includes("metric-bars")) {
    return (
      <ChartRenderer
        layer={{
          type: "chart",
          chartType: props.chartType || "bar",
          title: props.title,
          items: props.items || [{ label: "性能提升", value: 92 }, { label: "能耗降低", value: 68 }],
        }}
        palette={palette}
        frame={frame}
      />
    );
  }
  if (name.includes("cyber-hud") || name.includes("hologram") || name.includes("scanner")) {
    return (
      <div
        style={{
          position: "relative",
          padding: "24px 36px",
          border: `1px solid ${alpha(palette.accent, 0.4)}`,
          background: alpha(palette.surface, 0.3),
          borderRadius: 8,
          boxShadow: `0 0 30px ${alpha(palette.glow, 0.25)}`,
        }}
      >
        <div style={{ position: "absolute", top: -2, left: -2, width: 14, height: 14, borderTop: `3px solid ${palette.accent}`, borderLeft: `3px solid ${palette.accent}` }} />
        <div style={{ position: "absolute", top: -2, right: -2, width: 14, height: 14, borderTop: `3px solid ${palette.accent}`, borderRight: `3px solid ${palette.accent}` }} />
        <div style={{ position: "absolute", bottom: -2, left: -2, width: 14, height: 14, borderBottom: `3px solid ${palette.accent}`, borderLeft: `3px solid ${palette.accent}` }} />
        <div style={{ position: "absolute", bottom: -2, right: -2, width: 14, height: 14, borderBottom: `3px solid ${palette.accent}`, borderRight: `3px solid ${palette.accent}` }} />
        <div style={{ fontSize: 13, letterSpacing: 3, color: palette.accent, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>
          {props.tag || "SYSTEM PROTOCOL"}
        </div>
        <div style={{ fontSize: 28, fontWeight: 800, color: palette.text }}>
          {props.content || "CYBER ENGINE ACTIVE"}
        </div>
      </div>
    );
  }

  if (props.code) {
    return <DynamicCodeRenderer code={props.code} props={props} palette={palette} frame={frame} fps={fps} />;
  }

  return (
    <div style={{ padding: 16, border: `1px dashed ${palette.accent}`, borderRadius: 12, color: palette.text }}>
      [DynamicComponent: {layer.componentName}]
    </div>
  );
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
              fontFamily: getPaletteFont(palette),
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
          {(layer.badges || (layer as any).items || []).map((b: any, i: number) => (
            <TagPill key={i} text={typeof b === 'string' ? b : (b?.text || b?.label || String(b))} palette={palette} light />
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

    case "media": {
      const mediaWidth = layer.width ?? "100%";
      const mediaHeight = layer.height ?? "680px";
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "100%",
            maxWidth: 780,
          }}
        >
          <div
            style={{
              position: "relative",
              width: mediaWidth,
              height: mediaHeight,
              padding: 10,
              background: `linear-gradient(145deg, ${alpha(palette.surface, 0.85)} 0%, ${alpha(palette.backgroundAlt, 0.9)} 100%)`,
              borderRadius: (layer.borderRadius ?? 20) + 8,
              border: `1px solid ${alpha(palette.accent, 0.4)}`,
              boxShadow: `0 36px 96px ${alpha("#000000", 0.65)}, 0 10px 30px ${alpha(palette.glow, 0.2)}`,
            }}
          >
            <MediaSurface
              media={layer.media as MediaSource}
              palette={palette}
              frame={frame}
              style={{
                width: "100%",
                height: "100%",
                borderRadius: layer.borderRadius ?? 20,
              }}
            />
          </div>
        </div>
      );
    }

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
              color:
                layer.buttonStyle === "outline"
                  ? palette.accent
                  : isLightPalette(palette)
                    ? "#ffffff"
                    : palette.background,
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
              fontFamily: "'Playfair Display', 'Songti SC', 'STSong', 'Georgia', serif",
              fontSize: 44,
              fontStyle: "italic",
              color: palette.text,
              maxWidth: 750,
              margin: "0 auto",
              lineHeight: 1.5,
              letterSpacing: "0.02em",
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
          {(layer.items || (layer as any).badges || []).map((item: any, i: number) => (
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
          {(layer.images || (layer as any).items || []).map((img: any, i: number) => (
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

    case "split-media": {
      const zoom = 1 + Math.min(0.12, (frame / 140) * 0.12);
      return (
        <div
          style={{
            ...wrapper,
            display: "flex",
            width: "100%",
            maxWidth: 960,
            gap: 32,
            alignItems: "center",
            flexDirection: layer.side === "right" ? "row-reverse" : "row",
          }}
        >
          {/* Media column */}
          <div
            style={{
              flex: 1.1,
              position: "relative",
              borderRadius: 20,
              overflow: "hidden",
              border: `2px solid ${alpha(palette.accent, 0.45)}`,
              boxShadow: `0 24px 70px ${alpha("#000000", 0.6)}, 0 4px 16px ${alpha(palette.glow, 0.2)}`,
            }}
          >
            {layer.media.type === "video" ? (
              <OffthreadVideo
                src={layer.media.src}
                style={{
                  width: "100%",
                  height: 460,
                  objectFit: "cover",
                  transform: `scale(${zoom})`,
                }}
              />
            ) : (
              <Img
                src={layer.media.src}
                style={{
                  width: "100%",
                  height: 460,
                  objectFit: "cover",
                  transform: `scale(${zoom})`,
                }}
              />
            )}
            {layer.badge ? (
              <div
                style={{
                  position: "absolute",
                  bottom: 12,
                  left: 12,
                  padding: "3px 8px",
                  borderRadius: 4,
                  background: "rgba(0,0,0,0.6)",
                  backdropFilter: "blur(6px)",
                  color: palette.accent,
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: 1.2,
                }}
              >
                {layer.badge}
              </div>
            ) : null}
          </div>
          {/* Text column */}
          <div
            style={{
              flex: 0.9,
              ...textBase,
              display: "flex",
              flexDirection: "column",
              gap: 14,
              padding: "12px 18px",
              background: `linear-gradient(135deg, ${alpha(palette.surface, 0.75)} 0%, ${alpha(palette.backgroundAlt, 0.8)} 100%)`,
              borderRadius: 18,
              border: `1px solid ${alpha(palette.accent, 0.25)}`,
              backdropFilter: "blur(12px)",
              boxShadow: `0 16px 40px ${alpha("#000000", 0.35)}`,
            }}
          >
            {layer.eyebrow ? (
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  letterSpacing: 2,
                  color: palette.accent,
                  textTransform: "uppercase",
                }}
              >
                {layer.eyebrow}
              </div>
            ) : null}
            {layer.headline && (
              <div
                style={{
                  fontSize: 34,
                  fontWeight: 800,
                  color: palette.text,
                  lineHeight: 1.25,
                  letterSpacing: -0.5,
                }}
              >
                {layer.headline}
              </div>
            )}
            <div
              style={{
                width: 36,
                height: 2,
                background: palette.accent,
                opacity: 0.8,
              }}
            />
            {layer.text && (
              <div
                style={{
                  fontSize: 20,
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
    }

    case "accent-box": {
      const isLight = isLightPalette(palette);
      const boxBg = isLight
        ? layer.boxStyle === "bordered"
          ? "transparent"
          : layer.boxStyle === "glow"
            ? alpha(palette.accent, 0.08)
            : alpha(palette.accent, 0.06)
        : layer.boxStyle === "glow"
          ? `linear-gradient(135deg, ${alpha(palette.accent, 0.15)}, ${alpha(palette.accentAlt, 0.1)})`
          : layer.boxStyle === "bordered"
            ? "transparent"
            : alpha(palette.accent, 0.12);
      const boxBorder = isLight
        ? layer.boxStyle === "bordered"
          ? `2px solid ${alpha(palette.accent, 0.45)}`
          : layer.boxStyle === "glow"
            ? `1px solid ${alpha(palette.accent, 0.28)}`
            : `1px solid ${alpha(palette.text, 0.06)}`
        : layer.boxStyle === "bordered"
          ? `2px solid ${alpha(palette.accent, 0.4)}`
          : layer.boxStyle === "glow"
            ? `1px solid ${alpha(palette.accent, 0.3)}`
            : "none";
      const boxShadow = isLight
        ? layer.boxStyle === "glow"
          ? `0 12px 36px ${alpha(palette.accent, 0.14)}`
          : `0 4px 14px ${alpha(palette.text, 0.04)}`
        : layer.boxStyle === "glow"
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

    // === SCHEME 3: DYNAMIC REMOTION ENGINE LAYER DISPATCH ===

    case "custom-code":
      return (
        <div style={wrapper}>
          <DynamicCodeRenderer
            code={layer.code}
            props={layer.props}
            palette={palette}
            frame={frame}
            fps={fps}
          />
        </div>
      );

    case "dynamic-component":
      return (
        <div style={wrapper}>
          <DynamicComponentRenderer
            layer={layer}
            palette={palette}
            frame={frame}
            fps={fps}
          />
        </div>
      );

    case "kinetic-text":
      return (
        <div style={wrapper}>
          <KineticTextRenderer
            layer={layer}
            palette={palette}
            frame={frame}
            fps={fps}
          />
        </div>
      );

    case "sound-wave":
      return (
        <div style={wrapper}>
          <SoundWaveRenderer layer={layer} palette={palette} frame={frame} />
        </div>
      );

    case "particles":
      return (
        <div style={wrapper}>
          <ParticlesRenderer layer={layer} palette={palette} frame={frame} />
        </div>
      );

    case "code-block":
      return (
        <div style={wrapper}>
          <CodeBlockRenderer layer={layer} palette={palette} frame={frame} />
        </div>
      );

    case "chart":
      return (
        <div style={wrapper}>
          <ChartRenderer layer={layer} palette={palette} frame={frame} />
        </div>
      );

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
  const art = useArtDirection();
  const density = DENSITY_PRESETS[art.density] ?? DENSITY_PRESETS.balanced;
  const padY = scene.paddingY ?? density.paddingY;
  const padX = scene.paddingX ?? density.paddingX;
  const gapDefault = scene.gap ?? density.gap;
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

  // Camera motion transforms (Scheme 3: Remotion Cinematic Camera)
  const camera = scene.camera || "none";
  let cameraTransform = "";
  if (camera === "dolly-in") {
    const scale = interpolate(frame, [0, sceneFrames], [1.0, 1.12], {
      extrapolateRight: "clamp",
    });
    cameraTransform = `scale(${scale})`;
  } else if (camera === "dolly-out") {
    const scale = interpolate(frame, [0, sceneFrames], [1.14, 1.0], {
      extrapolateRight: "clamp",
    });
    cameraTransform = `scale(${scale})`;
  } else if (camera === "pan-left") {
    const tx = interpolate(frame, [0, sceneFrames], [24, -24], {
      extrapolateRight: "clamp",
    });
    cameraTransform = `scale(1.05) translateX(${tx}px)`;
  } else if (camera === "pan-right") {
    const tx = interpolate(frame, [0, sceneFrames], [-24, 24], {
      extrapolateRight: "clamp",
    });
    cameraTransform = `scale(1.05) translateX(${tx}px)`;
  } else if (camera === "shake") {
    const offsetX = Math.sin(frame * 0.4) * 4 + Math.cos(frame * 0.7) * 2;
    const offsetY = Math.cos(frame * 0.35) * 4 + Math.sin(frame * 0.8) * 2;
    cameraTransform = `translate(${offsetX}px, ${offsetY}px)`;
  } else if (camera === "zoom-twist") {
    const scale = interpolate(frame, [0, sceneFrames], [1.0, 1.1], {
      extrapolateRight: "clamp",
    });
    const rot = interpolate(frame, [0, sceneFrames], [-0.8, 0.8], {
      extrapolateRight: "clamp",
    });
    cameraTransform = `scale(${scale}) rotate(${rot}deg)`;
  }

  const combinedTransform = [sceneTransform, cameraTransform]
    .filter(Boolean)
    .join(" ");

  const bgType = scene.background?.type ?? "gradient";
  const layout = scene.layout ?? "centered";
  const isSplit = layout === "split-left" || layout === "split-right";

  // For split layouts: split layers at the midpoint
  const splitIndex = isSplit
    ? Math.ceil(scene.layers.length / 2)
    : scene.layers.length;
  const leftLayers = scene.layers.slice(0, splitIndex);
  const rightLayers = scene.layers.slice(splitIndex);

  const layoutStyle = getLayoutStyle(layout);

  const bgNode = bgType === "gradient" ? (
    <GradientStage
      palette={palette}
      frame={frame}
      stageStyle={(scene.background as any)?.style}
    >
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
    <GradientStage
      palette={palette}
      frame={frame}
      stageStyle={(scene.background as any)?.style}
    >
      <AbsoluteFill />
    </GradientStage>
  );

  return (
    <AbsoluteFill
      style={{
        opacity: sceneOpacity,
        transform: combinedTransform || undefined,
      }}
    >
      {/* Background */}
      {bgNode}

      {/* Background watermark - ONLY if explicitly configured or exhibition */}
      {scene.decorations?.watermark || scene.decorations?.showExhibition ? (
        <div
          style={{
            position: "absolute",
            left: "50%",
            top: "42%",
            transform: "translate(-50%, -50%)",
            fontSize: 130,
            fontWeight: 900,
            letterSpacing: 16,
            color: isLightPalette(palette) ? "rgba(0,0,0,0.028)" : "rgba(255,255,255,0.038)",
            textTransform: "uppercase",
            whiteSpace: "nowrap",
            pointerEvents: "none",
            userSelect: "none",
            fontFamily: "serif",
            zIndex: 1,
          }}
        >
          {scene.decorations?.watermark || "MASTERWORK"}
        </div>
      ) : null}

      {/* Top Header Bar - ONLY if explicitly configured or exhibition */}
      {scene.decorations?.headerBadge || scene.decorations?.showExhibition ? (
        <div
          style={{
            position: "absolute",
            top: 44,
            left: 52,
            right: 52,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span
              style={{
                width: 8,
                height: 8,
                borderRadius: "50%",
                backgroundColor: palette.accent,
                boxShadow: `0 0 10px ${palette.accent}`,
              }}
            />
            <span
              style={{
                fontSize: 13,
                fontWeight: 700,
                letterSpacing: 2.5,
                color: alpha(palette.text, 0.55),
                textTransform: "uppercase",
              }}
            >
              {scene.decorations?.headerBadge || "CURATION · MASTERPIECE"}
            </span>
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: 2,
              color: alpha(palette.text, 0.4),
            }}
          >
            ✦ 4K CINEMATIC
          </div>
        </div>
      ) : null}

      {/* Bottom Footer - ONLY if explicitly configured or exhibition */}
      {scene.decorations?.footerText || scene.decorations?.showExhibition ? (
        <div
          style={{
            position: "absolute",
            bottom: 40,
            left: 52,
            right: 52,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            pointerEvents: "none",
            zIndex: 20,
          }}
        >
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {[...Array(8)].map((_, i) => (
              <div
                key={i}
                style={{
                  width: 2,
                  height: i % 2 === 0 ? 12 : 6,
                  backgroundColor: alpha(palette.text, 0.28),
                }}
              />
            ))}
          </div>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              letterSpacing: 1.5,
              color: alpha(palette.text, 0.45),
            }}
          >
            {scene.decorations?.footerText || "MUSEUM ARCHIVE COLLECTION"}
          </div>
        </div>
      ) : null}

      {/* Layers — split or normal */}
      {isSplit ? (
        <AbsoluteFill
          style={{
            display: "flex",
            flexDirection: layout === "split-right" ? "row-reverse" : "row",
            padding: `${padY}px ${padX}px`,
            gap: gapDefault + 14,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {/* Left column */}
          <div
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              gap: gapDefault,
              alignItems: "flex-start",
              justifyContent: "center",
              padding: "0 16px",
            }}
          >
            {leftLayers.map((layer, i) => (
              <LayerRenderer key={i} layer={layer} palette={palette} index={i} />
            ))}
          </div>
          {/* Right column */}
          {rightLayers.length > 0 && (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                gap: gapDefault,
                alignItems: "flex-start",
                justifyContent: "center",
                padding: "0 16px",
              }}
            >
              {rightLayers.map((layer, i) => (
                <LayerRenderer key={i} layer={layer} palette={palette} index={splitIndex + i} />
              ))}
            </div>
          )}
        </AbsoluteFill>
      ) : (
        <AbsoluteFill
          style={{
            display: "flex",
            flexDirection: "column",
            padding: `${padY}px ${padX}px`,
            gap: gapDefault,
            ...layoutStyle,
          }}
        >
          {scene.layers.map((layer, i) => (
            <LayerRenderer key={i} layer={layer} palette={palette} index={i} />
          ))}
        </AbsoluteFill>
      )}
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

  // Style DNA from artDirection — typography voice, motion energy, density
  const art = videoConfig?.artDirection;
  const artTokens = React.useMemo(
    () => ({
      motionEnergy: art?.motionEnergy ?? "medium",
      density: art?.density ?? "balanced",
      typography: art?.typography,
    }),
    [art?.motionEnergy, art?.density, art?.typography],
  );
  if (art?.typography && TYPOGRAPHY_STACKS[art.typography] && !palette.fontFamily) {
    palette.fontFamily = TYPOGRAPHY_STACKS[art.typography];
  }

  // Pre-compute cumulative frame offsets
  const offsets: number[] = [];
  let cumulative = 0;
  for (const s of scenes) {
    offsets.push(cumulative);
    cumulative += Math.max(1, Math.round((s.duration || 3) * fps));
  }

  return (
    <ArtDirectionContext.Provider value={artTokens}>
      <AbsoluteFill style={{ background: palette.background }}>
        {videoConfig?.audio?.bgmUrl ? (
          <Audio
            src={videoConfig.audio.bgmUrl}
            volume={videoConfig.audio.bgmVolume ?? 0.8}
            loop={videoConfig.audio.loop ?? true}
            onError={(e) => {
              console.warn('[Remotion Audio] BGM load error, skipping audio:', e);
            }}
          />
        ) : null}
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
    </ArtDirectionContext.Provider>
  );
};
