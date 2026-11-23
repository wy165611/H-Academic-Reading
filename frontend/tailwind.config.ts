import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        ink: "#1c1c1c",
        paper: "#f9f8f6",
        graphite: "#6b7280",
        mauve: "#816d70",
      },
      fontFamily: {
        serif: ["Georgia", "'Times New Roman'", "'Songti SC'", "'Noto Serif SC'", "serif"],
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "'PingFang SC'", "sans-serif"],
      },
      borderRadius: {
        none: "0px",
        DEFAULT: "0px",
      },
    },
  },
  plugins: [],
};

export default config;
