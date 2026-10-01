import React from "react";
import {
  AbsoluteFill,
  Img,
  OffthreadVideo,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";

export type Palette = {
  background: string;
  backgroundAlt: string;
  surface: string;
  text: string;
  mutedText: string;
  accent: string;
  accentAlt: string;
  glow: string;
  /** Optional typography override coming from artDirection. */
  fontFamily?: string;
};

export type MediaSource = {
  type: "image" | "video";
  src: string;
  poster?: string;
  alt?: string;
};

export type MetricItem = {
  label: string;
  value: string;
  detail?: string;
};

export type FeatureItem = {
  eyebrow?: string;
  title: string;
  text: string;
};

export const clamp01 = (value: number) => {
  return Math.max(0, Math.min(1, value));
};

export const mix = (from: number, to: number, progress: number) => {
  return from + (to - from) * clamp01(progress);
};

export const alpha = (hex: string | undefined | null, opacity: number) => {
  const safeHex = hex || "#000000";
  const cleaned = safeHex.replace("#", "");
  const normalized =
    cleaned.length === 3
      ? cleaned
          .split("")
          .map((char) => char + char)
          .join("")
      : cleaned.padEnd(6, "0").slice(0, 6);

  const red = parseInt(normalized.slice(0, 2), 16);
  const green = parseInt(normalized.slice(2, 4), 16);
  const blue = parseInt(normalized.slice(4, 6), 16);

  return `rgba(${red}, ${green}, ${blue}, ${clamp01(opacity)})`;
};

export const isLightPalette = (palette: Palette): boolean => {
  const hex = (palette?.background || "#000000").replace("#", "");
  const r = parseInt(hex.slice(0, 2), 16) || 0;
  const g = parseInt(hex.slice(2, 4), 16) || 0;
  const b = parseInt(hex.slice(4, 6), 16) || 0;
  return (r * 299 + g * 587 + b * 114) / 1000 > 130;
};

export const isCyberPalette = (palette: Palette): boolean => {
  if (isLightPalette(palette)) return false;
  const bg = (palette?.background || "").toLowerCase();
  const accent = (palette?.accent || "").toLowerCase();
  return (
    bg === "#061018" ||
    bg === "#080318" ||
    bg === "#0a0f17" ||
    accent === "#51d0ff" ||
    accent === "#00f5d4" ||
    accent === "#63b8ff"
  );
};

export const formatDurationLabel = ({
  fps,
  durationInFrames,
}: {
  fps: number;
  durationInFrames: number;
}) => {
  const seconds = durationInFrames / fps;
  if (seconds >= 60) {
    return `${(seconds / 60).toFixed(1)} min`;
  }

  return `${seconds.toFixed(0)} s`;
};

// ---------------------------------------------------------------------------
// Art direction tokens (style DNA)
// ---------------------------------------------------------------------------

export type MotionEnergy = "low" | "medium" | "high";
export type DensityPreset = "airy" | "balanced" | "packed";

export type ArtDirectionTokens = {
  motionEnergy: MotionEnergy;
  density: DensityPreset;
  typography?: string;
};

export const DEFAULT_ART_DIRECTION: ArtDirectionTokens = {
  motionEnergy: "medium",
  density: "balanced",
};

export const ArtDirectionContext =
  React.createContext<ArtDirectionTokens>(DEFAULT_ART_DIRECTION);

export const useArtDirection = (): ArtDirectionTokens =>
  React.useContext(ArtDirectionContext);

/** Spring configs per motion energy. Higher energy = snappier, bouncier entrances. */
export const MOTION_SPRING_PRESETS: Record<
  MotionEnergy,
  { damping: number; stiffness: number }
> = {
  low: { damping: 24, stiffness: 85 },
  medium: { damping: 16, stiffness: 120 },
  high: { damping: 9, stiffness: 180 },
};

/** Layout breathing per density preset. */
export const DENSITY_PRESETS: Record<
  DensityPreset,
  { paddingY: number; paddingX: number; gap: number }
> = {
  airy: { paddingY: 84, paddingX: 64, gap: 44 },
  balanced: { paddingY: 60, paddingX: 48, gap: 22 },
  packed: { paddingY: 36, paddingX: 28, gap: 12 },
};

/** Font stacks addressable by artDirection.typography. */
export const TYPOGRAPHY_STACKS: Record<string, string> = {
  "serif-editorial":
    "'Playfair Display', 'Songti SC', 'STSong', Georgia, serif",
  "sans-modern": "'Inter', 'Segoe UI', 'PingFang SC', system-ui, sans-serif",
  "mono-tech": "'JetBrains Mono', 'Fira Code', 'SF Mono', monospace",
  "display-condensed":
    "'Barlow Condensed', 'Arial Narrow', 'PingFang SC', system-ui, sans-serif",
  "rounded-friendly":
    "'Nunito', 'PingFang SC', 'Helvetica Neue', system-ui, sans-serif",
};

export const useEntrance = (delayFrames = 0, damping?: number, stiffness?: number) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const art = useArtDirection();
  const preset =
    MOTION_SPRING_PRESETS[art.motionEnergy] ?? MOTION_SPRING_PRESETS.medium;

  return spring({
    frame: Math.max(0, frame - delayFrames),
    fps,
    config: {
      damping: damping ?? preset.damping,
      stiffness: stiffness ?? preset.stiffness,
      mass: 0.8,
    },
  });
};

