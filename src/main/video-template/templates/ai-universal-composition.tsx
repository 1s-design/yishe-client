import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  Sequence,
  useCurrentFrame,
  useVideoConfig,
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
  }),
  z.object({
    type: z.literal("headline"),
    text: z.string(),
    fontSize: z.number().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("subtitle"),
    text: z.string(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("text"),
    text: z.string(),
    maxWidth: z.number().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("badge-row"),
    badges: z.array(z.string()),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("price"),
    price: z.string(),
    originalPrice: z.string().optional(),
    label: z.string().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("metrics"),
    items: z.array(MetricItemSchema),
    columns: z.number().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("features"),
    items: z.array(FeatureItemSchema),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("media"),
    media: MediaSourceSchema,
    width: z.string().optional(),
    height: z.string().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("cta"),
    text: z.string(),
    subtext: z.string().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({
    type: z.literal("quote"),
    text: z.string(),
    author: z.string().optional(),
    delayFrames: z.number().optional(),
  }),
  z.object({ type: z.literal("divider"), delayFrames: z.number().optional() }),
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
  }),
  z.object({
    type: z.literal("bullet-list"),
    items: z.array(z.string()),
    delayFrames: z.number().optional(),
  }),
]);

const SceneSchema: z.ZodType<SceneConfig> = z.object({
  duration: z.number().min(0.1),
  background: z
    .discriminatedUnion("type", [
      z.object({ type: z.literal("gradient") }),
      z.object({
        type: z.literal("media"),
        media: MediaSourceSchema,
        opacity: z.number().min(0).max(1).optional(),
      }),
    ])
    .optional(),
  layers: z.array(LayerSchema),
  transition: z.enum(["cut", "fade"]).optional(),
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
  const delay = layer.delayFrames ?? index * 6;
  const entrance = useEntrance(delay);
  const opacity = mix(0, 1, entrance);
  const translateY = mix(28, 0, entrance);

  const wrapper: React.CSSProperties = {
    opacity,
    transform: `translateY(${translateY}px)`,
  };

  switch (layer.type) {
    case "eyebrow":
      return (
        <div style={wrapper}>
          <SectionEyebrow text={layer.text} palette={palette} />
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
            }}
          >
            {layer.text}
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
            {layer.text}
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
            {layer.text}
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
            }}
          />
        </div>
      );

    case "cta": {
      const pulse = 1 + Math.sin(frame / 18) * 0.02;
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
              borderRadius: 999,
              background: `linear-gradient(135deg, ${palette.accent}, ${palette.accentAlt})`,
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
            {layer.text}
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
              background: `linear-gradient(90deg, transparent, ${alpha(palette.accent, 0.5)}, transparent)`,
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

    case "bullet-list":
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
              <span
                style={{ fontSize: 26, color: palette.text, lineHeight: 1.5 }}
              >
                {item}
              </span>
            </div>
          ))}
        </div>
      );

    default:
      return null;
  }
};

// ---------------------------------------------------------------------------
// Scene renderer
// ---------------------------------------------------------------------------

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

  const bgType = scene.background?.type ?? "gradient";

  return (
    <AbsoluteFill style={{ opacity: sceneOpacity }}>
      {/* Background */}
      {bgType === "gradient" ? (
        <GradientStage palette={palette} frame={frame}>
          <AbsoluteFill />
        </GradientStage>
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
          justifyContent: "center",
          alignItems: "center",
          padding: "60px 48px",
          gap: 22,
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
