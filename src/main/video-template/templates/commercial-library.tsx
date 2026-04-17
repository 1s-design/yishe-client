import React from "react";
import { z } from "zod";
import {
  AbsoluteFill,
  interpolate,
  spring,
  useCurrentFrame,
  useVideoConfig,
} from "remotion";
import {
  FeatureStack,
  FooterNote,
  GradientStage,
  MediaSurface,
  MetricGrid,
  ProgressBarRow,
  SectionEyebrow,
  StageFrame,
  TagPill,
  alpha,
  clamp01,
  formatDurationLabel,
  mix,
  sceneWindow,
} from "./shared";

const paletteSchema = z.object({
  background: z.string(),
  backgroundAlt: z.string(),
  surface: z.string(),
  text: z.string(),
  mutedText: z.string(),
  accent: z.string(),
  accentAlt: z.string(),
  glow: z.string(),
});

const mediaSchema = z.object({
  type: z.enum(["image", "video"]),
  src: z.string(),
  poster: z.string().optional(),
  alt: z.string().optional(),
});

const metricSchema = z.object({
  label: z.string(),
  value: z.string(),
  detail: z.string().optional(),
});

const featureSchema = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  text: z.string(),
});

const chapterSchema = z.object({
  eyebrow: z.string(),
  title: z.string(),
  body: z.string(),
  caption: z.string(),
  media: mediaSchema,
});

const panelSchema = z.object({
  eyebrow: z.string().optional(),
  title: z.string(),
  text: z.string(),
  media: mediaSchema,
});

const testimonialSchema = z.object({
  quote: z.string(),
  author: z.string(),
  role: z.string(),
  score: z.string(),
  media: mediaSchema.optional(),
});

const milestoneSchema = z.object({
  label: z.string(),
  title: z.string(),
  text: z.string(),
  media: mediaSchema,
});

const barSchema = z.object({
  label: z.string(),
  value: z.number().min(0).max(100),
  color: z.string().optional(),
});

const leftRightPanelSchema = z.object({
  eyebrow: z.string(),
  title: z.string(),
  summary: z.string(),
  media: mediaSchema,
  points: z.array(z.string()).min(2).max(5),
  score: z.string(),
});

const metricColumns = (width: number) => {
  if (width >= 1600) {
    return 3;
  }

  if (width >= 1000) {
    return 2;
  }

  return 1;
};

const pad2 = (value: number) => String(value).padStart(2, "0");

const formatTimecode = (seconds: number) => {
  const safeSeconds = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safeSeconds / 60);
  const remainder = safeSeconds % 60;
  return `${pad2(minutes)}:${pad2(remainder)}`;
};

const extractLeadingNumber = (value: string) => {
  const matched = value.match(/-?\d+(\.\d+)?/);
  return matched ? Number(matched[0]) : null;
};

const sequencePhaseLabels = ["Hook", "Setup", "Proof", "Turn", "Payoff"];

const renderWaveBars = ({
  frame,
  palette,
  bars = 10,
  width = 6,
  minHeight = 8,
  maxHeight = 26,
}: {
  frame: number;
  palette: z.infer<typeof paletteSchema>;
  bars?: number;
  width?: number;
  minHeight?: number;
  maxHeight?: number;
}) => {
  return (
    <div style={{ display: "flex", alignItems: "end", gap: Math.max(3, width - 2) }}>
      {Array.from({ length: bars }).map((_, index) => {
        const oscillation = (Math.sin(frame / 4 + index * 0.9) + 1) / 2;
        const barHeight = mix(minHeight, maxHeight, oscillation);

        return (
          <div
            key={`wave-${index}`}
            style={{
              width,
              height: barHeight,
              borderRadius: 999,
              background:
                index % 3 === 0
                  ? palette.accentAlt
                  : `linear-gradient(180deg, ${alpha("#ffffff", 0.88)} 0%, ${palette.accent} 100%)`,
              boxShadow: `0 0 12px ${alpha(palette.accent, 0.2)}`,
              opacity: 0.92,
            }}
          />
        );
      })}
    </div>
  );
};