export const sceneWindow = ({
  frame,
  start,
  end,
  fadeIn = 16,
  fadeOut = 18,
}: {
  frame: number;
  start: number;
  end: number;
  fadeIn?: number;
  fadeOut?: number;
}) => {
  const safeFadeIn = Math.max(1, fadeIn);
  const safeFadeOut = Math.max(1, fadeOut);
  const enter = interpolate(frame, [start, start + safeFadeIn], [0, 1], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });
  const exit = interpolate(frame, [end - safeFadeOut, end], [1, 0], {
    extrapolateLeft: "clamp",
    extrapolateRight: "clamp",
  });

  return Math.min(enter, exit);
};

/**
 * 基础背景容器 — 引擎只负责「把背景画出来」，不定义任何风格。
 *
 * `stageStyle` 是自由 CSS background 值（可多层渐变/颜色/图片），
 * 由 AI 或模板自行设计；未提供时仅用 palette 做最简两色渐变兜底。
 */
/**
 * AI 输出容错：把被误包成 `{ text|title|label|... }` 的字符串解包回字符串。
 * 引擎只做渲染，AI 输出形状不作强约束，因此在渲染前统一归一化，避免
 * React #31（对象当子元素）崩溃。
 */
const TEXT_KEYS = new Set([
  "text", "title", "label", "value", "caption", "name", "eyebrow",
  "subtext", "detail", "author", "role", "quote", "price", "originalPrice",
  "headline", "subtitle",
]);

