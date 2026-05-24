import type { Config } from "tailwindcss";

export default <Partial<Config>>{
  theme: {
    extend: {
      colors: {
        app: {
          bg: "var(--color-bg)",
          bg2: "var(--color-bg2)",
          element: "var(--color-element)",
          "element-alt": "var(--color-element-alt)",
          highlight: "var(--color-element-highlight)",
          accent: "var(--color-accent)",
          font: "var(--color-font)",
        },
      },
      boxShadow: {
        app: "2px 2px 2px var(--color-shadow)",
        popup: "2px 2px 4px var(--color-shadow)",
      },
      fontFamily: {
        app: ["Sarabun", "sans-serif"],
        fontin: ["Fontin", "serif"],
        "fontin-smallcaps": ["Fontin Smallcaps", "Fontin", "serif"],
        "friz-quadrata": ["Friz Quadrata", "Friz Quadrata ITC", "serif"],
      },
    },
  },
};
