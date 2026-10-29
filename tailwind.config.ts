import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        canvas: "#FFFFFF",
        panel: "#F8F9FA",
        line: "#E5E7EB",
        muted: "#737373",
        accent: "#6D5AE6",
        ink: "#171717",
        hover: "#F3F4F6",
        success: "#39745A",
        danger: "#B34B4B",
      },
      fontFamily: {
        sans: ["Geist", "Inter", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["'Geist Mono'", "ui-monospace", "monospace"],
      },
      keyframes: {
        appear: { "0%": { opacity: "0", transform: "translateY(6px)" }, "100%": { opacity: "1", transform: "translateY(0)" } },
      },
      animation: { appear: "appear 180ms ease-out" },
    },
  },
  plugins: [],
};
export default config;