export function normalizeAiValue(value: unknown): unknown {
  if (value == null || typeof value !== "object") return value;
  if (Array.isArray(value)) return value.map(normalizeAiValue);
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (
    keys.length === 1 &&
    TEXT_KEYS.has(keys[0]) &&
    typeof obj[keys[0]] === "string"
  ) {
    return obj[keys[0]];
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[k] = normalizeAiValue(v);
  return out;
}

export const GradientStage: React.FC<{
  palette: Palette;
  frame?: number;
  /** 自由 CSS background 值，引擎原样渲染 */
  stageStyle?: string;
  children?: React.ReactNode;
}> = ({ palette, stageStyle, children }) => {
  const css =
    typeof stageStyle === "string" ? stageStyle.trim().slice(0, 2000) : "";
  const looksLikeCss =
    css.length > 0 && /(gradient\(|#|rgb|hsl|url\()/i.test(css);
  const background = looksLikeCss
    ? css.replace(/[;{}<>]/g, "")
    : `linear-gradient(180deg, ${palette.background} 0%, ${palette.backgroundAlt} 100%)`;

  return (
    <AbsoluteFill style={{ background, overflow: "hidden" }}>
      {children}
    </AbsoluteFill>
  );
};
  // (引擎不再内置背景风格：背景由 AI 通过自由 CSS 或 custom-code 定义)

export const StageFrame: React.FC<{
  palette: Palette;
  radius?: number;
  padding?: number;
  children?: React.ReactNode;
  style?: React.CSSProperties;
}> = ({ palette, radius = 28, padding = 28, children, style }) => {
  const frame = useCurrentFrame();
  const isLight = isLightPalette(palette);
  const showCyberCorners = isCyberPalette(palette);
  const topSweep = Math.sin(frame / 34) * 12;
  const diagonalSweep = ((frame * 1.1) % 180) - 46;
  const microGridOffset = (frame * 0.7) % 120;
  const cornerPulse = 0.56 + ((Math.sin(frame / 24) + 1) / 2) * 0.28;

  const frameBorder = isLight
    ? `1px solid ${alpha(palette.text, 0.08)}`
    : `1px solid ${alpha("#ffffff", 0.12)}`;
  const frameBg = isLight
    ? `linear-gradient(180deg, #ffffff 0%, ${alpha(palette.surface, 0.96)} 100%)`
    : `linear-gradient(180deg, ${alpha("#ffffff", 0.12)} 0%, ${alpha(palette.surface, 0.74)} 100%)`;
  const frameShadow = isLight
    ? `0 20px 48px ${alpha(palette.text, 0.07)}, 0 4px 12px ${alpha(palette.text, 0.03)}`
    : `0 28px 80px ${alpha("#000000", 0.34)}, inset 0 1px 0 ${alpha("#ffffff", 0.12)}`;

  return (
    <div
      style={{
        position: "relative",
        borderRadius: radius,
        overflow: "hidden",
        padding,
        border: frameBorder,
        background: frameBg,
        boxShadow: frameShadow,
        backdropFilter: "blur(20px)",
        ...style,
      }}
    >
      <div
        style={{
          position: "absolute",
          inset: 1,
          borderRadius: Math.max(0, radius - 1),
          border: isLight
            ? `1px solid rgba(255,255,255,0.7)`
            : `1px solid ${alpha("#ffffff", 0.06)}`,
          pointerEvents: "none",
        }}
      />
      {!isLight && (
        <>
          <div
            style={{
              position: "absolute",
              inset: 0,
              backgroundImage: `repeating-linear-gradient(0deg, ${alpha("#ffffff", 0.022)} 0px, ${alpha("#ffffff", 0.022)} 1px, transparent 1px, transparent 6px), repeating-linear-gradient(90deg, ${alpha("#000000", 0.024)} 0px, ${alpha("#000000", 0.024)} 1px, transparent 1px, transparent 7px)`,
              backgroundPosition: `${microGridOffset}px ${microGridOffset / 2}px`,
              opacity: 0.22,
              mixBlendMode: "soft-light",
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: "6%",
              right: "14%",
              top: -42,
              height: 88,
              borderRadius: 999,
              background: `linear-gradient(90deg, transparent 0%, ${alpha("#ffffff", 0.16)} 24%, ${alpha("#ffffff", 0.04)} 52%, transparent 100%)`,
              transform: `translateX(${topSweep}px) rotate(-6deg)`,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "-18%",
              left: `${diagonalSweep}%`,
              width: "34%",
              height: "148%",
              background: `linear-gradient(90deg, transparent 0%, ${alpha("#ffffff", 0.14)} 50%, transparent 100%)`,
              transform: "rotate(16deg)",
              mixBlendMode: "screen",
              opacity: 0.2,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: `radial-gradient(circle at top right, ${alpha(palette.accentAlt, 0.18)} 0%, transparent 34%), radial-gradient(circle at bottom left, ${alpha(palette.accent, 0.12)} 0%, transparent 30%)`,
              pointerEvents: "none",
            }}
          />
        </>
      )}
      {showCyberCorners &&
        [
          { top: 14, left: 14, verticalOrigin: "top", horizontalOrigin: "left" },
          { top: 14, right: 14, verticalOrigin: "top", horizontalOrigin: "right" },
          { bottom: 14, left: 14, verticalOrigin: "bottom", horizontalOrigin: "left" },
          { bottom: 14, right: 14, verticalOrigin: "bottom", horizontalOrigin: "right" },
        ].map((corner, index) => (
          <div
            key={`frame-corner-${index}`}
            style={{
              position: "absolute",
              width: 26,
              height: 26,
              pointerEvents: "none",
              ...corner,
            }}
          >
            <div
              style={{
                position: "absolute",
                [corner.verticalOrigin]: 0,
                [corner.horizontalOrigin]: 0,
                width: 2,
                height: 24,
                borderRadius: 999,
                background: alpha(
                  index % 2 === 0 ? palette.accent : palette.accentAlt,
                  cornerPulse,
                ),
                boxShadow: `0 0 14px ${alpha(
                  index % 2 === 0 ? palette.accent : palette.accentAlt,
                  0.18,
                )}`,
              }}
            />
            <div
              style={{
                position: "absolute",
                [corner.verticalOrigin]: 0,
                [corner.horizontalOrigin]: 0,
                width: 24,
                height: 2,
                borderRadius: 999,
                background: alpha(
                  index % 2 === 0 ? palette.accentAlt : palette.accent,
                  cornerPulse,
                ),
                boxShadow: `0 0 14px ${alpha(
                  index % 2 === 0 ? palette.accentAlt : palette.accent,
                  0.18,
                )}`,
              }}
            />
          </div>
        ))}
      <div
        style={{
          position: "relative",
          zIndex: 2,
          display: "grid",
          gap: 0,
          height:
            typeof style?.height === "number" || typeof style?.height === "string"
              ? "100%"
              : undefined,
        }}
      >
        {children}
      </div>
    </div>
  );
};

export const TagPill: React.FC<{
  text: string;
  palette: Palette;
  light?: boolean;
}> = ({ text, palette, light = false }) => {
  const isLight = isLightPalette(palette);
  const pillBg = isLight
    ? alpha(palette.accent, 0.12)
    : light
      ? alpha("#ffffff", 0.16)
      : `linear-gradient(135deg, ${alpha(palette.accent, 0.95)} 0%, ${alpha(palette.accentAlt, 0.95)} 100%)`;
  const pillBorder = isLight
    ? `1px solid ${alpha(palette.accent, 0.28)}`
    : `1px solid ${alpha("#ffffff", light ? 0.18 : 0.1)}`;
  const pillColor = isLight ? palette.accent : light ? palette.text : "#0b1020";

  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 16px 10px 14px",
        borderRadius: 999,
        background: pillBg,
        border: pillBorder,
        boxShadow: isLight
          ? `0 4px 12px ${alpha(palette.accent, 0.12)}`
          : light
            ? `inset 0 1px 0 ${alpha("#ffffff", 0.12)}`
            : `0 14px 34px ${alpha(palette.accent, 0.24)}`,
        color: pillColor,
        fontWeight: 700,
        letterSpacing: "0.05em",
        fontSize: 20,
        textTransform: "uppercase",
      }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 999,
          background: isLight
            ? palette.accent
            : light
              ? alpha("#ffffff", 0.82)
              : alpha("#08111e", 0.76),
          boxShadow: isLight
            ? `0 0 10px ${alpha(palette.accent, 0.35)}`
            : light
              ? `0 0 14px ${alpha("#ffffff", 0.22)}`
              : `0 0 14px ${alpha("#08111e", 0.16)}`,
        }}
      />
      {text}
    </div>
  );
};

