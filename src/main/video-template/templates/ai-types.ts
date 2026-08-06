import type { Palette } from "./shared";

/**
 * Palette configuration for AI-composed videos.
 * Use a preset name to pick from built-in palettes, optionally overriding individual colors,
 * or supply a fully custom palette object.
 */
export type PaletteConfig =
  | { preset: string; custom?: Partial<Palette> }
  | { custom: Palette };

/** Layer types the AI agent can compose into a scene. */
export type LayerType =
  | "eyebrow"
  | "headline"
  | "subtitle"
  | "text"
  | "badge-row"
  | "price"
  | "metrics"
  | "features"
  | "media"
  | "cta"
  | "quote"
  | "divider"
  | "progress-bar"
  | "bullet-list"
  // === NEW AI-POWERED LAYER TYPES ===
  | "countdown"
  | "image-grid"
  | "testimonial"
  | "logo-reveal"
  | "comparison"
  | "chapter-marker"
  | "rating"
  | "social-proof"
  | "split-media"
  | "accent-box";

/** Animation style for layer entrance. */
export type AnimationStyle =
  | "fade-up"     // default: fade + slide up
  | "fade-in"     // simple opacity fade
  | "slide-left"  // slide in from left
  | "slide-right" // slide in from right
  | "zoom-in"     // scale from 0.6 to 1
  | "zoom-out"    // scale from 1.4 to 1
  | "rotate-in"   // rotate + fade
  | "bounce"      // spring bounce
  | "typewriter"; // character-by-character reveal (for text layers)

/** Layout preset for scene content. */
export type SceneLayout =
  | "centered"     // default: vertically + horizontally centered
  | "top"          // aligned to top
  | "bottom"       // aligned to bottom
  | "split-left"   // text left, media right
  | "split-right"  // media left, text right
  | "fullscreen"   // media fills entire frame
  | "grid";        // grid layout for multiple items

/** Base fields shared by every layer. */
interface LayerBase {
  /** Delay in frames before this layer begins its entrance animation. */
  delayFrames?: number;
  /** Animation style for entrance. Defaults to "fade-up". */
  animation?: AnimationStyle;
  /** Opacity override (0-1). Defaults to 1. */
  opacity?: number;
}

/** Section eyebrow label with accent bar. */
export interface EyebrowLayer extends LayerBase {
  type: "eyebrow";
  text: string;
}

/** Large bold headline text. */
export interface HeadlineLayer extends LayerBase {
  type: "headline";
  text: string;
  /** Font size override (default ~60). */
  fontSize?: number;
  /** Max lines before truncation. */
  maxLines?: number;
}

/** Medium-weight subtitle below the headline. */
export interface SubtitleLayer extends LayerBase {
  type: "subtitle";
  text: string;
}

/** Body text block. */
export interface TextLayer extends LayerBase {
  type: "text";
  text: string;
  /** Optional max-width in px. */
  maxWidth?: number;
}

/** Row of tag / badge pills. */
export interface BadgeRowLayer extends LayerBase {
  type: "badge-row";
  badges: string[];
}

/** Price display with optional original price strikethrough. */
export interface PriceLayer extends LayerBase {
  type: "price";
  price: string;
  originalPrice?: string;
  label?: string;
}

/** Animated metric cards. */
export interface MetricsLayer extends LayerBase {
  type: "metrics";
  items: Array<{ label: string; value: string; detail?: string }>;
  /** Grid columns (1-4, default 2). */
  columns?: number;
}

/** Stacked feature cards. */
export interface FeaturesLayer extends LayerBase {
  type: "features";
  items: Array<{ eyebrow?: string; title: string; text: string }>;
}

/** Image or video media surface. */
export interface MediaLayer extends LayerBase {
  type: "media";
  media: { type: "image" | "video"; src: string; poster?: string; alt?: string };
  /** Width as CSS value (default "100%"). */
  width?: string;
  /** Height as CSS value (default "480px"). */
  height?: string;
  /** Border radius in px (default 0). */
  borderRadius?: number;
}

/** Call-to-action button display. */
export interface CtaLayer extends LayerBase {
  type: "cta";
  text: string;
  subtext?: string;
  /** Button style: "pill" (default), "square", "outline". */
  buttonStyle?: "pill" | "square" | "outline";
}

/** Large italic quote with decorative quote marks. */
export interface QuoteLayer extends LayerBase {
  type: "quote";
  text: string;
  author?: string;
}

/** Thin horizontal divider line. */
export interface DividerLayer extends LayerBase {
  type: "divider";
  /** Divider color override. */
  color?: string;
}

/** Animated progress bar row. */
export interface ProgressBarLayer extends LayerBase {
  type: "progress-bar";
  items: Array<{ label: string; value: number; color?: string }>;
}

/** Bullet-point list. */
export interface BulletListLayer extends LayerBase {
  type: "bullet-list";
  items: string[];
  /** List style: "bullet" (default), "number", "check". */
  listStyle?: "bullet" | "number" | "check";
}

// === NEW AI-POWERED LAYER TYPES ===