const renderSignalDots = ({
  count,
  activeCount,
  palette,
}: {
  count: number;
  activeCount: number;
  palette: z.infer<typeof paletteSchema>;
}) => {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      {Array.from({ length: count }).map((_, index) => {
        const active = index < activeCount;

        return (
          <div
            key={`dot-${index}`}
            style={{
              width: active ? 28 : 10,
              height: 10,
              borderRadius: 999,
              background: active
                ? `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                : alpha("#ffffff", 0.16),
              boxShadow: active
                ? `0 0 16px ${alpha(palette.accent, 0.2)}`
                : "none",
            }}
          />
        );
      })}
    </div>
  );
};

const renderProgressTrack = ({
  progress,
  palette,
  leftLabel,
  rightLabel,
  height = 6,
}: {
  progress: number;
  palette: z.infer<typeof paletteSchema>;
  leftLabel?: string;
  rightLabel?: string;
  height?: number;
}) => {
  return (
    <div style={{ display: "grid", gap: 10 }}>
      {leftLabel || rightLabel ? (
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 12,
            flexWrap: "wrap",
          }}
        >
          <div
            style={{
              color: alpha(palette.text, 0.48),
              fontSize: 15,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {leftLabel}
          </div>
          <div
            style={{
              color: palette.text,
              fontSize: 15,
              letterSpacing: "0.12em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {rightLabel}
          </div>
        </div>
      ) : null}
      <div
        style={{
          height,
          borderRadius: 999,
          background: alpha("#ffffff", 0.08),
          overflow: "hidden",
        }}
      >
        <div
          style={{
            width: `${clamp01(progress) * 100}%`,
            height: "100%",
            borderRadius: 999,
            background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
            boxShadow: `0 0 16px ${alpha(palette.accent, 0.22)}`,
          }}
        />
      </div>
    </div>
  );
};

const renderBulletPoints = ({
  items,
  palette,
  size = 20,
}: {
  items: string[];
  palette: z.infer<typeof paletteSchema>;
  size?: number;
}) => {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      {items.map((point, index) => (
        <div
          key={`${point}-${index}`}
          style={{
            display: "grid",
            gridTemplateColumns: "18px minmax(0, 1fr)",
            gap: 14,
            alignItems: "start",
          }}
        >
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              marginTop: 8,
              background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
              boxShadow: `0 0 18px ${alpha(palette.accent, 0.42)}`,
            }}
          />
          <div
            style={{
              fontSize: size,
              color: alpha(palette.text, 0.82),
              lineHeight: 1.5,
            }}
          >
            {point}
          </div>
        </div>
      ))}
    </div>
  );
};

export const luxurySpotlightSchema = z.object({
  palette: paletteSchema,
  media: mediaSchema,
  eyebrow: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  price: z.string(),
  cta: z.string(),
  badges: z.array(z.string()).min(2).max(6),
  metrics: z.array(metricSchema).min(2).max(4),
  features: z.array(featureSchema).min(2).max(4),
  quote: z.string(),
});

export const LuxurySpotlightTemplate: React.FC<
  z.infer<typeof luxurySpotlightSchema>
> = ({
  palette,
  media,
  eyebrow,
  headline,
  subheadline,
  price,
  cta,
  badges,
  metrics,
  features,
  quote,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const hero = spring({
    frame,
    fps,
    config: { damping: 16, stiffness: 110, mass: 0.8 },
  });
  const panelWindow = sceneWindow({
    frame,
    start: 40,
    end: durationInFrames - 24,
    fadeIn: 24,
    fadeOut: 20,
  });
  const closingWindow = sceneWindow({
    frame,
    start: durationInFrames - 90,
    end: durationInFrames,
    fadeIn: 18,
    fadeOut: 18,
  });
  const mediaTilt = mix(10, 0, hero) + Math.sin(frame / 28) * 1.5;
  const activeBadgeIndex = Math.min(
    badges.length - 1,
    Math.floor((frame / durationInFrames) * badges.length),
  );
  const spotlightProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const activeFeatureIndex = Math.min(
    features.length - 1,
    Math.floor((frame / durationInFrames) * features.length),
  );
  const currentFeature = features[activeFeatureIndex] ?? features[0];
  const mediaReveal = clamp01((frame - 6) / 22);

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          top: height * 0.16,
          left: -width * 0.18,
          width: width * 0.82,
          height: 84,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            palette.accentAlt,
            0.18,
          )} 30%, ${alpha(palette.accent, 0.34)} 54%, transparent 100%)`,
          transform: `translateX(${Math.sin(frame / 20) * 36}px) rotate(-18deg)`,
          filter: "blur(6px)",
          opacity: 0.82,
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -width * 0.14,
          bottom: height * 0.18,
          width: width * 0.68,
          height: 60,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            "#ffffff",
            0.06,
          )} 28%, ${alpha(palette.accentAlt, 0.22)} 54%, transparent 100%)`,
          transform: `translateX(${Math.cos(frame / 22) * 28}px) rotate(12deg)`,
          opacity: 0.78,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 56,
          display: "grid",
          gridTemplateColumns: width > height ? "1.05fr 0.95fr" : "1fr",
          gap: 34,
        }}
      >
        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: 20,
            transform: `translateY(${mix(48, 0, hero)}px)`,
            opacity: hero,
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 14,
              flexWrap: "wrap",
            }}
          >
            <TagPill text={eyebrow} palette={palette} light />
            <div
              style={{
                color: alpha(palette.text, 0.62),
                fontSize: 16,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Curated Drop / {formatTimecode(frame / fps)}
            </div>
          </div>
          <div
            style={{
              fontSize: width > height ? 106 : 88,
              lineHeight: 0.95,
              color: palette.text,
              fontWeight: 800,
              letterSpacing: "-0.045em",
              fontFamily: "Georgia, Baskerville, serif",
              textTransform: "uppercase",
            }}
          >
            {headline}
          </div>
          <div
            style={{
              fontSize: 28,
              lineHeight: 1.55,
              color: alpha(palette.text, 0.76),
              maxWidth: 760,
            }}
          >
            {subheadline}
          </div>
          <StageFrame palette={palette} radius={24} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    color: alpha(palette.text, 0.52),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Edition status
                </div>
                {renderSignalDots({
                  count: badges.length,
                  activeCount: activeBadgeIndex + 1,
                  palette,
                })}
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 24,
                    fontWeight: 800,
                  }}
                >
                  {pad2(activeBadgeIndex + 1)} / {pad2(badges.length)}
                </div>
                <div
                  style={{
                    color: alpha(palette.text, 0.48),
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {badges[activeBadgeIndex]}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {renderProgressTrack({
                progress: spotlightProgress,
                palette,
                leftLabel: "showcase momentum",
                rightLabel: `${Math.round(spotlightProgress * 100)}%`,
              })}
            </div>
          </StageFrame>
          <div
            style={{
              display: "flex",
              flexWrap: "wrap",
              gap: 14,
              alignItems: "center",
            }}
          >
            <div
              style={{
                padding: "16px 26px",
                borderRadius: 18,
                background: `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                color: "#08111e",
                fontSize: 36,
                fontWeight: 900,
                letterSpacing: "-0.03em",
                boxShadow: `0 18px 42px ${alpha(palette.accent, 0.34)}`,
              }}
            >
              {price}
            </div>
            <div
              style={{
                color: palette.text,
                fontSize: 20,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {cta}
            </div>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
            {badges.map((badge, index) => (
              <TagPill key={`${badge}-${index}`} text={badge} palette={palette} />
            ))}
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "grid",
            alignItems: "center",
            justifyItems: "stretch",
            opacity: panelWindow,
            transform: `translateY(${mix(64, 0, panelWindow)}px)`,
          }}
        >
          <MediaSurface
            media={media}
            palette={palette}
            frame={frame}
            style={{
              height: width > height ? height - 210 : height * 0.42,
              clipPath: `polygon(${mix(100, 0, mediaReveal)}% 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${mix(
                100,
                0,
                mediaReveal,
              )}%)`,
              transform: `perspective(1800px) rotateY(${-mediaTilt}deg) rotateX(${mediaTilt / 3}deg) scale(${mix(0.92, 1, panelWindow)})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: width > height ? -18 : 18,
              top: width > height ? 44 : 20,
              width: width > height ? "44%" : "76%",
              opacity: panelWindow,
              transform: `translate(${mix(-36, 0, panelWindow)}px, ${mix(
                28,
                0,
                panelWindow,
              )}px)`,
            }}
          >
            <StageFrame palette={palette} radius={24} padding={20}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                  marginBottom: 12,
                }}
              >
                <SectionEyebrow
                  text={currentFeature?.eyebrow || "Feature Focus"}
                  palette={palette}
                />
                {renderWaveBars({
                  frame: frame + activeFeatureIndex * 6,
                  palette,
                  bars: 6,
                  width: 4,
                  minHeight: 7,
                  maxHeight: 18,
                })}
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 28,
                  lineHeight: 1.18,
                  fontWeight: 800,
                }}
              >
                {currentFeature?.title}
              </div>
              <div
                style={{
                  marginTop: 10,
                  color: alpha(palette.text, 0.74),
                  fontSize: 18,
                  lineHeight: 1.55,
                }}
              >
                {currentFeature?.text}
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: (activeFeatureIndex + 1) / features.length,
                  palette,
                  leftLabel: "detail reveal",
                  rightLabel: `${pad2(activeFeatureIndex + 1)} / ${pad2(
                    features.length,
                  )}`,
                })}
              </div>
            </StageFrame>
          </div>
          <div
            style={{
              position: "absolute",
              right: -20,
              bottom: 24,
              width: "56%",
            }}
          >
            <StageFrame palette={palette} radius={28} padding={24}>
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
                <div
                  style={{
                    color: alpha(palette.text, 0.62),
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  Editorial Note
                </div>
                <TagPill
                  text={`${pad2(activeBadgeIndex + 1)} / ${pad2(badges.length)}`}
                  palette={palette}
                />
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 28,
                  fontWeight: 700,
                  lineHeight: 1.35,
                  fontFamily: "Georgia, Baskerville, serif",
                }}
              >
                {quote}
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: spotlightProgress,
                  palette,
                  leftLabel: "collector attention",
                  rightLabel: badges[activeBadgeIndex],
                })}
              </div>
            </StageFrame>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          bottom: 92,
          display: "grid",
          gridTemplateColumns: width > height ? "1fr 1fr" : "1fr",
          gap: 24,
          opacity: panelWindow,
          transform: `translateY(${mix(42, 0, panelWindow)}px)`,
        }}
      >
        <MetricGrid
          items={metrics}
          palette={palette}
          columns={metricColumns(width)}
        />
        <FeatureStack items={features} palette={palette} />
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, transparent 0%, transparent 72%, ${alpha(palette.background, 0.68)} 100%)`,
          opacity: closingWindow,
          pointerEvents: "none",
        }}
      />
      <FooterNote
        left={quote}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const flashSaleBurstSchema = z.object({
  palette: paletteSchema,
  media: mediaSchema,
  countdownLabel: z.string(),
  headline: z.string(),
  subheadline: z.string(),
  salePrice: z.string(),
  originalPrice: z.string(),
  couponCode: z.string(),
  perks: z.array(z.string()).min(2).max(5),
  cta: z.string(),
});

export const FlashSaleBurstTemplate: React.FC<
  z.infer<typeof flashSaleBurstSchema>
> = ({
  palette,
  media,
  countdownLabel,
  headline,
  subheadline,
  salePrice,
  originalPrice,
  couponCode,
  perks,
  cta,
}) => {
  const frame = useCurrentFrame();
  const { fps, width, height, durationInFrames } = useVideoConfig();
  const slam = spring({
    frame,
    fps,
    config: { damping: 12, stiffness: 180, mass: 0.7 },
  });
  const pricePulse = 1 + Math.sin(frame / 5) * 0.03;
  const tickerOffset = (frame * 18) % 520;
  const outro = sceneWindow({
    frame,
    start: durationInFrames - 72,
    end: durationInFrames,
    fadeIn: 16,
    fadeOut: 18,
  });
  const campaignProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const activePerkIndex = Math.min(
    perks.length - 1,
    Math.floor((frame / durationInFrames) * perks.length),
  );
  const activePerk = perks[activePerkIndex] ?? perks[0];
  const mediaReveal = clamp01((frame - 4) / 18);
  const priceShock = spring({
    frame: Math.max(0, frame - 8),
    fps,
    config: { damping: 12, stiffness: 150, mass: 0.85 },
  });

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          top: 46,
          left: -180 + frame * 6,
          width: width + 360,
          height: 86,
          background: `linear-gradient(90deg, ${alpha(palette.accent, 0.92)} 0%, ${alpha(palette.accentAlt, 0.92)} 100%)`,
          transform: "rotate(-5deg)",
          opacity: 0.92,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 128,
          left: -160 - frame * 5,
          width: width + 320,
          height: 64,
          background: alpha("#ffffff", 0.08),
          transform: "rotate(4deg)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 54,
          display: "grid",
          gridTemplateColumns: width > height ? "1fr 0.9fr" : "1fr",
          gap: 28,
        }}
      >
        <div style={{ display: "grid", alignContent: "space-between" }}>
          <div style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <TagPill text={countdownLabel} palette={palette} />
              <div
                style={{
                  color: alpha(palette.text, 0.68),
                  fontSize: 16,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Flash Window / {formatTimecode(frame / fps)}
              </div>
            </div>
            <div
              style={{
                fontSize: width > height ? 118 : 92,
                lineHeight: 0.86,
                letterSpacing: "-0.055em",
                fontWeight: 900,
                color: palette.text,
                fontFamily: "'Arial Black', Impact, sans-serif",
                textTransform: "uppercase",
                transform: `translateX(${mix(-70, 0, slam)}px) skewX(${mix(-10, 0, slam)}deg)`,
                opacity: slam,
              }}
            >
              {headline}
            </div>
            <div
              style={{
                fontSize: 28,
                color: alpha(palette.text, 0.74),
                lineHeight: 1.45,
                maxWidth: 720,
                opacity: slam,
              }}
            >
              {subheadline}
            </div>
            <StageFrame palette={palette} radius={24} padding={18}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      color: alpha(palette.text, 0.5),
                      fontSize: 15,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Urgency track
                  </div>
                  {renderSignalDots({
                    count: perks.length,
                    activeCount: activePerkIndex + 1,
                    palette,
                  })}
                </div>
                <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                  <div
                    style={{
                      color: palette.text,
                      fontSize: 22,
                      fontWeight: 800,
                    }}
                  >
                    {pad2(activePerkIndex + 1)} / {pad2(perks.length)}
                  </div>
                  <div
                    style={{
                      color: alpha(palette.text, 0.48),
                      fontSize: 14,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    {perks[activePerkIndex]}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: campaignProgress,
                  palette,
                  leftLabel: "sale momentum",
                  rightLabel: `${Math.round(campaignProgress * 100)}%`,
                })}
              </div>
            </StageFrame>
          </div>

          <div
            style={{
              display: "grid",
              gap: 16,
              transform: `translateY(${mix(42, 0, slam)}px)`,
              opacity: slam,
            }}
          >
            <div style={{ position: "relative" }}>
              <div
                style={{
                  position: "absolute",
                  left: 18,
                  top: 18,
                  width: 220,
                  height: 220,
                  borderRadius: "50%",
                  border: `1px solid ${alpha(palette.accentAlt, 0.2)}`,
                  transform: `scale(${mix(0.72, 1.18, priceShock)})`,
                  opacity: mix(0, 0.54, priceShock),
                  pointerEvents: "none",
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 42,
                  top: 42,
                  width: 172,
                  height: 172,
                  borderRadius: "50%",
                  border: `1px solid ${alpha(palette.accent, 0.18)}`,
                  transform: `scale(${mix(0.8, 1.26, priceShock)})`,
                  opacity: mix(0, 0.44, priceShock),
                  pointerEvents: "none",
                }}
              />
              <StageFrame palette={palette} radius={28} padding={26}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                    marginBottom: 12,
                  }}
                >
                  <SectionEyebrow text="Offer Core" palette={palette} />
                  {renderWaveBars({
                    frame,
                    palette,
                    bars: 7,
                    width: 4,
                    minHeight: 8,
                    maxHeight: 18,
                  })}
                </div>
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    gap: 18,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      fontSize: 86,
                      fontWeight: 900,
                      color: palette.text,
                      transform: `scale(${pricePulse})`,
                      transformOrigin: "left center",
                    }}
                  >
                    {salePrice}
                  </div>
                  <div
                    style={{
                      fontSize: 32,
                      color: alpha(palette.text, 0.42),
                      textDecoration: "line-through",
                      fontWeight: 700,
                    }}
                  >
                    {originalPrice}
                  </div>
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: "grid",
                    gap: 10,
                  }}
                >
                  {perks.map((perk, index) => (
                    <div
                      key={`${perk}-${index}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "34px minmax(0, 1fr)",
                        gap: 12,
                        alignItems: "center",
                        padding: "10px 14px",
                        borderRadius: 18,
                        background:
                          index === activePerkIndex
                            ? alpha("#ffffff", 0.1)
                            : alpha("#ffffff", 0.05),
                        border: `1px solid ${
                          index === activePerkIndex
                            ? alpha(palette.accentAlt, 0.2)
                            : alpha("#ffffff", 0.06)
                        }`,
                        color:
                          index === activePerkIndex
                            ? palette.text
                            : alpha(palette.text, 0.68),
                        fontSize: 19,
                        fontWeight: index === activePerkIndex ? 800 : 700,
                      }}
                    >
                      <div
                        style={{
                          width: 28,
                          height: 28,
                          borderRadius: 999,
                          display: "grid",
                          placeItems: "center",
                          background:
                            index === activePerkIndex
                              ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                              : alpha("#ffffff", 0.08),
                          color: index === activePerkIndex ? "#08111e" : palette.text,
                          fontSize: 13,
                          letterSpacing: "0.12em",
                          fontWeight: 800,
                        }}
                      >
                        {pad2(index + 1)}
                      </div>
                      <div>{perk}</div>
                    </div>
                  ))}
                </div>
                <div
                  style={{
                    marginTop: 16,
                    padding: "12px 14px",
                    borderRadius: 18,
                    background: alpha("#ffffff", 0.06),
                    border: `1px solid ${alpha("#ffffff", 0.08)}`,
                    clipPath:
                      "polygon(0 0, calc(100% - 18px) 0, 100% 50%, calc(100% - 18px) 100%, 0 100%, 12px 50%)",
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        color: alpha(palette.text, 0.54),
                        fontSize: 14,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      Live coupon focus
                    </div>
                    <TagPill text={`Code ${couponCode}`} palette={palette} light />
                  </div>
                  <div
                    style={{
                      marginTop: 8,
                      color: palette.text,
                      fontSize: 22,
                      fontWeight: 800,
                      lineHeight: 1.25,
                    }}
                  >
                    {activePerk}
                  </div>
                </div>
                <div style={{ marginTop: 16 }}>
                  {renderProgressTrack({
                    progress: campaignProgress,
                    palette,
                    leftLabel: "checkout pressure",
                    rightLabel: `Code ${couponCode}`,
                  })}
                </div>
              </StageFrame>
            </div>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
              }}
            >
              <TagPill text={`Code ${couponCode}`} palette={palette} light />
              <div
                style={{
                  color: palette.text,
                  fontSize: 24,
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  fontWeight: 800,
                }}
              >
                {cta}
              </div>
            </div>
          </div>
        </div>

        <div
          style={{
            position: "relative",
            display: "grid",
            alignItems: "stretch",
            clipPath: `polygon(${mix(100, 0, mediaReveal)}% 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${mix(
              100,
              0,
              mediaReveal,
            )}%)`,
          }}
        >
          <MediaSurface
            media={media}
            palette={palette}
            frame={frame}
            style={{
              height: "100%",
              minHeight: width > height ? height - 108 : height * 0.36,
              transform: `perspective(1600px) rotateZ(${mix(7, -2, slam)}deg) scale(${mix(0.84, 1.02, slam)})`,
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 18,
              right: 18,
              top: 18,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <TagPill text="Offer Preview" palette={palette} />
            <div
              style={{
                color: alpha(palette.text, 0.68),
                fontSize: 15,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {salePrice} / {couponCode}
            </div>
          </div>
          <div
            style={{
              position: "absolute",
              right: 22,
              bottom: 22,
              width: width > height ? "46%" : "72%",
              transform: `translateY(${mix(36, 0, slam)}px)`,
              opacity: slam,
            }}
          >
            <StageFrame palette={palette} radius={24} padding={18}>
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
                <SectionEyebrow text="Current Push" palette={palette} />
                <TagPill
                  text={`${pad2(activePerkIndex + 1)} / ${pad2(perks.length)}`}
                  palette={palette}
                />
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 24,
                  lineHeight: 1.28,
                  fontWeight: 800,
                }}
              >
                {activePerk}
              </div>
              <div style={{ marginTop: 12 }}>
                {renderProgressTrack({
                  progress: (activePerkIndex + 1) / perks.length,
                  palette,
                  leftLabel: "perk rotation",
                  rightLabel: couponCode,
                })}
              </div>
            </StageFrame>
          </div>
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: -tickerOffset,
          right: -tickerOffset,
          bottom: 24,
          display: "flex",
          gap: 18,
          whiteSpace: "nowrap",
          color: alpha(palette.text, 0.9),
          fontSize: 26,
          fontWeight: 800,
          letterSpacing: "0.14em",
          textTransform: "uppercase",
        }}
      >
        {Array.from({ length: 10 }).map((_, index) => (
          <span key={index}>
            {couponCode} • {headline} • {cta}
          </span>
        ))}
      </div>

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: alpha("#000000", 0.24),
          opacity: outro,
          pointerEvents: "none",
        }}
      />
      <FooterNote
        left={countdownLabel}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const comparisonSplitSchema = z.object({
  palette: paletteSchema,
  title: z.string(),
  subtitle: z.string(),
  left: leftRightPanelSchema,
  right: leftRightPanelSchema,
  verdictTitle: z.string(),
  verdictText: z.string(),
  verdictCta: z.string(),
  metrics: z.array(barSchema).min(3).max(5),
});

export const ComparisonSplitTemplate: React.FC<
  z.infer<typeof comparisonSplitSchema>
> = ({
  palette,
  title,
  subtitle,
  left,
  right,
  verdictTitle,
  verdictText,
  verdictCta,
  metrics,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const leftScoreValue = extractLeadingNumber(left.score);
  const rightScoreValue = extractLeadingNumber(right.score);
  const divider = mix(
    0.38,
    0.54,
    spring({
      frame: Math.max(0, frame - 18),
      fps,
      config: { damping: 16, stiffness: 120 },
    }),
  );
  const metricsWindow = sceneWindow({
    frame,
    start: 58,
    end: durationInFrames - 26,
    fadeIn: 18,
    fadeOut: 18,
  });
  const verdictWindow = sceneWindow({
    frame,
    start: durationInFrames - 110,
    end: durationInFrames,
    fadeIn: 18,
    fadeOut: 18,
  });
  const comparisonProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const scoreDeltaLabel =
    leftScoreValue !== null && rightScoreValue !== null
      ? `${(rightScoreValue - leftScoreValue).toFixed(1)} point lift`
      : "visual lift";
  const activeMetricIndex = Math.min(
    metrics.length - 1,
    Math.floor((frame / durationInFrames) * metrics.length),
  );
  const activeMetric = metrics[activeMetricIndex] ?? metrics[0];
  const dividerSweep = ((frame * 1.6) % Math.max(260, height * 0.82)) - 80;

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          inset: 46,
          display: "grid",
          gap: 20,
          gridTemplateRows: "auto minmax(0, 1fr) auto",
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <SectionEyebrow text="Comparison Edit" palette={palette} />
          <div
            style={{
              color: palette.text,
              fontSize: width > height ? 92 : 74,
              fontWeight: 800,
              letterSpacing: "-0.05em",
              lineHeight: 0.95,
            }}
          >
            {title}
          </div>
          <div
            style={{
              color: alpha(palette.text, 0.74),
              fontSize: 26,
              lineHeight: 1.45,
              maxWidth: 980,
            }}
          >
            {subtitle}
          </div>
          <StageFrame palette={palette} radius={24} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    color: alpha(palette.text, 0.5),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Compare status
                </div>
                {renderSignalDots({
                  count: 2,
                  activeCount: 2,
                  palette,
                })}
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  {scoreDeltaLabel}
                </div>
                <div
                  style={{
                    color: alpha(palette.text, 0.46),
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {left.score} to {right.score}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {renderProgressTrack({
                progress: comparisonProgress,
                palette,
                leftLabel: "analysis progress",
                rightLabel: `${Math.round(divider * 100)} / ${Math.round((1 - divider) * 100)}`,
              })}
            </div>
          </StageFrame>
        </div>

        <div style={{ position: "relative", minHeight: 0 }}>
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "grid",
              gridTemplateColumns: `${divider}fr ${1 - divider}fr`,
              gap: 18,
            }}
          >
            <MediaSurface
              media={left.media}
              palette={palette}
              frame={frame}
              style={{
                height: "100%",
                clipPath: "polygon(0% 0%, 100% 0%, 88% 100%, 0% 100%)",
              }}
            />
            <MediaSurface
              media={right.media}
              palette={palette}
              frame={frame}
              style={{
                height: "100%",
                clipPath: "polygon(12% 0%, 100% 0%, 100% 100%, 0% 100%)",
              }}
            />
          </div>

          <div
            style={{
              position: "absolute",
              left: 22,
              right: 22,
              top: 20,
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <TagPill text={left.eyebrow} palette={palette} />
            <div
              style={{
                color: alpha(palette.text, 0.62),
                fontSize: 15,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              {formatTimecode(frame / fps)}
            </div>
            <TagPill text={right.eyebrow} palette={palette} />
          </div>

          <div
            style={{
              position: "absolute",
              left: `${divider * 100}%`,
              top: -18,
              bottom: -18,
              width: 6,
              background: `linear-gradient(180deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
              borderRadius: 999,
              boxShadow: `0 0 28px ${alpha(palette.accent, 0.36)}`,
              transform: "translateX(-50%)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${divider * 100}%`,
              top: "8%",
              bottom: "8%",
              width: 82,
              transform: `translateX(calc(-50% + ${Math.sin(frame / 18) * 3}px))`,
              background: `linear-gradient(180deg, transparent 0%, ${alpha(
                "#ffffff",
                0.12,
              )} 18%, ${alpha(palette.accentAlt, 0.22)} 50%, ${alpha(
                "#ffffff",
                0.12,
              )} 82%, transparent 100%)`,
              maskImage: `linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.95) 18%, rgba(0,0,0,0.95) 82%, transparent 100%)`,
              opacity: 0.7,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${divider * 100}%`,
              top: dividerSweep,
              width: 176,
              height: 132,
              transform: "translateX(-50%) rotate(90deg)",
              background: `linear-gradient(90deg, transparent 0%, ${alpha(
                "#ffffff",
                0.08,
              )} 24%, ${alpha(palette.accent, 0.28)} 50%, ${alpha(
                "#ffffff",
                0.08,
              )} 76%, transparent 100%)`,
              filter: "blur(14px)",
              opacity: 0.72,
              pointerEvents: "none",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: `${divider * 100}%`,
              top: 50,
              transform: "translateX(-50%)",
              padding: "10px 14px",
              borderRadius: 999,
              background: alpha("#08111e", 0.62),
              color: palette.text,
              fontSize: 15,
              letterSpacing: "0.14em",
              textTransform: "uppercase",
              fontWeight: 700,
              border: `1px solid ${alpha("#ffffff", 0.08)}`,
            }}
          >
            Compare Shift
          </div>
          <div
            style={{
              position: "absolute",
              left: `${divider * 100}%`,
              bottom: 26,
              transform: "translateX(-50%)",
              width: Math.min(360, width * 0.3),
            }}
          >
            <StageFrame palette={palette} radius={24} padding={18}>
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
                <SectionEyebrow text="Key Lift" palette={palette} />
                <TagPill
                  text={`${pad2(activeMetricIndex + 1)} / ${pad2(metrics.length)}`}
                  palette={palette}
                />
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 24,
                  fontWeight: 800,
                  lineHeight: 1.16,
                }}
              >
                {activeMetric?.label}
              </div>
              <div
                style={{
                  marginTop: 8,
                  color: alpha(palette.text, 0.74),
                  fontSize: 18,
                  lineHeight: 1.45,
                }}
              >
                {activeMetric
                  ? `${Math.round(activeMetric.value)} / 100 performance readout`
                  : scoreDeltaLabel}
              </div>
              <div style={{ marginTop: 12 }}>
                {renderProgressTrack({
                  progress: activeMetric ? activeMetric.value / 100 : comparisonProgress,
                  palette,
                  leftLabel: "focus metric",
                  rightLabel: scoreDeltaLabel,
                })}
              </div>
            </StageFrame>
          </div>

          <div
            style={{
              position: "absolute",
              left: 26,
              bottom: 26,
              width: Math.min(420, width * 0.34),
            }}
          >
            <StageFrame palette={palette} radius={28} padding={24}>
              <SectionEyebrow text={left.eyebrow} palette={palette} />
              <div
                style={{
                  color: palette.text,
                  fontSize: 34,
                  fontWeight: 800,
                  marginTop: 12,
                  marginBottom: 10,
                  lineHeight: 1.05,
                }}
              >
                {left.title}
              </div>
              <div
                style={{
                  color: alpha(palette.text, 0.76),
                  fontSize: 20,
                  lineHeight: 1.5,
                  marginBottom: 14,
                }}
              >
                {left.summary}
              </div>
              {renderBulletPoints({ items: left.points, palette, size: 18 })}
              <div
                style={{
                  marginTop: 18,
                  color: palette.accentAlt,
                  fontSize: 40,
                  fontWeight: 900,
                }}
              >
                {left.score}
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: 0.42,
                  palette,
                  leftLabel: "initial state",
                  rightLabel: left.eyebrow,
                })}
              </div>
            </StageFrame>
          </div>

          <div
            style={{
              position: "absolute",
              right: 26,
              top: 26,
              width: Math.min(420, width * 0.34),
            }}
          >
            <StageFrame palette={palette} radius={28} padding={24}>
              <SectionEyebrow text={right.eyebrow} palette={palette} />
              <div
                style={{
                  color: palette.text,
                  fontSize: 34,
                  fontWeight: 800,
                  marginTop: 12,
                  marginBottom: 10,
                  lineHeight: 1.05,
                }}
              >
                {right.title}
              </div>
              <div
                style={{
                  color: alpha(palette.text, 0.76),
                  fontSize: 20,
                  lineHeight: 1.5,
                  marginBottom: 14,
                }}
              >
                {right.summary}
              </div>
              {renderBulletPoints({ items: right.points, palette, size: 18 })}
              <div
                style={{
                  marginTop: 18,
                  color: palette.accent,
                  fontSize: 40,
                  fontWeight: 900,
                }}
              >
                {right.score}
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: 0.92,
                  palette,
                  leftLabel: "target state",
                  rightLabel: right.eyebrow,
                })}
              </div>
            </StageFrame>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > 1100 ? "1fr 0.68fr" : "1fr",
            gap: 22,
            alignItems: "start",
            opacity: metricsWindow,
          }}
        >
          <StageFrame palette={palette} radius={28} padding={24}>
            <SectionEyebrow text="Scoring Matrix" palette={palette} />
            <div style={{ marginTop: 18 }}>
              <ProgressBarRow items={metrics} palette={palette} />
            </div>
          </StageFrame>
          <StageFrame palette={palette} radius={28} padding={24}>
            <SectionEyebrow text="Editor Verdict" palette={palette} />
            <div
              style={{
                marginTop: 16,
                color: palette.text,
                fontSize: 34,
                fontWeight: 800,
                lineHeight: 1.06,
              }}
            >
              {verdictTitle}
            </div>
            <div
              style={{
                color: alpha(palette.text, 0.76),
                fontSize: 20,
                lineHeight: 1.55,
                marginTop: 12,
              }}
            >
              {verdictText}
            </div>
            <div
              style={{
                marginTop: 18,
                color: palette.accentAlt,
                fontSize: 20,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: 800,
                opacity: verdictWindow,
              }}
            >
              {verdictCta}
            </div>
            <div style={{ marginTop: 16 }}>
              {renderProgressTrack({
                progress: comparisonProgress,
                palette,
                leftLabel: "verdict confidence",
                rightLabel: scoreDeltaLabel,
              })}
            </div>
          </StageFrame>
        </div>
      </div>
    </GradientStage>
  );
};

export const creatorHookSchema = z.object({
  palette: paletteSchema,
  media: mediaSchema,
  creatorName: z.string(),
  hook: z.string(),
  subhook: z.string(),
  punchlines: z.array(z.string()).min(3).max(5),
  captions: z.array(z.string()).min(3).max(5),
  lowerThird: z.string(),
  cta: z.string(),
});

export const CreatorHookTemplate: React.FC<
  z.infer<typeof creatorHookSchema>
> = ({
  palette,
  media,
  creatorName,
  hook,
  subhook,
  punchlines,
  captions,
  lowerThird,
  cta,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const hero = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 160, mass: 0.7 },
  });
  const captionIndex = Math.min(
    captions.length - 1,
    Math.floor((frame / durationInFrames) * captions.length),
  );
  const punchlineIndex = Math.min(
    punchlines.length - 1,
    Math.floor((frame / durationInFrames) * punchlines.length),
  );
  const vertical = height >= width;
  const captionSegment = durationInFrames / captions.length;
  const captionLocalProgress = clamp01(
    (frame - captionIndex * captionSegment) / captionSegment,
  );
  const storyProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const activePhaseLabel =
    sequencePhaseLabels[captionIndex] ?? `Beat ${pad2(captionIndex + 1)}`;
  const activePunchline = punchlines[punchlineIndex];

  return (
    <GradientStage palette={palette} frame={frame}>
      <MediaSurface
        media={media}
        palette={palette}
        frame={frame}
        style={{
          position: "absolute",
          inset: vertical ? "8% 8% 10% 8%" : "10% 50% 12% 6%",
          borderRadius: 42,
          opacity: 0.42,
          filter: "saturate(1.08)",
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 42,
          display: "grid",
          gridTemplateColumns: vertical ? "1fr" : "0.86fr 1.14fr",
          gap: 22,
        }}
      >
        <div
          style={{
            display: "grid",
            alignContent: "space-between",
            gap: 20,
          }}
        >
          <div style={{ display: "grid", gap: 18 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <TagPill text={`@${creatorName}`} palette={palette} light />
              <div
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 10,
                  color: alpha(palette.text, 0.68),
                  fontSize: 18,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                <div
                  style={{
                    width: 9,
                    height: 9,
                    borderRadius: 999,
                    background: palette.accentAlt,
                    boxShadow: `0 0 16px ${alpha(palette.accentAlt, 0.32)}`,
                  }}
                />
                {activePhaseLabel} / {formatTimecode(frame / fps)}
              </div>
            </div>
            <div
              style={{
                fontSize: vertical ? 92 : 106,
                lineHeight: 0.9,
                letterSpacing: "-0.055em",
                fontWeight: 900,
                color: palette.text,
                transform: `translateY(${mix(56, 0, hero)}px)`,
                opacity: hero,
              }}
            >
              {hook}
            </div>
            <div
              style={{
                fontSize: 26,
                lineHeight: 1.52,
                color: alpha(palette.text, 0.78),
                maxWidth: vertical ? "100%" : 560,
              }}
            >
              {subhook}
            </div>
            <StageFrame palette={palette} radius={24} padding={18}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      color: alpha(palette.text, 0.58),
                      fontSize: 16,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Attention Curve
                  </div>
                  {renderSignalDots({
                    count: captions.length,
                    activeCount: captionIndex + 1,
                    palette,
                  })}
                </div>
                <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                  <div
                    style={{
                      color: palette.text,
                      fontSize: 24,
                      fontWeight: 800,
                    }}
                  >
                    {Math.round(storyProgress * 100)}%
                  </div>
                  <div
                    style={{
                      color: alpha(palette.text, 0.58),
                      fontSize: 15,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                    }}
                  >
                    watch momentum
                  </div>
                </div>
              </div>
            </StageFrame>
          </div>
          <StageFrame palette={palette} radius={28} padding={22}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 14,
                flexWrap: "wrap",
              }}
            >
              <SectionEyebrow text="Talking Points" palette={palette} />
              <TagPill
                text={`${pad2(punchlineIndex + 1)} / ${pad2(punchlines.length)}`}
                palette={palette}
              />
            </div>
            <div
              style={{
                marginTop: 16,
                color: palette.text,
                fontSize: 38,
                fontWeight: 800,
                lineHeight: 1.1,
              }}
            >
              {activePunchline}
            </div>
            <div
              style={{
                marginTop: 12,
                color: alpha(palette.text, 0.66),
                fontSize: 18,
                lineHeight: 1.55,
              }}
            >
              {lowerThird}
            </div>
            <div style={{ display: "grid", gap: 10, marginTop: 18 }}>
              {punchlines.map((punchline, index) => {
                const active = index === punchlineIndex;

                return (
                  <div
                    key={`${punchline}-${index}`}
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto minmax(0, 1fr)",
                      gap: 12,
                      alignItems: "center",
                      padding: "10px 12px",
                      borderRadius: 18,
                      background: active
                        ? alpha("#ffffff", 0.09)
                        : alpha("#ffffff", 0.03),
                      border: `1px solid ${
                        active
                          ? alpha(palette.accentAlt, 0.22)
                          : alpha("#ffffff", 0.06)
                      }`,
                    }}
                  >
                    <div
                      style={{
                        width: 30,
                        height: 30,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        background: active
                          ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                          : alpha("#ffffff", 0.08),
                        color: active ? "#09101a" : palette.text,
                        fontSize: 14,
                        fontWeight: 800,
                        letterSpacing: "0.12em",
                      }}
                    >
                      {pad2(index + 1)}
                    </div>
                    <div
                      style={{
                        color: active ? palette.text : alpha(palette.text, 0.58),
                        fontSize: active ? 18 : 16,
                        lineHeight: 1.4,
                        fontWeight: active ? 700 : 600,
                      }}
                    >
                      {punchline}
                    </div>
                  </div>
                );
              })}
            </div>
            <div
              style={{
                marginTop: 18,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 18,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                {renderWaveBars({
                  frame: frame + punchlineIndex * 4,
                  palette,
                  bars: 8,
                  width: 4,
                  minHeight: 8,
                  maxHeight: 18,
                })}
                <div
                  style={{
                    color: alpha(palette.text, 0.56),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  delivery pacing
                </div>
              </div>
              <div
                style={{
                  color: palette.accentAlt,
                  fontSize: 18,
                  fontWeight: 800,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                }}
              >
                Active beat {pad2(punchlineIndex + 1)}
              </div>
            </div>
          </StageFrame>
        </div>

        <div
          style={{
            display: "grid",
            alignContent: "center",
            gap: 18,
          }}
        >
          {captions.map((caption, index) => {
            const window = sceneWindow({
              frame,
              start:
                index *
                Math.max(24, Math.floor(durationInFrames / (captions.length + 1))),
              end: durationInFrames,
              fadeIn: 16,
              fadeOut: 16,
            });

            return (
              <StageFrame
                key={`${caption}-${index}`}
                palette={palette}
                radius={30}
                padding={index === captionIndex ? 26 : 22}
                style={{
                  transform: `translateX(${index === captionIndex ? mix(44, 0, window) : 0}px) scale(${index === captionIndex ? 1 : 0.95})`,
                  opacity: index === captionIndex ? 1 : 0.62,
                  borderColor:
                    index === captionIndex
                      ? alpha(palette.accentAlt, 0.42)
                      : alpha("#ffffff", 0.08),
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    marginBottom: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      color: index === captionIndex
                        ? palette.accentAlt
                        : alpha(palette.text, 0.48),
                      fontSize: 16,
                      letterSpacing: "0.18em",
                      textTransform: "uppercase",
                      fontWeight: 800,
                    }}
                  >
                    {sequencePhaseLabels[index] ?? `Caption ${pad2(index + 1)}`}
                  </div>
                  <div
                    style={{
                      color: alpha(palette.text, 0.52),
                      fontSize: 15,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    {formatTimecode((index / captions.length) * (durationInFrames / fps))}
                  </div>
                </div>
                <div
                  style={{
                    color:
                      index === captionIndex
                        ? palette.text
                        : alpha(palette.text, 0.68),
                    fontSize: index === captionIndex ? 34 : 28,
                    fontWeight: 800,
                    lineHeight: 1.08,
                  }}
                >
                  {caption}
                </div>
                <div
                  style={{
                    marginTop: 14,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      color: alpha(palette.text, index === captionIndex ? 0.7 : 0.44),
                      fontSize: 15,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    {index === captionIndex ? "currently on screen" : "queued next"}
                  </div>
                  {index === captionIndex
                    ? renderWaveBars({
                        frame: frame + index * 3,
                        palette,
                        bars: 6,
                        width: 4,
                        minHeight: 8,
                        maxHeight: 16,
                      })
                    : null}
                </div>
                {index === captionIndex ? (
                  <div
                    style={{
                      marginTop: 14,
                      height: 6,
                      borderRadius: 999,
                      background: alpha("#ffffff", 0.08),
                      overflow: "hidden",
                    }}
                  >
                    <div
                      style={{
                        width: `${captionLocalProgress * 100}%`,
                        height: "100%",
                        borderRadius: 999,
                        background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                        boxShadow: `0 0 16px ${alpha(palette.accent, 0.24)}`,
                      }}
                    />
                  </div>
                ) : null}
              </StageFrame>
            );
          })}

          <div
            style={{
              display: "grid",
              gap: 14,
            }}
          >
            <StageFrame palette={palette} radius={24} padding={18}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  marginBottom: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: alpha(palette.text, 0.56),
                    fontSize: 16,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Story Progress
                </div>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 18,
                    fontWeight: 800,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                  }}
                >
                  {pad2(captionIndex + 1)} / {pad2(captions.length)}
                </div>
              </div>
              <div
                style={{
                  position: "relative",
                  height: 8,
                  borderRadius: 999,
                  background: alpha("#ffffff", 0.08),
                  overflow: "hidden",
                  marginBottom: 12,
                }}
              >
                <div
                  style={{
                    width: `${storyProgress * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                    boxShadow: `0 0 18px ${alpha(palette.accent, 0.24)}`,
                  }}
                />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                <TagPill text="Swipe Stopper" palette={palette} />
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    textTransform: "uppercase",
                    letterSpacing: "0.16em",
                    fontWeight: 800,
                  }}
                >
                  {cta}
                </div>
              </div>
            </StageFrame>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                color: alpha(palette.text, 0.5),
                fontSize: 15,
                textTransform: "uppercase",
                letterSpacing: "0.16em",
                fontWeight: 700,
              }}
            >
              <span>Visual cadence locked</span>
              <span>{formatTimecode(durationInFrames / fps)}</span>
            </div>
          </div>
        </div>
      </div>
      <FooterNote
        left={captions[captionIndex]}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const moodKineticSchema = z.object({
  palette: paletteSchema,
  moodLabel: z.string(),
  title: z.string(),
  lines: z.array(z.string()).min(3).max(6),
  media: z.array(mediaSchema).min(1).max(3),
  closing: z.string(),
  cta: z.string(),
});