export const SectionEyebrow: React.FC<{
  text: string;
  palette: Palette;
}> = ({ text, palette }) => {
  const isLight = isLightPalette(palette);
  return (
    <div
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 12,
        fontSize: 21,
        letterSpacing: "0.28em",
        textTransform: "uppercase",
        color: isLight ? palette.accent : alpha(palette.text, 0.7),
        fontWeight: 700,
      }}
    >
      <span
        style={{
          width: 38,
          height: 2,
          background: isLight
            ? `linear-gradient(90deg, ${palette.accent} 0%, transparent 100%)`
            : `linear-gradient(90deg, ${alpha(palette.accentAlt, 0.78)} 0%, ${alpha("#ffffff", 0.06)} 100%)`,
        }}
      />
      {text}
    </div>
  );
};

export const MediaSurface: React.FC<{
  media: MediaSource;
  palette: Palette;
  radius?: number;
  frame?: number;
  style?: React.CSSProperties;
}> = ({ media, palette, radius = 24, frame = 0, style }) => {
  // Smooth cinematic Ken-Burns push-in
  const zoom = 1 + Math.min(0.14, (frame / 150) * 0.14);
  const translateX = Math.sin(frame / 60) * 8;
  const translateY = Math.cos(frame / 70) * 6;
  const sheenProgress = ((frame * 1.8) % 200) - 50;

  return (
    <div
      style={{
        position: "relative",
        overflow: "hidden",
        borderRadius: radius,
        background: `linear-gradient(135deg, ${alpha(palette.backgroundAlt, 0.95)} 0%, ${alpha(palette.surface, 0.95)} 100%)`,
        border: `2px solid ${alpha(palette.accent, 0.35)}`,
        boxShadow: `0 32px 90px ${alpha("#000000", 0.55)}, 0 8px 24px ${alpha(palette.glow, 0.15)}, inset 0 0 0 1px ${alpha("#ffffff", 0.12)}`,
        ...style,
      }}
    >
      {media.src ? (
        media.type === "video" ? (
          <OffthreadVideo
            src={media.src}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${zoom}) translate(${translateX}px, ${translateY}px)`,
            }}
          />
        ) : (
          <Img
            src={media.src}
            alt={media.alt}
            style={{
              width: "100%",
              height: "100%",
              objectFit: "cover",
              transform: `scale(${zoom}) translate(${translateX}px, ${translateY}px)`,
            }}
          />
        )
      ) : (
        <AbsoluteFill
          style={{
            background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
            alignItems: "center",
            justifyContent: "center",
            color: "#08111e",
            fontSize: 40,
            fontWeight: 700,
          }}
        >
          Upload Media
        </AbsoluteFill>
      )}

      {/* Glass shimmer sweep effect */}
      <div
        style={{
          position: "absolute",
          top: 0,
          left: `${sheenProgress}%`,
          width: "45%",
          height: "100%",
          background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.18) 50%, transparent 100%)",
          transform: "skewX(-25deg)",
          pointerEvents: "none",
        }}
      />

      {/* Gallery Piece Corner Label */}
      <div
        style={{
          position: "absolute",
          top: 14,
          right: 16,
          padding: "4px 10px",
          borderRadius: 6,
          background: "rgba(0,0,0,0.65)",
          backdropFilter: "blur(8px)",
          border: `1px solid ${alpha(palette.accent, 0.5)}`,
          color: palette.accent,
          fontSize: 12,
          fontWeight: 700,
          letterSpacing: 1.5,
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        ◆ ARTWORK
      </div>
    </div>
  );
};

export const MetricGrid: React.FC<{
  items: MetricItem[];
  palette: Palette;
  columns?: number;
}> = ({ items, palette, columns = 2 }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const safeColumns = Math.max(1, Math.min(4, columns));
  const activeMetricIndex =
    items.length > 0 ? Math.floor(frame / 42) % items.length : 0;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${safeColumns}, minmax(0, 1fr))`,
        gap: 18,
      }}
    >
      {items.map((item, index) => {
        const reveal = spring({
          frame: Math.max(0, frame - index * 4),
          fps,
          config: { damping: 16, stiffness: 118, mass: 0.82 },
        });
        const active = index === activeMetricIndex;

        return (
          <StageFrame
            key={`${item.label}-${index}`}
            palette={palette}
            radius={24}
            padding={22}
            style={{
              transform: `translateY(${mix(24, 0, reveal)}px) scale(${
                active ? 1.02 : mix(0.96, 1, reveal)
              })`,
              opacity: mix(0.4, 1, reveal),
              borderColor: active
                ? alpha(palette.accentAlt, 0.35)
                : isLightPalette(palette)
                  ? alpha(palette.text, 0.08)
                  : alpha("#ffffff", 0.12),
            }}
          >
            <div
              style={{
                fontSize: 18,
                color: active
                  ? alpha(palette.accentAlt, 0.92)
                  : alpha(palette.text, 0.64),
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                marginBottom: 12,
                fontWeight: active ? 800 : 700,
              }}
            >
              {item.label}
            </div>
            <div
              style={{
                fontSize: 40,
                fontWeight: 800,
                color: palette.text,
                marginBottom: item.detail ? 8 : 0,
                fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
                fontVariantNumeric: "tabular-nums",
                transform: `translateY(${mix(12, 0, reveal)}px)`,
              }}
            >
              {item.value}
            </div>
            {item.detail ? (
              <div
                style={{
                  fontSize: 18,
                  color: alpha(palette.text, active ? 0.82 : 0.74),
                  lineHeight: 1.5,
                }}
              >
                {item.detail}
              </div>
            ) : null}
          </StageFrame>
        );
      })}
    </div>
  );
};

