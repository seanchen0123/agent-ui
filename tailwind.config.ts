import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

export default {
  darkMode: ["class"],

  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],

  theme: {
    extend: {
      colors: {
        primary: "rgb(var(--color-primary) / <alpha-value>)",
        primaryAccent: "rgb(var(--color-primary-accent) / <alpha-value>)",
        brand: "rgb(var(--color-brand) / <alpha-value>)",
        background: {
          DEFAULT: "rgb(var(--color-background) / <alpha-value>)",
          secondary:
            "rgb(var(--color-background-secondary) / <alpha-value>)",
        },
        secondary: "rgb(var(--color-secondary) / <alpha-value>)",
        border: "rgb(var(--color-border-default) / <alpha-value>)",
        accent: "rgb(var(--color-accent) / <alpha-value>)",
        muted: "rgb(var(--color-muted) / <alpha-value>)",
        destructive: "rgb(var(--color-destructive) / <alpha-value>)",
        positive: "rgb(var(--color-positive) / <alpha-value>)",
      },
      fontFamily: {
        geist: "var(--font-geist-sans)",
        dmmono: "var(--font-dm-mono)",
      },
      borderRadius: {
        xl: "10px",
      },
    },
  },

  plugins: [tailwindcssAnimate],
} satisfies Config;