export const MoodKineticTemplate: React.FC<
  z.infer<typeof moodKineticSchema>
> = ({ palette, moodLabel, title, lines, media, closing, cta }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const activeLineIndex = Math.min(
    lines.length - 1,
    Math.floor((frame / durationInFrames) * lines.length),
  );
  const activeMediaIndex = Math.min(
    media.length - 1,
    Math.floor((frame / durationInFrames) * media.length),
  );
  const lineWindow = sceneWindow({
    frame,
    start: activeLineIndex * (durationInFrames / lines.length),
    end: durationInFrames,
    fadeIn: 18,
    fadeOut: 20,
  });
  const moodProgress = clamp01(frame / Math.max(1, durationInFrames - 1));

  return (
    <GradientStage palette={palette} frame={frame}>
      <MediaSurface
        media={media[activeMediaIndex]}
        palette={palette}
        frame={frame}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 0,
          opacity: 0.28,
          filter: "blur(0px) saturate(1.12)",
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 0,
          background: `linear-gradient(180deg, ${alpha(palette.background, 0.18)} 0%, ${alpha(palette.background, 0.7)} 58%, ${alpha(palette.backgroundAlt, 0.92)} 100%)`,
        }}
      />

      <div
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          top: 56,
          bottom: 72,
          display: "grid",
          alignContent: "space-between",
        }}
      >
        <div style={{ display: "grid", gap: 16 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <TagPill text={moodLabel} palette={palette} light />
            <div
              style={{
                color: alpha(palette.text, 0.64),
                fontSize: 15,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Mood Arc / {formatTimecode(frame / fps)}
            </div>
          </div>
          <div
            style={{
              fontSize: width > height ? 126 : 104,
              lineHeight: 0.86,
              letterSpacing: "-0.065em",
              fontWeight: 900,
              color: palette.text,
              textTransform: "uppercase",
              maxWidth: width > height ? 1080 : "100%",
            }}
          >
            {title}
          </div>
          <StageFrame palette={palette} radius={24} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    color: alpha(palette.text, 0.5),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Emotional progression
                </div>
                {renderSignalDots({
                  count: lines.length,
                  activeCount: activeLineIndex + 1,
                  palette,
                })}
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  {pad2(activeLineIndex + 1)} / {pad2(lines.length)}
                </div>
                <div
                  style={{
                    color: alpha(palette.text, 0.46),
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  active line
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {renderProgressTrack({
                progress: moodProgress,
                palette,
                leftLabel: "mood build",
                rightLabel: moodLabel,
              })}
            </div>
          </StageFrame>
        </div>

        <div style={{ display: "grid", gap: 14 }}>
          {lines.map((line, index) => {
            const active = index === activeLineIndex;
            return (
              <div
                key={`${line}-${index}`}
                style={{
                  fontSize: active ? 54 : 34,
                  lineHeight: 1.08,
                  fontWeight: 800,
                  color: active ? palette.text : alpha(palette.text, 0.38),
                  transform: `translateX(${active ? mix(72, 0, lineWindow) : index * 12}px)`,
                  opacity: active ? 1 : 0.76,
                  filter: active ? "blur(0px)" : "blur(1px)",
                }}
              >
                {line}
              </div>
            );
          })}
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
            {renderWaveBars({
              frame: frame + activeLineIndex * 6,
              palette,
              bars: 9,
              width: 5,
              minHeight: 8,
              maxHeight: 18,
            })}
            <div
              style={{
                color: alpha(palette.text, 0.48),
                fontSize: 14,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
                alignSelf: "end",
              }}
            >
              emotional cadence
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > height ? "0.86fr 0.74fr" : "1fr",
            gap: 22,
            alignItems: "end",
          }}
        >
          <StageFrame palette={palette} radius={32} padding={28}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.48),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Landing thought
              </div>
              <TagPill
                text={`${pad2(activeLineIndex + 1)} / ${pad2(lines.length)}`}
                palette={palette}
              />
            </div>
            <div
              style={{
                color: palette.text,
                fontSize: 34,
                lineHeight: 1.2,
                fontWeight: 700,
                fontFamily: "Georgia, Baskerville, serif",
              }}
            >
              {closing}
            </div>
            <div style={{ marginTop: 16 }}>
              {renderProgressTrack({
                progress: moodProgress,
                palette,
                leftLabel: "release",
                rightLabel: cta,
              })}
            </div>
          </StageFrame>
          <div
            style={{
              justifySelf: width > height ? "end" : "stretch",
              color: palette.accentAlt,
              fontSize: 24,
              letterSpacing: "0.22em",
              textTransform: "uppercase",
              fontWeight: 800,
            }}
          >
            {cta}
          </div>
        </div>
      </div>
      <FooterNote
        left={lines[activeLineIndex]}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const cinematicStorySchema = z.object({
  palette: paletteSchema,
  title: z.string(),
  narrator: z.string(),
  chapters: z.array(chapterSchema).min(3).max(5),
  ending: z.string(),
});

export const CinematicStoryTemplate: React.FC<
  z.infer<typeof cinematicStorySchema>
> = ({ palette, title, narrator, chapters, ending }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const chapterDuration = durationInFrames / chapters.length;
  const chapterIndex = Math.min(
    chapters.length - 1,
    Math.floor(frame / chapterDuration),
  );
  const chapterFrame = frame - chapterIndex * chapterDuration;
  const chapter = chapters[chapterIndex];
  const chapterProgress = spring({
    frame: Math.max(0, Math.floor(chapterFrame)),
    fps,
    config: { damping: 16, stiffness: 120, mass: 0.78 },
  });
  const endingWindow = sceneWindow({
    frame,
    start: durationInFrames - 180,
    end: durationInFrames,
    fadeIn: 24,
    fadeOut: 20,
  });
  const storyProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const chapterWindow = sceneWindow({
    frame: chapterFrame,
    start: 0,
    end: chapterDuration,
    fadeIn: 18,
    fadeOut: 22,
  });
  const chapterReveal = clamp01((chapterFrame - 6) / 18);
  const storyBeamOffset = ((frame * 1.2) % (width * 0.88 + 320)) - 180;
  const mediaDriftX = Math.sin(frame / 30) * 14;
  const mediaDriftY = Math.cos(frame / 26) * 10;

  return (
    <GradientStage palette={palette} frame={frame}>
      <MediaSurface
        media={chapter.media}
        palette={palette}
        frame={frame}
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: 0,
          opacity: mix(0.18, 0.42, chapterWindow),
          filter: "contrast(1.04) saturate(0.94) brightness(0.84)",
          clipPath: `polygon(${mix(100, 0, chapterReveal)}% 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${mix(
            100,
            0,
            chapterReveal,
          )}%)`,
          transform: `scale(${mix(1.16, 1.04, chapterProgress)}) translate3d(${mediaDriftX}px, ${mediaDriftY}px, 0)`,
        }}
      />
      <div
        style={{
          position: "absolute",
          top: height * 0.16,
          left: storyBeamOffset,
          width: width * 0.72,
          height: 68,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            palette.accentAlt,
            0.18,
          )} 38%, ${alpha("#ffffff", 0.12)} 52%, transparent 100%)`,
          transform: "rotate(-9deg)",
          filter: "blur(8px)",
          opacity: 0.82,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          right: -width * 0.08,
          bottom: height * 0.22,
          width: width * 0.52,
          height: 54,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            palette.accent,
            0.18,
          )} 42%, transparent 100%)`,
          transform: "rotate(14deg)",
          filter: "blur(10px)",
          opacity: 0.7,
          pointerEvents: "none",
        }}
      />
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: 88,
          background: alpha("#000000", 0.54),
        }}
      />
      <div
        style={{
          position: "absolute",
          left: 0,
          right: 0,
          bottom: 0,
          height: 118,
          background: alpha("#000000", 0.72),
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 56,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 24,
        }}
      >
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "start",
            gap: 20,
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <SectionEyebrow text="Cinematic Story" palette={palette} />
            <div
              style={{
                color: palette.text,
                fontSize: width > height ? 92 : 76,
                lineHeight: 0.96,
                fontWeight: 800,
                letterSpacing: "-0.05em",
                maxWidth: width > height ? 900 : "100%",
              }}
            >
              {title}
            </div>
          </div>
          <div style={{ display: "grid", gap: 10, justifyItems: "end" }}>
            <TagPill text={narrator} palette={palette} light />
            <div
              style={{
                color: alpha(palette.text, 0.62),
                fontSize: 15,
                letterSpacing: "0.16em",
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              Chapter {pad2(chapterIndex + 1)} / {pad2(chapters.length)}
            </div>
          </div>
        </div>

        <div
          style={{
            display: "grid",
            alignItems: "end",
            gridTemplateColumns: width > height ? "1.12fr 0.88fr" : "1fr",
            gap: 24,
          }}
        >
          <div
            style={{
              color: palette.text,
              transform: `translateY(${mix(48, 0, chapterProgress)}px)`,
              opacity: chapterProgress,
            }}
          >
            <div
              style={{
                fontSize: 22,
                letterSpacing: "0.22em",
                textTransform: "uppercase",
                color: alpha(palette.text, 0.68),
                marginBottom: 14,
              }}
            >
              {chapter.eyebrow}
            </div>
            <div
              style={{
                fontSize: width > height ? 88 : 72,
                lineHeight: 0.94,
                fontWeight: 800,
                marginBottom: 18,
              }}
            >
              {chapter.title}
            </div>
            <div
              style={{
                maxWidth: 760,
                fontSize: 28,
                lineHeight: 1.6,
                color: alpha(palette.text, 0.82),
              }}
            >
              {chapter.body}
            </div>
            <div style={{ marginTop: 18, maxWidth: 720 }}>
              {renderProgressTrack({
                progress: storyProgress,
                palette,
                leftLabel: chapter.caption,
                rightLabel: formatTimecode(frame / fps),
              })}
            </div>
          </div>

          <StageFrame palette={palette} radius={30} padding={28}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <SectionEyebrow text="Subtitle Track" palette={palette} />
              {renderWaveBars({
                frame: frame + chapterIndex * 5,
                palette,
                bars: 6,
                width: 4,
                minHeight: 7,
                maxHeight: 18,
              })}
              <TagPill
                text={`${pad2(chapterIndex + 1)} / ${pad2(chapters.length)}`}
                palette={palette}
              />
            </div>
            <div
              style={{
                color: palette.text,
                fontSize: 32,
                lineHeight: 1.35,
                fontWeight: 700,
                fontFamily: "Georgia, Baskerville, serif",
              }}
            >
              {chapter.caption}
            </div>
            <div style={{ marginTop: 16 }}>
              {renderProgressTrack({
                progress: chapterProgress,
                palette,
                leftLabel: "chapter focus",
                rightLabel: chapter.eyebrow,
              })}
            </div>
            <div
              style={{
                marginTop: 16,
                padding: "14px 16px",
                borderRadius: 18,
                background: alpha("#ffffff", 0.06),
                border: `1px solid ${alpha("#ffffff", 0.08)}`,
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.5),
                  fontSize: 13,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Narrative Beat
              </div>
              <div
                style={{
                  marginTop: 8,
                  color: palette.text,
                  fontSize: 22,
                  lineHeight: 1.32,
                  fontWeight: 700,
                }}
              >
                {chapter.title}
              </div>
            </div>
          </StageFrame>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))`,
            gap: 12,
            alignItems: "end",
          }}
        >
          {chapters.map((item, index) => (
            <div
              key={`${item.title}-${index}`}
              style={{
                display: "grid",
                gap: 8,
                }}
              >
                <div
                  style={{
                    color:
                      index === chapterIndex
                        ? alpha(palette.text, 0.82)
                        : alpha(palette.text, 0.4),
                    fontSize: 11,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                    textAlign: "center",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                  }}
                >
                  {item.eyebrow}
                </div>
                <div
                  style={{
                    height: index === chapterIndex ? 68 : 26,
                    borderRadius: 18,
                    background:
                    index === chapterIndex
                      ? `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                      : alpha("#ffffff", 0.12),
                  boxShadow:
                    index === chapterIndex
                      ? `0 18px 34px ${alpha(palette.accent, 0.28)}`
                      : "none",
                }}
              />
              <div
                style={{
                  color:
                    index === chapterIndex
                      ? palette.text
                      : alpha(palette.text, 0.46),
                  fontSize: 13,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                  textAlign: "center",
                }}
              >
                {pad2(index + 1)}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div
        style={{
          position: "absolute",
          left: 56,
          right: 56,
          bottom: 148,
          color: palette.text,
          fontSize: 32,
          textAlign: "center",
          opacity: endingWindow,
          fontFamily: "Georgia, Baskerville, serif",
          lineHeight: 1.35,
        }}
      >
        {ending}
      </div>

      <FooterNote
        left={chapter.caption}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const knowledgeCardsSchema = z.object({
  palette: paletteSchema,
  topic: z.string(),
  promise: z.string(),
  media: mediaSchema,
  chapters: z.array(featureSchema).min(3).max(5),
  facts: z.array(metricSchema).min(3).max(6),
  checklist: z.array(z.string()).min(3).max(6),
  cta: z.string(),
});