export const FeatureStack: React.FC<{
  items: FeatureItem[];
  palette: Palette;
}> = ({ items, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isLight = isLightPalette(palette);
  const activeIndex = items.length > 0 ? Math.floor(frame / 48) % items.length : 0;

  return (
    <div style={{ display: "grid", gap: 16 }}>
      {items.map((item, index) => {
        const reveal = spring({
          frame: Math.max(0, frame - index * 5),
          fps,
          config: { damping: 16, stiffness: 112, mass: 0.84 },
        });
        const active = index === activeIndex;

        return (
          <StageFrame
            key={`${item.title}-${index}`}
            palette={palette}
            radius={26}
            padding={24}
            style={{
              transform: `translateY(${mix(26, 0, reveal)}px) scale(${
                active ? 1.015 : mix(0.97, 1, reveal)
              })`,
              opacity: mix(0.42, 1, reveal),
              borderColor: active
                ? alpha(palette.accentAlt, 0.35)
                : isLight
                  ? alpha(palette.text, 0.08)
                  : alpha("#ffffff", 0.12),
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 10,
              }}
            >
              {item.eyebrow ? (
                <div
                  style={{
                    fontSize: 18,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    color: alpha(palette.accentAlt, active ? 0.98 : 0.92),
                    fontWeight: 700,
                  }}
                >
                  {item.eyebrow}
                </div>
              ) : <div />}
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  display: "grid",
                  placeItems: "center",
                  background: active
                    ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                    : isLight
                      ? alpha(palette.text, 0.06)
                      : alpha("#ffffff", 0.08),
                  color: active ? "#ffffff" : palette.text,
                  fontSize: 13,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  boxShadow: active
                    ? `0 0 18px ${alpha(palette.accent, 0.2)}`
                    : "none",
                }}
              >
                {String(index + 1).padStart(2, "0")}
              </div>
            </div>
            <div
              style={{
                fontSize: 32,
                fontWeight: 800,
                color: palette.text,
                marginBottom: 10,
                lineHeight: 1.15,
              }}
            >
              {item.title}
            </div>
            <div
              style={{
                fontSize: 20,
                lineHeight: 1.55,
                color: alpha(palette.text, active ? 0.84 : 0.78),
              }}
            >
              {item.text}
            </div>
          </StageFrame>
        );
      })}
    </div>
  );
};