/** Countdown timer display. */
export interface CountdownLayer extends LayerBase {
  type: "countdown";
  /** Target number to count to/from. */
  value: number;
  /** Label below the number. */
  label?: string;
  /** Prefix like "$" or "¥". */
  prefix?: string;
  /** Suffix like "%" or "天". */
  suffix?: string;
  /** Duration of count animation in seconds (default 1.5). */
  animDuration?: number;
}

/** Grid of images (2x2, 3x3, etc). */
export interface ImageGridLayer extends LayerBase {
  type: "image-grid";
  images: Array<{ src: string; alt?: string }>;
  /** Grid columns (2-4, default 2). */
  columns?: number;
  /** Gap between images in px (default 8). */
  gap?: number;
  /** Border radius in px (default 12). */
  borderRadius?: number;
}

/** Customer testimonial / review. */
export interface TestimonialLayer extends LayerBase {
  type: "testimonial";
  text: string;
  author?: string;
  /** Star rating 1-5. */
  stars?: number;
  /** Author avatar image. */
  avatar?: string;
}

/** Logo reveal animation. */
export interface LogoRevealLayer extends LayerBase {
  type: "logo-reveal";
  /** Logo image source. */
  src: string;
  /** Logo width (default 200px). */
  width?: number;
  /** Logo height (default 200px). */
  height?: number;
  /** Company/brand name below logo. */
  name?: string;
}

/** Before/After comparison. */
export interface ComparisonLayer extends LayerBase {
  type: "comparison";
  before: { src: string; label?: string };
  after: { src: string; label?: string };
  /** Divider position 0-100 (default 50). */
  dividerPosition?: number;
}

/** Chapter/section marker. */
export interface ChapterMarkerLayer extends LayerBase {
  type: "chapter-marker";
  /** Chapter number. */
  number: number | string;
  /** Chapter title. */
  title: string;
}

/** Star rating display. */
export interface RatingLayer extends LayerBase {
  type: "rating";
  /** Rating value 0-5. */
  value: number;
  /** Maximum stars (default 5). */
  max?: number;
  /** Review count text. */
  count?: string;
}

/** Social proof counter (e.g., "10,000+ happy customers"). */
export interface SocialProofLayer extends LayerBase {
  type: "social-proof";
  value: string;
  label: string;
  /** Icon emoji or text. */
  icon?: string;
}

/** Split screen with media on one side and text on the other. */
export interface SplitMediaLayer extends LayerBase {
  type: "split-media";
  media: { type: "image" | "video"; src: string };
  /** "left" = media on left, text on right; "right" = opposite. */
  side?: "left" | "right";
  /** Text content on the other side. */
  text?: string;
  /** Headline text. */
  headline?: string;
}

/** Accent box / callout card. */
export interface AccentBoxLayer extends LayerBase {
  type: "accent-box";
  text: string;
  /** Box style: "filled" (default), "bordered", "glow". */
  boxStyle?: "filled" | "bordered" | "glow";
}

/** Union of all layer types the AI can compose. */
export type SceneLayer =
  | EyebrowLayer
  | HeadlineLayer
  | SubtitleLayer
  | TextLayer
  | BadgeRowLayer
  | PriceLayer
  | MetricsLayer
  | FeaturesLayer
  | MediaLayer
  | CtaLayer
  | QuoteLayer
  | DividerLayer
  | ProgressBarLayer
  | BulletListLayer
  | CountdownLayer
  | ImageGridLayer
  | TestimonialLayer
  | LogoRevealLayer
  | ComparisonLayer
  | ChapterMarkerLayer
  | RatingLayer
  | SocialProofLayer
  | SplitMediaLayer
  | AccentBoxLayer;

/** Scene background configuration. */
export type SceneBackground =
  | { type: "gradient" }
  | { type: "solid"; color?: string }
  | { type: "media"; media: { type: "image" | "video"; src: string; poster?: string; alt?: string }; opacity?: number };

/** Transition between scenes. */
export type SceneTransition = "cut" | "fade" | "slide-left" | "slide-right" | "zoom";

/** A single scene in the video timeline. */
export interface SceneConfig {
  /** Duration of this scene in seconds. */
  duration: number;
  /** Scene background. Defaults to gradient if omitted. */
  background?: SceneBackground;
  /** Ordered list of layers to render on top of the background. */
  layers: SceneLayer[];
  /** Transition used when entering this scene. Defaults to "fade". */
  transition?: SceneTransition;
  /** Layout preset for this scene. Defaults to "centered". */
  layout?: SceneLayout;
  /** Vertical padding in px (default 60). */
  paddingY?: number;
  /** Horizontal padding in px (default 48). */
  paddingX?: number;
  /** Gap between layers in px (default 22). */
  gap?: number;
}

/** Video orientation preset. */
export type VideoOrientation = "portrait" | "landscape" | "square";

/** Top-level video configuration that the AI agent generates. */
export interface VideoConfig {
  meta: {
    /** Video title (used for metadata only). */
    title: string;
    /** Orientation preset. Defaults to "portrait". */
    orientation?: VideoOrientation;
    /** Target FPS. Defaults to 30. */
    fps?: number;
  };
  /** Color palette for the entire video. */
  palette: PaletteConfig;
  /** Ordered list of scenes. */
  scenes: SceneConfig[];
}

/** Props that the Remotion AiUniversal composition receives. */
export interface AiVideoProps {
  videoConfig: VideoConfig;
}