export const KnowledgeCardsTemplate: React.FC<
  z.infer<typeof knowledgeCardsSchema>
> = ({ palette, topic, promise, media, chapters, facts, checklist, cta }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const chapterIndex = Math.min(
    chapters.length - 1,
    Math.floor((frame / durationInFrames) * chapters.length),
  );
  const chapter = chapters[chapterIndex];
  const heroWindow = sceneWindow({
    frame,
    start: 0,
    end: durationInFrames - 16,
    fadeIn: 18,
    fadeOut: 18,
  });
  const chapterSegment = durationInFrames / chapters.length;
  const chapterLocalProgress = clamp01(
    (frame - chapterIndex * chapterSegment) / chapterSegment,
  );
  const knowledgeProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const activeFact = facts[chapterIndex % facts.length] ?? facts[0];
  const mediaReveal = clamp01((frame - 10) / 20);

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          top: 86,
          left: -160 + Math.sin(frame / 26) * 28,
          width: width * 0.58,
          height: 52,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            palette.accent,
            0.16,
          )} 42%, transparent 100%)`,
          transform: "rotate(-12deg)",
          opacity: 0.84,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 52,
          display: "grid",
          gridTemplateColumns: width > height ? "0.92fr 1.08fr" : "1fr",
          gap: 24,
        }}
      >
        <div style={{ display: "grid", alignContent: "space-between", gap: 24 }}>
          <div style={{ display: "grid", gap: 14 }}>
            <TagPill text="Knowledge System" palette={palette} light />
            <div
              style={{
                fontSize: width > height ? 90 : 76,
                lineHeight: 0.94,
                letterSpacing: "-0.05em",
                fontWeight: 800,
                color: palette.text,
              }}
            >
              {topic}
            </div>
            <div
              style={{
                fontSize: 26,
                lineHeight: 1.55,
                color: alpha(palette.text, 0.76),
                maxWidth: 560,
              }}
            >
              {promise}
            </div>
            <StageFrame palette={palette} radius={24} padding={18}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      color: alpha(palette.text, 0.5),
                      fontSize: 15,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Learning route
                  </div>
                  {renderSignalDots({
                    count: chapters.length,
                    activeCount: chapterIndex + 1,
                    palette,
                  })}
                </div>
                <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                  <div
                    style={{
                      color: palette.text,
                      fontSize: 24,
                      fontWeight: 800,
                    }}
                  >
                    {pad2(chapterIndex + 1)} / {pad2(chapters.length)}
                  </div>
                  <div
                    style={{
                      color: alpha(palette.text, 0.46),
                      fontSize: 14,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    {chapter.eyebrow || "current focus"}
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: knowledgeProgress,
                  palette,
                  leftLabel: "session progress",
                  rightLabel: formatTimecode(frame / fps),
                })}
              </div>
            </StageFrame>
          </div>

          <StageFrame palette={palette} radius={30} padding={24}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionEyebrow text="Current Chapter" palette={palette} />
              <TagPill
                text={`${pad2(chapterIndex + 1)} / ${pad2(chapters.length)}`}
                palette={palette}
              />
            </div>
            <div
              style={{
                marginTop: 14,
                color: palette.text,
                fontSize: 36,
                fontWeight: 800,
                lineHeight: 1.06,
              }}
            >
              {chapter.title}
            </div>
            <div
              style={{
                marginTop: 10,
                color: alpha(palette.text, 0.74),
                fontSize: 20,
                lineHeight: 1.6,
              }}
            >
              {chapter.text}
            </div>
            {chapter.eyebrow ? (
              <div
                style={{
                  marginTop: 18,
                  color: palette.accentAlt,
                  fontSize: 18,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {chapter.eyebrow}
              </div>
            ) : null}
            <div style={{ marginTop: 16 }}>
              {renderProgressTrack({
                progress: chapterLocalProgress,
                palette,
                leftLabel: "chapter progression",
                rightLabel: chapter.title,
              })}
            </div>
          </StageFrame>

          <div style={{ position: "relative" }}>
            <MediaSurface
              media={media}
              palette={palette}
              frame={frame}
              style={{
                height: width > height ? height * 0.34 : height * 0.28,
                clipPath: `polygon(${mix(100, 0, mediaReveal)}% 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${mix(
                  100,
                  0,
                  mediaReveal,
                )}%)`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 20,
                right: 20,
                top: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <TagPill text="Visual Context" palette={palette} />
              <div
                style={{
                  color: alpha(palette.text, 0.62),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {chapter.eyebrow || "knowledge"}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: 20,
                bottom: 20,
                width: width > height ? "74%" : "86%",
                transform: `translateY(${mix(30, 0, mediaReveal)}px)`,
                opacity: mediaReveal,
              }}
            >
              <StageFrame palette={palette} radius={22} padding={18}>
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
                  <SectionEyebrow text={chapter.eyebrow || "Focus"} palette={palette} />
                  {renderWaveBars({
                    frame,
                    palette,
                    bars: 6,
                    width: 4,
                    minHeight: 7,
                    maxHeight: 18,
                  })}
                </div>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 24,
                    lineHeight: 1.2,
                    fontWeight: 800,
                  }}
                >
                  {activeFact?.label}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color: alpha(palette.text, 0.74),
                    fontSize: 17,
                    lineHeight: 1.55,
                  }}
                >
                  {activeFact?.detail || chapter.title}
                </div>
                <div style={{ marginTop: 12 }}>
                  {renderProgressTrack({
                    progress: (chapterIndex + 1) / chapters.length,
                    palette,
                    leftLabel: "knowledge arc",
                    rightLabel: activeFact?.value || cta,
                  })}
                </div>
              </StageFrame>
            </div>
          </div>
        </div>

        <div style={{ display: "grid", gap: 20 }}>
          <MetricGrid
            items={facts}
            palette={palette}
            columns={metricColumns(width)}
          />
          <StageFrame palette={palette} radius={30} padding={26}>
            <SectionEyebrow text="Action Checklist" palette={palette} />
            <div style={{ marginTop: 18 }}>
              {renderBulletPoints({ items: checklist, palette, size: 20 })}
            </div>
            <div style={{ marginTop: 16 }}>
              {renderProgressTrack({
                progress: chapterLocalProgress,
                palette,
                leftLabel: "action readiness",
                rightLabel: `${Math.round(chapterLocalProgress * 100)}%`,
              })}
            </div>
            <div
              style={{
                marginTop: 22,
                color: palette.accentAlt,
                fontSize: 22,
                letterSpacing: "0.18em",
                textTransform: "uppercase",
                fontWeight: 800,
                opacity: heroWindow,
              }}
            >
              {cta}
            </div>
          </StageFrame>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: `repeat(${chapters.length}, minmax(0, 1fr))`,
              gap: 12,
            }}
          >
            {chapters.map((item, index) => (
              <StageFrame
                key={`${item.title}-${index}`}
                palette={palette}
                radius={22}
                padding={18}
                style={{
                  opacity: index === chapterIndex ? 1 : 0.56,
                  transform: `translateY(${index === chapterIndex ? 0 : 10}px)`,
                  borderColor:
                    index === chapterIndex
                      ? alpha(palette.accentAlt, 0.22)
                      : alpha("#ffffff", 0.08),
                }}
              >
                <div
                  style={{
                    color:
                      index === chapterIndex
                        ? palette.accentAlt
                        : alpha(palette.text, 0.42),
                    fontSize: 14,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 800,
                    marginBottom: 8,
                  }}
                >
                  {pad2(index + 1)}
                </div>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    lineHeight: 1.18,
                    fontWeight: 800,
                  }}
                >
                  {item.title}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color:
                      index === chapterIndex
                        ? alpha(palette.text, 0.58)
                        : alpha(palette.text, 0.36),
                    fontSize: 13,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {index === chapterIndex ? "active chapter" : "queued"}
                </div>
              </StageFrame>
            ))}
          </div>
        </div>
      </div>
      <FooterNote
        left={chapter.title}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const dataInsightSchema = z.object({
  palette: paletteSchema,
  eyebrow: z.string(),
  headline: z.string(),
  summary: z.string(),
  media: mediaSchema,
  metrics: z.array(metricSchema).min(3).max(6),
  bars: z.array(barSchema).min(4).max(8),
  insights: z.array(z.string()).min(3).max(6),
  cta: z.string(),
});

export const DataInsightTemplate: React.FC<
  z.infer<typeof dataInsightSchema>
> = ({ palette, eyebrow, headline, summary, media, metrics, bars, insights, cta }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const barWindow = sceneWindow({
    frame,
    start: 30,
    end: durationInFrames - 18,
    fadeIn: 16,
    fadeOut: 16,
  });
  const activeBarIndex = Math.min(
    bars.length - 1,
    Math.floor((frame / durationInFrames) * bars.length),
  );
  const dashboardProgress = clamp01(frame / Math.max(1, durationInFrames - 1));

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          inset: 52,
          display: "grid",
          gridTemplateRows: "auto auto minmax(0, 1fr)",
          gap: 22,
        }}
      >
        <div style={{ display: "grid", gap: 12 }}>
          <SectionEyebrow text={eyebrow} palette={palette} />
          <div
            style={{
              color: palette.text,
              fontSize: width > height ? 88 : 72,
              lineHeight: 0.96,
              letterSpacing: "-0.05em",
              fontWeight: 800,
              maxWidth: 1100,
            }}
          >
            {headline}
          </div>
          <div
            style={{
              color: alpha(palette.text, 0.74),
              fontSize: 24,
              lineHeight: 1.55,
              maxWidth: 980,
            }}
          >
            {summary}
          </div>
          <StageFrame palette={palette} radius={24} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    color: alpha(palette.text, 0.48),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Dashboard status
                </div>
                {renderSignalDots({
                  count: bars.length,
                  activeCount: activeBarIndex + 1,
                  palette,
                })}
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  {pad2(activeBarIndex + 1)} / {pad2(bars.length)}
                </div>
                <div
                  style={{
                    color: alpha(palette.text, 0.46),
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {bars[activeBarIndex]?.label || eyebrow}
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {renderProgressTrack({
                progress: dashboardProgress,
                palette,
                leftLabel: "readout progress",
                rightLabel: formatTimecode(frame / fps),
              })}
            </div>
          </StageFrame>
        </div>

        <MetricGrid
          items={metrics}
          palette={palette}
          columns={metricColumns(width)}
        />

        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > height ? "1.08fr 0.92fr" : "1fr",
            gap: 22,
            alignItems: "stretch",
            minHeight: 0,
          }}
        >
          <StageFrame palette={palette} radius={30} padding={26}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <SectionEyebrow text="Performance Trend" palette={palette} />
              <TagPill
                text={`${pad2(activeBarIndex + 1)} / ${pad2(bars.length)}`}
                palette={palette}
              />
            </div>
            <div
              style={{
                marginTop: 24,
                display: "grid",
                gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))`,
                gap: 12,
                alignItems: "end",
                height: height > width ? 240 : 320,
              }}
            >
              {bars.map((bar, index) => {
                const reveal = clamp01((frame - 16 - index * 4) / 18);
                return (
                  <div
                    key={`${bar.label}-${index}`}
                    style={{
                      display: "grid",
                      justifyItems: "center",
                      gap: 10,
                      height: "100%",
                    }}
                  >
                    <div
                      style={{
                        alignSelf: "end",
                        width: "100%",
                        maxWidth: 82,
                        height: `${bar.value}%`,
                        minHeight: 14,
                        borderRadius: "20px 20px 8px 8px",
                        background: bar.color
                          ? bar.color
                          : `linear-gradient(180deg, ${palette.accentAlt} 0%, ${palette.accent} 100%)`,
                        transform: `scaleY(${reveal})`,
                        transformOrigin: "bottom center",
                        opacity: barWindow,
                        boxShadow: `0 18px 34px ${alpha(bar.color || palette.accent, 0.24)}`,
                        border:
                          index === activeBarIndex
                            ? `1px solid ${alpha("#ffffff", 0.22)}`
                            : "none",
                      }}
                    />
                    <div
                      style={{
                        color:
                          index === activeBarIndex
                            ? palette.text
                            : alpha(palette.text, 0.64),
                        fontSize: index === activeBarIndex ? 17 : 16,
                        fontWeight: index === activeBarIndex ? 700 : 500,
                      }}
                    >
                      {bar.label}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 16 }}>
              {renderProgressTrack({
                progress: dashboardProgress,
                palette,
                leftLabel: "focus metric",
                rightLabel: bars[activeBarIndex]?.label || eyebrow,
              })}
            </div>
          </StageFrame>

          <div style={{ display: "grid", gap: 20 }}>
            <div style={{ position: "relative" }}>
              <MediaSurface
                media={media}
                palette={palette}
                frame={frame}
                style={{
                  height: width > height ? 240 : 220,
                }}
              />
              <div
                style={{
                  position: "absolute",
                  left: 18,
                  right: 18,
                  top: 18,
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <TagPill text="Live Context" palette={palette} />
                <div
                  style={{
                    color: alpha(palette.text, 0.62),
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  {bars[activeBarIndex]?.label || "dashboard"}
                </div>
              </div>
            </div>
            <StageFrame palette={palette} radius={30} padding={24}>
              <SectionEyebrow text="Key Readouts" palette={palette} />
              <div style={{ marginTop: 16 }}>
                {renderBulletPoints({ items: insights, palette, size: 19 })}
              </div>
              <div style={{ marginTop: 16 }}>
                {renderProgressTrack({
                  progress: dashboardProgress,
                  palette,
                  leftLabel: "insight sync",
                  rightLabel: cta,
                })}
              </div>
              <div
                style={{
                  marginTop: 18,
                  color: palette.accentAlt,
                  fontSize: 20,
                  fontWeight: 800,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                }}
              >
                {cta}
              </div>
            </StageFrame>
          </div>
        </div>
      </div>
      <FooterNote
        left={eyebrow}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const brandManifestoSchema = z.object({
  palette: paletteSchema,
  brandName: z.string(),
  slogan: z.string(),
  media: mediaSchema,
  manifestoLines: z.array(z.string()).min(3).max(6),
  proofPoints: z.array(z.string()).min(3).max(6),
  signature: z.string(),
});

export const BrandManifestoTemplate: React.FC<
  z.infer<typeof brandManifestoSchema>
> = ({
  palette,
  brandName,
  slogan,
  media,
  manifestoLines,
  proofPoints,
  signature,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const lineIndex = Math.min(
    manifestoLines.length - 1,
    Math.floor((frame / durationInFrames) * manifestoLines.length),
  );
  const statement = manifestoLines[lineIndex];
  const manifestoProgress = clamp01(frame / Math.max(1, durationInFrames - 1));

  return (
    <GradientStage palette={palette} frame={frame}>
      <MediaSurface
        media={media}
        palette={palette}
        frame={frame}
        style={{
          position: "absolute",
          inset: width > height ? "10% 48% 12% 6%" : "8% 8% auto 8%",
          height: width > height ? "auto" : height * 0.3,
          borderRadius: 42,
          opacity: 0.34,
        }}
      />

      <div
        style={{
          position: "absolute",
          inset: 56,
          display: "grid",
          gridTemplateColumns: width > height ? "0.9fr 1.1fr" : "1fr",
          gap: 24,
        }}
      >
        <div style={{ display: "grid", alignContent: "space-between", gap: 22 }}>
          <div style={{ display: "grid", gap: 16 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <TagPill text={brandName} palette={palette} light />
              <div
                style={{
                  color: alpha(palette.text, 0.62),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Manifesto / {formatTimecode(frame / fps)}
              </div>
            </div>
            <div
              style={{
                color: palette.text,
                fontSize: width > height ? 92 : 74,
                lineHeight: 0.94,
                letterSpacing: "-0.05em",
                fontWeight: 800,
              }}
            >
              {slogan}
            </div>
            <StageFrame palette={palette} radius={24} padding={18}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div style={{ display: "grid", gap: 10 }}>
                  <div
                    style={{
                      color: alpha(palette.text, 0.48),
                      fontSize: 15,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Brand cadence
                  </div>
                  {renderSignalDots({
                    count: manifestoLines.length,
                    activeCount: lineIndex + 1,
                    palette,
                  })}
                </div>
                <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                  <div
                    style={{
                      color: palette.text,
                      fontSize: 22,
                      fontWeight: 800,
                    }}
                  >
                    {pad2(lineIndex + 1)} / {pad2(manifestoLines.length)}
                  </div>
                  <div
                    style={{
                      color: alpha(palette.text, 0.46),
                      fontSize: 14,
                      letterSpacing: "0.14em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    active statement
                  </div>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                {renderProgressTrack({
                  progress: manifestoProgress,
                  palette,
                  leftLabel: "manifesto progression",
                  rightLabel: signature,
                })}
              </div>
            </StageFrame>
          </div>
          <StageFrame palette={palette} radius={32} padding={26}>
            <SectionEyebrow text="Proof" palette={palette} />
            <div style={{ marginTop: 16 }}>
              {renderBulletPoints({ items: proofPoints, palette, size: 20 })}
            </div>
          </StageFrame>
        </div>

        <div style={{ display: "grid", alignContent: "space-between", gap: 24 }}>
          <div
            style={{
              color: palette.text,
              fontSize: width > height ? 82 : 66,
              lineHeight: 0.98,
              fontWeight: 800,
              letterSpacing: "-0.05em",
              fontFamily: "Georgia, Baskerville, serif",
            }}
          >
            {statement}
          </div>
          <StageFrame palette={palette} radius={24} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
                marginBottom: 12,
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.48),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Current line
              </div>
              <TagPill
                text={`${pad2(lineIndex + 1)} / ${pad2(manifestoLines.length)}`}
                palette={palette}
              />
            </div>
            <div
              style={{
                color: alpha(palette.text, 0.78),
                fontSize: 22,
                lineHeight: 1.55,
                fontFamily: "Georgia, Baskerville, serif",
              }}
            >
              {statement}
            </div>
            <div style={{ marginTop: 14 }}>
              {renderProgressTrack({
                progress: manifestoProgress,
                palette,
                leftLabel: "brand narrative",
                rightLabel: brandName,
              })}
            </div>
          </StageFrame>

          <div style={{ display: "grid", gap: 14 }}>
            {manifestoLines.map((line, index) => (
              <div
                key={`${line}-${index}`}
                style={{
                  color:
                    index === lineIndex ? palette.text : alpha(palette.text, 0.34),
                  fontSize: index === lineIndex ? 30 : 22,
                  lineHeight: 1.3,
                  transform: `translateX(${index === lineIndex ? 0 : index * 8}px)`,
                }}
              >
                {line}
              </div>
            ))}
          </div>

          <StageFrame palette={palette} radius={24} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.48),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Closing signature
              </div>
              <div
                style={{
                  color: palette.accentAlt,
                  fontSize: 22,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                }}
              >
                {signature}
              </div>
            </div>
          </StageFrame>
        </div>
      </div>
      <FooterNote
        left={brandName}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const prismLogoRevealSchema = z.object({
  palette: paletteSchema,
  brandName: z.string(),
  tagline: z.string(),
  emblemText: z.string(),
});

export const PrismLogoRevealTemplate: React.FC<
  z.infer<typeof prismLogoRevealSchema>
> = ({ palette, brandName, tagline, emblemText }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames } = useVideoConfig();
  const reveal = spring({
    frame,
    fps,
    config: { damping: 14, stiffness: 140, mass: 0.75 },
  });
  const rotate = frame * 0.9;
  const pulse = 1 + Math.sin(frame / 9) * 0.03;
  const taglineOpacity = interpolate(
    frame,
    [36, 58, durationInFrames - 14],
    [0, 1, 1],
    {
      extrapolateLeft: "clamp",
      extrapolateRight: "clamp",
    },
  );
  const logoProgress = clamp01(frame / Math.max(1, durationInFrames - 1));

  return (
    <GradientStage palette={palette} frame={frame}>
      <AbsoluteFill
        style={{
          alignItems: "center",
          justifyContent: "center",
          gap: 24,
        }}
      >
        <div
          style={{
            position: "relative",
            width: 420,
            height: 420,
            transform: `scale(${mix(0.72, pulse, reveal)}) rotate(${rotate}deg)`,
          }}
        >
          {Array.from({ length: 4 }).map((_, index) => (
            <div
              key={index}
              style={{
                position: "absolute",
                inset: index * 32,
                borderRadius: 52 - index * 6,
                border: `2px solid ${alpha(index % 2 === 0 ? palette.accent : palette.accentAlt, 0.82)}`,
                transform: `rotate(${index * 22}deg)`,
                boxShadow: `0 0 44px ${alpha(index % 2 === 0 ? palette.accent : palette.accentAlt, 0.24)}`,
              }}
            />
          ))}
          <div
            style={{
              position: "absolute",
              inset: 24,
              borderRadius: 46,
              border: `1px dashed ${alpha("#ffffff", 0.14)}`,
              opacity: 0.56,
            }}
          />
          <StageFrame
            palette={palette}
            radius={62}
            padding={0}
            style={{
              position: "absolute",
              inset: 112,
              display: "grid",
              placeItems: "center",
              background: `linear-gradient(180deg, ${alpha("#ffffff", 0.18)} 0%, ${alpha(palette.surface, 0.86)} 100%)`,
            }}
          >
            <div
              style={{
                color: palette.text,
                fontSize: 94,
                fontWeight: 900,
                letterSpacing: "-0.08em",
              }}
            >
              {emblemText}
            </div>
          </StageFrame>
        </div>

        <StageFrame palette={palette} radius={24} padding={18}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  color: alpha(palette.text, 0.48),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Reveal phase
              </div>
              {renderSignalDots({
                count: 4,
                activeCount: Math.max(1, Math.ceil(logoProgress * 4)),
                palette,
              })}
            </div>
            <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
              <div
                style={{
                  color: palette.text,
                  fontSize: 22,
                  fontWeight: 800,
                }}
              >
                {Math.round(logoProgress * 100)}%
              </div>
              <div
                style={{
                  color: alpha(palette.text, 0.46),
                  fontSize: 14,
                  letterSpacing: "0.14em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                brand imprint
              </div>
            </div>
          </div>
          <div style={{ marginTop: 14 }}>
            {renderProgressTrack({
              progress: logoProgress,
              palette,
              leftLabel: brandName,
              rightLabel: formatTimecode(frame / fps),
            })}
          </div>
        </StageFrame>

        <div
          style={{
            color: palette.text,
            fontSize: 76,
            fontWeight: 800,
            letterSpacing: "-0.05em",
            opacity: reveal,
          }}
        >
          {brandName}
        </div>
        <div
          style={{
            color: alpha(palette.text, 0.74),
            fontSize: 24,
            letterSpacing: "0.22em",
            textTransform: "uppercase",
            opacity: taglineOpacity,
          }}
        >
          {tagline}
        </div>
      </AbsoluteFill>
    </GradientStage>
  );
};

export const launchKeynoteSchema = z.object({
  palette: paletteSchema,
  productName: z.string(),
  keynoteLine: z.string(),
  releaseNote: z.string(),
  media: mediaSchema,
  specs: z.array(metricSchema).min(3).max(6),
  milestones: z.array(z.string()).min(3).max(6),
  cta: z.string(),
});

export const LaunchKeynoteTemplate: React.FC<
  z.infer<typeof launchKeynoteSchema>
> = ({
  palette,
  productName,
  keynoteLine,
  releaseNote,
  media,
  specs,
  milestones,
  cta,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const hero = spring({
    frame,
    fps,
    config: { damping: 15, stiffness: 120, mass: 0.8 },
  });
  const milestoneIndex = Math.min(
    milestones.length - 1,
    Math.floor((frame / durationInFrames) * milestones.length),
  );
  const launchProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const milestoneProgress = clamp01(
    (frame - milestoneIndex * (durationInFrames / milestones.length)) /
      (durationInFrames / milestones.length),
  );
  const activeSpecIndex = Math.min(
    specs.length - 1,
    Math.floor((frame / durationInFrames) * specs.length),
  );
  const activeSpec = specs[activeSpecIndex] ?? specs[0];
  const mediaReveal = clamp01((frame - 8) / 20);

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          top: 88,
          left: -220 + Math.sin(frame / 22) * 36,
          width: width * 0.76,
          height: 58,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            palette.accentAlt,
            0.16,
          )} 36%, transparent 100%)`,
          transform: "rotate(-10deg)",
          opacity: 0.82,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 54,
          display: "grid",
          gridTemplateRows: "auto 1fr auto",
          gap: 22,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > height ? "1.02fr 0.98fr" : "1fr",
            gap: 18,
            alignItems: "start",
          }}
        >
          <div style={{ display: "grid", gap: 10 }}>
            <SectionEyebrow text="Launch Event" palette={palette} />
            <div
              style={{
                color: palette.text,
                fontSize: width > height ? 96 : 78,
                lineHeight: 0.95,
                fontWeight: 800,
                letterSpacing: "-0.055em",
                maxWidth: 980,
              }}
            >
              {productName}
            </div>
            <div
              style={{
                color: alpha(palette.text, 0.74),
                fontSize: 24,
                lineHeight: 1.55,
                maxWidth: 920,
              }}
            >
              {keynoteLine}
            </div>
          </div>
          <StageFrame palette={palette} radius={26} padding={20}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 10 }}>
                <div
                  style={{
                    color: alpha(palette.text, 0.48),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Launch control
                </div>
                {renderSignalDots({
                  count: milestones.length,
                  activeCount: milestoneIndex + 1,
                  palette,
                })}
              </div>
              <div style={{ display: "grid", gap: 6, justifyItems: "end" }}>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  {pad2(milestoneIndex + 1)} / {pad2(milestones.length)}
                </div>
                <div
                  style={{
                    color: alpha(palette.text, 0.46),
                    fontSize: 14,
                    letterSpacing: "0.14em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  live sequence
                </div>
              </div>
            </div>
            <div style={{ marginTop: 14 }}>
              {renderProgressTrack({
                progress: launchProgress,
                palette,
                leftLabel: "launch progress",
                rightLabel: formatTimecode(frame / fps),
              })}
            </div>
          </StageFrame>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > height ? "1.08fr 0.92fr" : "1fr",
            gap: 22,
            minHeight: 0,
          }}
        >
          <div style={{ position: "relative" }}>
            <MediaSurface
              media={media}
              palette={palette}
              frame={frame}
              style={{
                minHeight: width > height ? height * 0.42 : height * 0.32,
                clipPath: `polygon(${mix(100, 0, mediaReveal)}% 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${mix(
                  100,
                  0,
                  mediaReveal,
                )}%)`,
                transform: `perspective(1800px) rotateY(${mix(12, 0, hero)}deg) scale(${mix(0.9, 1, hero)})`,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 20,
                right: 20,
                top: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <TagPill text="Keynote Visual" palette={palette} />
              <div
                style={{
                  color: alpha(palette.text, 0.62),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {milestones[milestoneIndex]}
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                right: 24,
                bottom: 24,
                width: width > height ? "42%" : "78%",
                opacity: mediaReveal,
                transform: `translateY(${mix(30, 0, mediaReveal)}px)`,
              }}
            >
              <StageFrame palette={palette} radius={24} padding={18}>
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
                  <SectionEyebrow text="Spec Focus" palette={palette} />
                  {renderWaveBars({
                    frame,
                    palette,
                    bars: 7,
                    width: 4,
                    minHeight: 7,
                    maxHeight: 18,
                  })}
                </div>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 26,
                    fontWeight: 800,
                    lineHeight: 1.16,
                  }}
                >
                  {activeSpec?.label}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color: alpha(palette.text, 0.78),
                    fontSize: 22,
                    fontWeight: 800,
                  }}
                >
                  {activeSpec?.value}
                </div>
                <div
                  style={{
                    marginTop: 8,
                    color: alpha(palette.text, 0.68),
                    fontSize: 17,
                    lineHeight: 1.5,
                  }}
                >
                  {activeSpec?.detail || releaseNote}
                </div>
                <div style={{ marginTop: 12 }}>
                  {renderProgressTrack({
                    progress: (activeSpecIndex + 1) / specs.length,
                    palette,
                    leftLabel: "spec rotation",
                    rightLabel: `${pad2(activeSpecIndex + 1)} / ${pad2(specs.length)}`,
                  })}
                </div>
              </StageFrame>
            </div>
          </div>
          <div style={{ display: "grid", gap: 18 }}>
            <MetricGrid items={specs} palette={palette} columns={1} />
            <StageFrame palette={palette} radius={30} padding={24}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <SectionEyebrow text="Launch Milestones" palette={palette} />
                <TagPill
                  text={`${pad2(milestoneIndex + 1)} / ${pad2(milestones.length)}`}
                  palette={palette}
                />
              </div>
              <div style={{ marginTop: 16, display: "grid", gap: 12 }}>
                {milestones.map((item, index) => {
                  const active = index === milestoneIndex;

                  return (
                    <div
                      key={`${item}-${index}`}
                      style={{
                        display: "grid",
                        gridTemplateColumns: "42px minmax(0, 1fr)",
                        gap: 12,
                        alignItems: "start",
                        padding: "10px 12px",
                        borderRadius: 20,
                        background: active
                          ? alpha("#ffffff", 0.07)
                          : alpha("#ffffff", 0.03),
                        border: `1px solid ${
                          active
                            ? alpha(palette.accentAlt, 0.22)
                            : alpha("#ffffff", 0.06)
                        }`,
                      }}
                    >
                      <div
                        style={{
                          width: 34,
                          height: 34,
                          borderRadius: 999,
                          display: "grid",
                          placeItems: "center",
                          background: active
                            ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                            : alpha("#ffffff", 0.08),
                          color: active ? "#08111e" : palette.text,
                          fontSize: 14,
                          fontWeight: 800,
                          letterSpacing: "0.14em",
                        }}
                      >
                        {pad2(index + 1)}
                      </div>
                      <div
                        style={{
                          color: active ? palette.text : alpha(palette.text, 0.52),
                          fontSize: active ? 26 : 20,
                          fontWeight: active ? 800 : 600,
                          lineHeight: 1.24,
                        }}
                      >
                        {item}
                      </div>
                    </div>
                  );
                })}
              </div>
              <div style={{ marginTop: 16 }}>
                {renderProgressTrack({
                  progress: milestoneProgress,
                  palette,
                  leftLabel: "current milestone",
                  rightLabel: `${Math.round(milestoneProgress * 100)}%`,
                })}
              </div>
            </StageFrame>
          </div>
        </div>

        <StageFrame palette={palette} radius={26} padding={18}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 18,
              flexWrap: "wrap",
            }}
          >
            <div
              style={{
                color: alpha(palette.text, 0.72),
                fontSize: 22,
                lineHeight: 1.45,
                maxWidth: 980,
              }}
            >
              {releaseNote}
            </div>
            <TagPill text={cta} palette={palette} />
          </div>
          <div style={{ marginTop: 14 }}>
            {renderProgressTrack({
              progress: launchProgress,
              palette,
              leftLabel: "event arc",
              rightLabel: milestones[milestoneIndex],
            })}
          </div>
        </StageFrame>
      </div>
      <FooterNote
        left={milestones[milestoneIndex]}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const editorialMontageSchema = z.object({
  palette: paletteSchema,
  eyebrow: z.string(),
  headline: z.string(),
  summary: z.string(),
  panels: z.array(panelSchema).min(3).max(4),
  chips: z.array(z.string()).min(2).max(6),
  cta: z.string(),
});

export const EditorialMontageTemplate: React.FC<
  z.infer<typeof editorialMontageSchema>
> = ({ palette, eyebrow, headline, summary, panels, chips, cta }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const vertical = height > width;
  const activePanelIndex = Math.min(
    panels.length - 1,
    Math.floor((frame / durationInFrames) * panels.length),
  );
  const currentPanel = panels[activePanelIndex] ?? panels[0];
  const montageProgress = clamp01(frame / Math.max(1, durationInFrames - 1));
  const coverReveal = clamp01((frame - 6) / 18);

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          top: 92,
          left: -220 + Math.sin(frame / 24) * 42,
          width: width * 0.72,
          height: 56,
          borderRadius: 999,
          background: `linear-gradient(90deg, transparent 0%, ${alpha(
            palette.accent,
            0.2,
          )} 38%, transparent 100%)`,
          transform: "rotate(-12deg)",
          opacity: 0.86,
        }}
      />
      <div
        style={{
          position: "absolute",
          inset: 48,
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto",
          gap: 22,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: vertical ? "1fr" : "1.05fr 0.95fr",
            gap: 18,
            alignItems: "end",
          }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <SectionEyebrow text={eyebrow} palette={palette} />
            <div
              style={{
                color: palette.text,
                fontSize: vertical ? 82 : 90,
                lineHeight: 0.94,
                letterSpacing: "-0.05em",
                fontWeight: 800,
                maxWidth: vertical ? "100%" : 920,
              }}
            >
              {headline}
            </div>
          </div>
          <StageFrame
            palette={palette}
            radius={26}
            padding={20}
            style={{
              justifySelf: vertical ? "stretch" : "end",
              maxWidth: vertical ? "100%" : 560,
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: alpha(palette.text, 0.58),
                    fontSize: 16,
                    lineHeight: 1.6,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Current spread
                </div>
                <TagPill
                  text={`${pad2(activePanelIndex + 1)} / ${pad2(panels.length)}`}
                  palette={palette}
                />
              </div>
              <div
                style={{
                  color: alpha(palette.text, 0.74),
                  fontSize: 23,
                  lineHeight: 1.6,
                }}
              >
                {summary}
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 24,
                  lineHeight: 1.3,
                  fontWeight: 700,
                }}
              >
                {currentPanel?.title}
              </div>
              <div
                style={{
                  height: 6,
                  borderRadius: 999,
                  background: alpha("#ffffff", 0.08),
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${montageProgress * 100}%`,
                    height: "100%",
                    borderRadius: 999,
                    background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                    boxShadow: `0 0 16px ${alpha(palette.accent, 0.24)}`,
                  }}
                />
              </div>
            </div>
          </StageFrame>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: vertical ? "1fr" : "1.04fr 0.96fr",
            gap: 18,
            minHeight: 0,
          }}
        >
          <div style={{ minHeight: 0 }}>
            {panels[0] ? (
              <StageFrame
                palette={palette}
                radius={34}
                padding={0}
                style={{
                  height: "100%",
                  transform: `translateY(${mix(48, 0, clamp01(frame / 18))}px)`,
                }}
              >
                <div style={{ position: "relative", height: "100%" }}>
                  <MediaSurface
                    media={panels[0].media}
                    palette={palette}
                    frame={frame}
                    style={{
                      height: "100%",
                      borderRadius: 34,
                      clipPath: `polygon(${mix(100, 0, coverReveal)}% 0%, 100% 0%, 100% 100%, 0% 100%, 0% ${mix(
                        100,
                        0,
                        coverReveal,
                      )}%)`,
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 24,
                      right: 24,
                      top: 22,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <TagPill text="Cover Story" palette={palette} />
                    <div
                      style={{
                        color: alpha(palette.text, 0.64),
                        fontSize: 16,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      Frame {pad2(1)} / {pad2(panels.length)}
                    </div>
                  </div>
                  <div
                    style={{
                      position: "absolute",
                      right: 24,
                      top: 84,
                      width: 132,
                      height: 132,
                      borderRadius: "50%",
                      border: `1px solid ${alpha(palette.accentAlt, 0.16)}`,
                      transform: `scale(${mix(0.72, 1.06, coverReveal)})`,
                      opacity: mix(0, 0.46, coverReveal),
                      pointerEvents: "none",
                    }}
                  />
                  <div
                    style={{
                      position: "absolute",
                      left: 26,
                      right: 26,
                      bottom: 24,
                      display: "grid",
                      gap: 10,
                    }}
                  >
                    {panels[0].eyebrow ? (
                      <TagPill text={panels[0].eyebrow} palette={palette} />
                    ) : null}
                    <div
                      style={{
                        color: palette.text,
                        fontSize: 36,
                        fontWeight: 800,
                        lineHeight: 1.04,
                      }}
                    >
                      {panels[0].title}
                    </div>
                    <div
                      style={{
                        color: alpha(palette.text, 0.78),
                        fontSize: 20,
                        lineHeight: 1.45,
                        maxWidth: 520,
                      }}
                    >
                      {panels[0].text}
                    </div>
                    <div style={{ marginTop: 14, maxWidth: 460 }}>
                      {renderProgressTrack({
                        progress: montageProgress,
                        palette,
                        leftLabel: "cover sequence",
                        rightLabel: chips[activePanelIndex % chips.length] || cta,
                      })}
                    </div>
                  </div>
                </div>
              </StageFrame>
            ) : null}
          </div>

          <div style={{ display: "grid", gap: 18, minHeight: 0 }}>
            {panels.slice(1).map((panel, index) => {
              const reveal = clamp01((frame - 10 - index * 8) / 18);
              const active = activePanelIndex === index + 1;

              return (
                <StageFrame
                  key={`${panel.title}-${index}`}
                  palette={palette}
                  radius={28}
                  padding={18}
                  style={{
                    display: "grid",
                    gridTemplateColumns: vertical ? "1fr" : "0.9fr 1.1fr",
                    gap: 18,
                    alignItems: "stretch",
                    transform: `translateY(${mix(56, 0, reveal)}px) scale(${active ? 1.01 : 0.98})`,
                    opacity: mix(0.5, 1, reveal),
                    borderColor: active
                      ? alpha(palette.accentAlt, 0.44)
                      : alpha("#ffffff", 0.12),
                  }}
                >
                  <div style={{ position: "relative" }}>
                    <MediaSurface
                      media={panel.media}
                      palette={palette}
                      frame={frame + index * 6}
                      radius={22}
                      style={{
                        minHeight: vertical ? 220 : 190,
                      }}
                    />
                    <div
                      style={{
                        position: "absolute",
                        left: 16,
                        top: 16,
                        width: 42,
                        height: 42,
                        borderRadius: 999,
                        display: "grid",
                        placeItems: "center",
                        background: active
                          ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                          : alpha("#08111e", 0.52),
                        color: active ? "#08111e" : palette.text,
                        fontSize: 14,
                        fontWeight: 800,
                        letterSpacing: "0.14em",
                        boxShadow: active
                          ? `0 0 16px ${alpha(palette.accent, 0.24)}`
                          : "none",
                      }}
                    >
                      {pad2(index + 2)}
                    </div>
                  </div>
                  <div style={{ display: "grid", alignContent: "center", gap: 10 }}>
                    {panel.eyebrow ? (
                      <SectionEyebrow text={panel.eyebrow} palette={palette} />
                    ) : null}
                    <div
                      style={{
                        color: palette.text,
                        fontSize: 32,
                        fontWeight: 800,
                        lineHeight: 1.08,
                      }}
                    >
                      {panel.title}
                    </div>
                    <div
                      style={{
                        color: alpha(palette.text, 0.74),
                        fontSize: 19,
                        lineHeight: 1.5,
                      }}
                    >
                      {panel.text}
                    </div>
                    <div
                      style={{
                        marginTop: 4,
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 12,
                        flexWrap: "wrap",
                      }}
                    >
                      <div
                        style={{
                          color: alpha(palette.text, 0.48),
                          fontSize: 15,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        {active ? "active spread" : "queued panel"}
                      </div>
                      {active
                        ? renderWaveBars({
                            frame: frame + index * 3,
                            palette,
                            bars: 6,
                            width: 4,
                            minHeight: 8,
                            maxHeight: 16,
                          })
                        : null}
                    </div>
                  </div>
                </StageFrame>
              );
            })}
          </div>
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
          }}
        >
          <StageFrame palette={palette} radius={26} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                flexWrap: "wrap",
                gap: 16,
                marginBottom: 14,
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.56),
                  fontSize: 16,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Editorial markers
              </div>
              <div
                style={{
                  color: palette.accentAlt,
                  fontSize: 22,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                }}
              >
                {cta}
              </div>
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
              {chips.map((chip, index) => (
                <TagPill key={`${chip}-${index}`} text={chip} palette={palette} light />
              ))}
            </div>
          </StageFrame>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              color: alpha(palette.text, 0.48),
              fontSize: 15,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            <span>{currentPanel?.eyebrow || eyebrow}</span>
            <span>{formatTimecode(durationInFrames / fps)}</span>
          </div>
        </div>
      </div>
      <FooterNote
        left={panels[activePanelIndex]?.title || eyebrow}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const timelineJourneySchema = z.object({
  palette: paletteSchema,
  eyebrow: z.string(),
  headline: z.string(),
  summary: z.string(),
  milestones: z.array(milestoneSchema).min(3).max(5),
  closing: z.string(),
  cta: z.string(),
});

export const TimelineJourneyTemplate: React.FC<
  z.infer<typeof timelineJourneySchema>
> = ({ palette, eyebrow, headline, summary, milestones, closing, cta }) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const activeIndex = Math.min(
    milestones.length - 1,
    Math.floor((frame / durationInFrames) * milestones.length),
  );
  const activeMilestone = milestones[activeIndex];
  const nextMilestone =
    milestones[Math.min(activeIndex + 1, milestones.length - 1)];
  const segmentFrames = durationInFrames / milestones.length;
  const activeWindow = sceneWindow({
    frame,
    start: activeIndex * segmentFrames,
    end: Math.min(durationInFrames, (activeIndex + 1) * segmentFrames + 18),
    fadeIn: 18,
    fadeOut: 18,
  });
  const trackProgress = clamp01(
    (activeIndex + activeWindow) / Math.max(1, milestones.length - 1),
  );

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          inset: 52,
          display: "grid",
          gridTemplateRows: "auto minmax(0, 1fr) auto auto",
          gap: 20,
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > height ? "1fr 0.9fr" : "1fr",
            gap: 18,
            alignItems: "end",
          }}
        >
          <div style={{ display: "grid", gap: 12 }}>
            <SectionEyebrow text={eyebrow} palette={palette} />
            <div
              style={{
                color: palette.text,
                fontSize: width > height ? 84 : 72,
                lineHeight: 0.96,
                letterSpacing: "-0.05em",
                fontWeight: 800,
              }}
            >
              {headline}
            </div>
          </div>
          <StageFrame
            palette={palette}
            radius={26}
            padding={20}
            style={{
              maxWidth: width > height ? 520 : "100%",
            }}
          >
            <div style={{ display: "grid", gap: 10 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: alpha(palette.text, 0.56),
                    fontSize: 16,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Journey status
                </div>
                <TagPill
                  text={`${pad2(activeIndex + 1)} / ${pad2(milestones.length)}`}
                  palette={palette}
                />
              </div>
              <div
                style={{
                  color: alpha(palette.text, 0.74),
                  fontSize: 23,
                  lineHeight: 1.55,
                }}
              >
                {summary}
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: 700,
                  }}
                >
                  {activeMilestone.label}
                </div>
                <div
                  style={{
                    color: alpha(palette.text, 0.48),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  next: {nextMilestone.label}
                </div>
              </div>
            </div>
          </StageFrame>
        </div>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: width > height ? "1.08fr 0.92fr" : "1fr",
            gap: 20,
            minHeight: 0,
          }}
        >
          <MediaSurface
            media={activeMilestone.media}
            palette={palette}
            frame={frame}
            style={{
              minHeight: width > height ? height * 0.36 : 260,
              transform: `perspective(1800px) rotateY(${mix(10, 0, activeWindow)}deg) scale(${mix(0.94, 1, activeWindow)})`,
            }}
          />
          <StageFrame palette={palette} radius={30} padding={26}>
            <div style={{ display: "grid", gap: 14 }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  gap: 12,
                  flexWrap: "wrap",
                }}
              >
                <div
                  style={{
                    color: alpha(palette.text, 0.64),
                    fontSize: 18,
                    letterSpacing: "0.18em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Active Milestone
                </div>
                <TagPill text={activeMilestone.label} palette={palette} />
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 40,
                  lineHeight: 1.02,
                  fontWeight: 800,
                }}
              >
                {activeMilestone.title}
              </div>
              <div
                style={{
                  color: alpha(palette.text, 0.76),
                  fontSize: 21,
                  lineHeight: 1.6,
                }}
              >
                {activeMilestone.text}
              </div>
              <div
                style={{
                  padding: "14px 16px",
                  borderRadius: 22,
                  background: alpha("#ffffff", 0.05),
                  border: `1px solid ${alpha("#ffffff", 0.06)}`,
                  display: "grid",
                  gap: 10,
                }}
              >
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      color: alpha(palette.text, 0.52),
                      fontSize: 15,
                      letterSpacing: "0.16em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Timeline progress
                  </div>
                  <div
                    style={{
                      color: palette.text,
                      fontSize: 16,
                      fontWeight: 700,
                    }}
                  >
                    {Math.round(trackProgress * 100)}%
                  </div>
                </div>
                <div
                  style={{
                    height: 6,
                    borderRadius: 999,
                    background: alpha("#ffffff", 0.08),
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${trackProgress * 100}%`,
                      height: "100%",
                      borderRadius: 999,
                      background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                      boxShadow: `0 0 16px ${alpha(palette.accent, 0.22)}`,
                    }}
                  />
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: 12,
                    flexWrap: "wrap",
                  }}
                >
                  <div
                    style={{
                      color: alpha(palette.text, 0.46),
                      fontSize: 15,
                      letterSpacing: "0.12em",
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    next checkpoint
                  </div>
                  <div
                    style={{
                      color: palette.accentAlt,
                      fontSize: 17,
                      fontWeight: 800,
                    }}
                  >
                    {nextMilestone.title}
                  </div>
                </div>
              </div>
            </div>
          </StageFrame>
        </div>

        <div
          style={{
            position: "relative",
            display: "grid",
            gridTemplateColumns: `repeat(${milestones.length}, minmax(0, 1fr))`,
            gap: 12,
            alignItems: "center",
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              width: `${trackProgress * 100}%`,
              top: 28,
              height: 2,
              background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
              boxShadow: `0 0 16px ${alpha(palette.accent, 0.18)}`,
              zIndex: 0,
            }}
          />
          {milestones.map((milestone, index) => {
            const active = index <= activeIndex;
            return (
              <div
                key={`${milestone.label}-${index}`}
                style={{
                  position: "relative",
                  display: "grid",
                  gap: 12,
                  zIndex: 1,
                }}
              >
                <div
                  style={{
                    justifySelf: "center",
                    width: active ? 26 : 18,
                    height: active ? 26 : 18,
                    borderRadius: 999,
                    background: active
                      ? `linear-gradient(135deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`
                      : alpha("#ffffff", 0.18),
                    boxShadow: active
                      ? `0 0 26px ${alpha(palette.accent, 0.28)}`
                      : "none",
                  }}
                />
                <StageFrame
                  palette={palette}
                  radius={22}
                  padding={16}
                  style={{
                    minHeight: 126,
                    transform: `translateY(${active ? 0 : 10}px)`,
                    opacity: active ? 1 : 0.74,
                    borderColor: active
                      ? alpha(palette.accentAlt, 0.24)
                      : alpha("#ffffff", 0.08),
                  }}
                >
                  <div style={{ display: "grid", gap: 8 }}>
                    <div
                      style={{
                        color: active ? palette.accentAlt : alpha(palette.text, 0.46),
                        fontSize: 15,
                        letterSpacing: "0.16em",
                        textTransform: "uppercase",
                        fontWeight: 800,
                      }}
                    >
                      {milestone.label}
                    </div>
                    <div
                      style={{
                        color: active ? palette.text : alpha(palette.text, 0.64),
                        fontSize: 20,
                        lineHeight: 1.28,
                        fontWeight: 700,
                      }}
                    >
                      {milestone.title}
                    </div>
                    <div
                      style={{
                        color: active ? alpha(palette.text, 0.68) : alpha(palette.text, 0.4),
                        fontSize: 14,
                        letterSpacing: "0.12em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      {active ? "unlocked" : "up next"}
                    </div>
                  </div>
                </StageFrame>
              </div>
            );
          })}
        </div>

        <div
          style={{
            display: "grid",
            gap: 14,
          }}
        >
          <StageFrame palette={palette} radius={26} padding={18}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 18,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.72),
                  fontSize: 21,
                  lineHeight: 1.5,
                  maxWidth: 820,
                }}
              >
                {closing}
              </div>
              <TagPill text={cta} palette={palette} />
            </div>
          </StageFrame>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              gap: 12,
              color: alpha(palette.text, 0.48),
              fontSize: 15,
              letterSpacing: "0.16em",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            <span>{activeMilestone.label}</span>
            <span>{formatTimecode(durationInFrames / fps)}</span>
          </div>
        </div>
      </div>
      <FooterNote
        left={activeMilestone.label}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};

export const socialProofWallSchema = z.object({
  palette: paletteSchema,
  eyebrow: z.string(),
  headline: z.string(),
  summary: z.string(),
  heroMedia: mediaSchema,
  rating: z.string(),
  proofStats: z.array(metricSchema).min(2).max(4),
  testimonials: z.array(testimonialSchema).min(3).max(5),
  cta: z.string(),
});

export const SocialProofWallTemplate: React.FC<
  z.infer<typeof socialProofWallSchema>
> = ({
  palette,
  eyebrow,
  headline,
  summary,
  heroMedia,
  rating,
  proofStats,
  testimonials,
  cta,
}) => {
  const frame = useCurrentFrame();
  const { fps, durationInFrames, width, height } = useVideoConfig();
  const activeIndex = Math.min(
    testimonials.length - 1,
    Math.floor((frame / durationInFrames) * testimonials.length),
  );
  const activeTestimonial = testimonials[activeIndex] ?? testimonials[0];
  const proofProgress = clamp01(frame / Math.max(1, durationInFrames - 1));

  return (
    <GradientStage palette={palette} frame={frame}>
      <div
        style={{
          position: "absolute",
          inset: 48,
          display: "grid",
          gridTemplateColumns: width > height ? "0.94fr 1.06fr" : "1fr",
          gap: 20,
        }}
      >
        <div style={{ display: "grid", alignContent: "space-between", gap: 20 }}>
          <div style={{ display: "grid", gap: 12 }}>
            <TagPill text={eyebrow} palette={palette} light />
            <div
              style={{
                color: palette.text,
                fontSize: width > height ? 82 : 72,
                lineHeight: 0.96,
                fontWeight: 800,
                letterSpacing: "-0.05em",
              }}
            >
              {headline}
            </div>
            <div
              style={{
                color: alpha(palette.text, 0.74),
                fontSize: 23,
                lineHeight: 1.55,
                maxWidth: 560,
              }}
            >
              {summary}
            </div>
          </div>

          <div style={{ position: "relative" }}>
            <MediaSurface
              media={heroMedia}
              palette={palette}
              frame={frame}
              style={{
                minHeight: width > height ? height * 0.34 : 260,
              }}
            />
            <div
              style={{
                position: "absolute",
                left: 20,
                right: 20,
                top: 20,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <TagPill text="Case Library" palette={palette} />
              <div
                style={{
                  color: alpha(palette.text, 0.62),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {pad2(activeIndex + 1)} / {pad2(testimonials.length)} now live
              </div>
            </div>
            <div
              style={{
                position: "absolute",
                left: 22,
                right: 22,
                bottom: 22,
                display: "grid",
                gap: 8,
              }}
            >
              <div
                style={{
                  color: alpha(palette.text, 0.54),
                  fontSize: 14,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                highlighted customer
              </div>
              <div
                style={{
                  color: palette.text,
                  fontSize: 24,
                  lineHeight: 1.2,
                  fontWeight: 700,
                }}
              >
                {activeTestimonial.author} / {activeTestimonial.role}
              </div>
            </div>
          </div>

          <StageFrame palette={palette} radius={30} padding={24}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "baseline",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              <div
                style={{
                  color: palette.text,
                  fontSize: 54,
                  fontWeight: 900,
                  lineHeight: 1,
                }}
              >
                {rating}
              </div>
              <div
                style={{
                  color: palette.accentAlt,
                  fontSize: 18,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                }}
              >
                Social Proof
              </div>
            </div>
            <div
              style={{
                marginTop: 14,
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                flexWrap: "wrap",
              }}
            >
              {renderSignalDots({
                count: 5,
                activeCount: 5,
                palette,
              })}
              <div
                style={{
                  color: alpha(palette.text, 0.5),
                  fontSize: 15,
                  letterSpacing: "0.16em",
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                {testimonials.length} verified voices
              </div>
            </div>
            <div
              style={{
                marginTop: 16,
                height: 6,
                borderRadius: 999,
                background: alpha("#ffffff", 0.08),
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${proofProgress * 100}%`,
                  height: "100%",
                  borderRadius: 999,
                  background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                  boxShadow: `0 0 16px ${alpha(palette.accent, 0.22)}`,
                }}
              />
            </div>
            <div style={{ marginTop: 18 }}>
              <MetricGrid items={proofStats} palette={palette} columns={2} />
            </div>
          </StageFrame>
        </div>

        <div style={{ display: "grid", gap: 18 }}>
          {testimonials.map((item, index) => {
            const active = activeIndex === index;
            const reveal = clamp01((frame - index * 8) / 18);
            const localProgress = clamp01(
              (frame - index * (durationInFrames / testimonials.length)) /
                (durationInFrames / testimonials.length),
            );

            return (
              <StageFrame
                key={`${item.author}-${index}`}
                palette={palette}
                radius={28}
                padding={24}
                style={{
                  display: "grid",
                  gridTemplateColumns:
                    item.media && width > height ? "0.86fr 1.14fr" : "1fr",
                  gap: 18,
                  alignItems: "center",
                  transform: `translateX(${active ? mix(42, 0, reveal) : 0}px) scale(${active ? 1.01 : 0.97})`,
                  opacity: mix(0.4, active ? 1 : 0.74, reveal),
                  borderColor: active
                    ? alpha(palette.accentAlt, 0.42)
                    : alpha("#ffffff", 0.12),
                }}
              >
                {item.media ? (
                  <MediaSurface
                    media={item.media}
                    palette={palette}
                    frame={frame + index * 4}
                    radius={22}
                    style={{ minHeight: 190 }}
                  />
                ) : null}
                <div style={{ display: "grid", gap: 12 }}>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div
                      style={{
                        color: active ? palette.accentAlt : alpha(palette.text, 0.46),
                        fontSize: 15,
                        letterSpacing: "0.18em",
                        textTransform: "uppercase",
                        fontWeight: 800,
                      }}
                    >
                      Review {pad2(index + 1)}
                    </div>
                    <div
                      style={{
                        color: alpha(palette.text, 0.5),
                        fontSize: 14,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      {active ? "active proof" : "queueing"}
                    </div>
                  </div>
                  <div
                    style={{
                      color: palette.text,
                      fontSize: active ? 30 : 25,
                      lineHeight: 1.34,
                      fontWeight: 700,
                      fontFamily: "Georgia, Baskerville, serif",
                    }}
                  >
                    {item.quote}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      {active
                        ? renderWaveBars({
                            frame: frame + index * 4,
                            palette,
                            bars: 6,
                            width: 4,
                            minHeight: 8,
                            maxHeight: 16,
                          })
                        : null}
                      <div
                        style={{
                          color: alpha(palette.text, 0.46),
                          fontSize: 14,
                          letterSpacing: "0.14em",
                          textTransform: "uppercase",
                          fontWeight: 700,
                        }}
                      >
                        customer signal
                      </div>
                    </div>
                    <TagPill text={item.score} palette={palette} />
                  </div>
                  {active ? (
                    <div
                      style={{
                        height: 6,
                        borderRadius: 999,
                        background: alpha("#ffffff", 0.08),
                        overflow: "hidden",
                      }}
                    >
                      <div
                        style={{
                          width: `${localProgress * 100}%`,
                          height: "100%",
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${palette.accent} 0%, ${palette.accentAlt} 100%)`,
                          boxShadow: `0 0 14px ${alpha(palette.accent, 0.22)}`,
                        }}
                      />
                    </div>
                  ) : null}
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: 12,
                      flexWrap: "wrap",
                    }}
                  >
                    <div style={{ display: "grid", gap: 4 }}>
                      <div
                        style={{
                          color: palette.text,
                          fontSize: 18,
                          fontWeight: 800,
                          textTransform: "uppercase",
                          letterSpacing: "0.12em",
                        }}
                      >
                        {item.author}
                      </div>
                      <div
                        style={{
                          color: alpha(palette.text, 0.62),
                          fontSize: 16,
                        }}
                      >
                        {item.role}
                      </div>
                    </div>
                    <div
                      style={{
                        color: alpha(palette.text, 0.46),
                        fontSize: 14,
                        letterSpacing: "0.14em",
                        textTransform: "uppercase",
                        fontWeight: 700,
                      }}
                    >
                      {formatTimecode((index / testimonials.length) * (durationInFrames / fps))}
                    </div>
                  </div>
                </div>
              </StageFrame>
            );
          })}

          <StageFrame
            palette={palette}
            radius={24}
            padding={18}
            style={{ justifySelf: "stretch" }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "grid", gap: 6 }}>
                <div
                  style={{
                    color: alpha(palette.text, 0.48),
                    fontSize: 15,
                    letterSpacing: "0.16em",
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  now highlighted
                </div>
                <div
                  style={{
                    color: palette.text,
                    fontSize: 22,
                    fontWeight: 700,
                  }}
                >
                  {activeTestimonial.author}
                </div>
              </div>
              <div
                style={{
                  color: palette.accentAlt,
                  fontSize: 22,
                  letterSpacing: "0.18em",
                  textTransform: "uppercase",
                  fontWeight: 800,
                }}
              >
                {cta}
              </div>
            </div>
          </StageFrame>
        </div>
      </div>
      <FooterNote
        left={testimonials[activeIndex]?.author || eyebrow}
        right={formatDurationLabel({ fps, durationInFrames })}
        palette={palette}
      />
    </GradientStage>
  );
};