export const ProgressBarRow: React.FC<{
  items: Array<{ label: string; value: number; color?: string }>;
  palette: Palette;
}> = ({ items, palette }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const isLight = isLightPalette(palette);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      {items.map((item, index) => {
        const reveal = spring({
          frame: Math.max(0, frame - index * 4),
          fps,
          config: { damping: 15, stiffness: 120, mass: 0.84 },
        });

        return (
          <div
            key={`${item.label}-${index}`}
            style={{
              display: "grid",
              gap: 10,
              padding: "10px 12px 12px",
              borderRadius: 20,
              background: isLight ? alpha(palette.text, 0.035) : alpha("#ffffff", 0.05),
              border: `1px solid ${isLight ? alpha(palette.text, 0.06) : alpha("#ffffff", 0.06)}`,
              transform: `translateY(${mix(18, 0, reveal)}px)`,
              opacity: mix(0.4, 1, reveal),
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                color: palette.text,
                fontSize: 20,
              }}
            >
              <span>{item.label}</span>
              <span>{Math.round(item.value)}%</span>
            </div>
            <div
              style={{
                height: 12,
                borderRadius: 999,
                background: isLight ? alpha(palette.text, 0.08) : alpha("#ffffff", 0.12),
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: `${clamp01(item.value / 100) * reveal * 100}%`,
                  borderRadius: 999,
                  background: item.color
                    ? item.color
                    : `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                  boxShadow: `0 0 16px ${alpha(item.color || palette.accent, 0.28)}`,
                }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
};

export const FooterNote: React.FC<{
  left: string;
  right: string;
  palette: Palette;
}> = ({ left, right, palette }) => {
  return (
    <div
      style={{
        position: "absolute",
        left: 48,
        right: 48,
        bottom: 32,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        color: alpha(palette.text, 0.66),
        fontSize: 18,
        letterSpacing: "0.08em",
        textTransform: "uppercase",
        paddingTop: 14,
        borderTop: `1px solid ${alpha("#ffffff", 0.08)}`,
      }}
    >
      <span>{left}</span>
      <span>{right}</span>
    </div>
  );
};
