/**
 * chat-v2 theme — design tokens for the React-only chat surface.
 *
 * We intentionally do NOT use the dashboard's retro/CRT palette
 * (emerald on black, monospace tracking-wide headers). The new
 * surface follows a Linear / Notion / Raycast-style "productivity
 * app" aesthetic:
 *
 *   - System sans for UI (Inter, -apple-system, system-ui)
 *   - Mono only inside code blocks (we keep a mono font there)
 *   - Dark slate surfaces (zinc-950) instead of pure black
 *   - Single accent color (a quiet blue) for primary actions
 *   - Generous spacing (8/12/16/24 scale)
 *   - Soft rounded corners (rounded-2xl on cards, rounded-xl on inputs)
 *
 * All values are exposed as Tailwind classes here so components stay
 * declarative — no inline styles, no CSS modules. If we later extend
 * to other pages, this file becomes the source of truth and the
 * other pages import from chat-v2/theme.
 */

export const theme = {
  // Backgrounds — dark slate, not pure black
  bg: {
    page: "bg-zinc-950", // outermost (the <main>)
    panel: "bg-zinc-900", // composer / message list surface
    elevated: "bg-zinc-800", // bubbles, modals
    subtle: "bg-zinc-900/60", // hover states
  },
  // Text — no more emerald-on-black
  text: {
    primary: "text-zinc-50",
    secondary: "text-zinc-300",
    tertiary: "text-zinc-400",
    muted: "text-zinc-500",
    onAccent: "text-white",
  },
  // Borders — soft slate
  border: {
    default: "border-zinc-800",
    strong: "border-zinc-700",
    subtle: "border-zinc-800/60",
  },
  // Accent — single blue for actionable elements
  accent: {
    bg: "bg-indigo-600",
    bgHover: "hover:bg-indigo-500",
    text: "text-indigo-400",
    textStrong: "text-indigo-300",
    border: "border-indigo-500/40",
    ring: "focus:ring-indigo-500/40",
  },
  // Status colors
  status: {
    success: "text-emerald-400",
    warning: "text-amber-400",
    error: "text-rose-400",
    info: "text-sky-400",
  },
  // Spacing scale (Tailwind already exposes these; we just document
  // the rhythm we use here so components stay consistent)
  space: {
    xs: "1", // 4px
    sm: "2", // 8px
    md: "3", // 12px
    lg: "4", // 16px
    xl: "6", // 24px
  },
  // Radii
  radius: {
    sm: "rounded-md",
    md: "rounded-lg",
    lg: "rounded-xl",
    xl: "rounded-2xl",
    full: "rounded-full",
  },
  // Typography
  font: {
    sans: "font-sans", // system-ui / Inter / -apple-system fallback
    mono: "font-mono", // JetBrains Mono / Menlo / Consolas fallback
  },
} as const;

export const fontStack = {
  sans:
    '"Inter", -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
  mono:
    '"JetBrains Mono", "Fira Code", Menlo, Monaco, Consolas, "Liberation Mono", monospace',
} as const;
