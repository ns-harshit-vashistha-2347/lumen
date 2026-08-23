import type { Config } from "tailwindcss";

const c = (v: string) => `rgb(var(--c-${v}) / <alpha-value>)`;

const config: Config = {
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: {
          DEFAULT: c("bg"),
          soft: c("bg-soft"),
          raised: c("bg-raised"),
        },
        chrome: {
          DEFAULT: c("chrome"),
          hover: c("chrome-hover"),
          border: c("chrome-border"),
        },
        line: {
          DEFAULT: c("line"),
          soft: c("line-soft"),
        },
        ink: {
          DEFAULT: c("ink"),
          muted: c("ink-muted"),
          dim: c("ink-dim"),
          faint: c("ink-faint"),
        },
        prompt: {
          DEFAULT: c("prompt"),
          soft: c("prompt-soft"),
          glow: c("prompt-glow"),
        },
        mk: {
          pink: c("mk-pink"),
          green: c("mk-green"),
          yellow: c("mk-yellow"),
          orange: c("mk-orange"),
          purple: c("mk-purple"),
          blue: c("mk-blue"),
          comment: c("mk-comment"),
        },
        ok: {
          DEFAULT: c("ok"),
          soft: c("ok-soft"),
        },
        warn: c("warn"),
        danger: c("danger"),
      },
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: [
          "var(--font-mono)",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "monospace",
        ],
      },
      borderRadius: {
        DEFAULT: "4px",
      },
      boxShadow: {
        block:
          "0 1px 0 0 rgba(255,255,255,0.03) inset, 0 8px 24px -12px rgba(0,0,0,0.7)",
        prompt:
          "0 0 0 1px rgb(var(--c-prompt) / 0.45), 0 0 24px -6px rgb(var(--c-prompt) / 0.5)",
        glow: "0 0 12px -2px rgb(var(--c-prompt) / 0.6)",
        term:
          "inset 0 0 0 1px rgb(var(--c-chrome-border)), 0 20px 40px -20px rgba(0,0,0,0.8)",
      },
      backgroundImage: {
        "warp-grid":
          "linear-gradient(rgb(var(--c-prompt) / 0.05) 1px, transparent 1px), linear-gradient(90deg, rgb(var(--c-prompt) / 0.05) 1px, transparent 1px)",
        "warp-glow":
          "radial-gradient(80% 60% at 100% 0%, rgb(var(--c-prompt) / 0.12), transparent 60%)",
        "scanline":
          "repeating-linear-gradient(0deg, rgba(255,255,255,0.015) 0px, rgba(255,255,255,0.015) 1px, transparent 1px, transparent 3px)",
      },
      animation: {
        blink: "blink 1s steps(2) infinite",
        "bar-shimmer": "barShimmer 1.4s ease-in-out infinite",
        "pulse-ring": "pulseRing 1.6s ease-out infinite",
        "fade-in": "fadeIn 200ms ease-out",
        "slide-up": "slideUp 240ms cubic-bezier(0.16, 1, 0.3, 1)",
        flicker: "flicker 3s linear infinite",
      },
      keyframes: {
        blink: { "0%, 49%": { opacity: "1" }, "50%, 100%": { opacity: "0" } },
        barShimmer: {
          "0%, 100%": { transform: "translateX(-100%)" },
          "60%": { transform: "translateX(100%)" },
        },
        pulseRing: {
          "0%": { transform: "scale(0.6)", opacity: "1" },
          "100%": { transform: "scale(2.4)", opacity: "0" },
        },
        fadeIn: { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp: {
          from: { opacity: "0", transform: "translateY(6px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        flicker: {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.97" },
        },
      },
    },
  },
  plugins: [],
};

export default config;
