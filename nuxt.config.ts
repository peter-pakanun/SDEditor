export default defineNuxtConfig({
  ssr: false,
  compatibilityDate: "2026-05-24",
  modules: ["@pinia/nuxt", "@nuxtjs/tailwindcss"],
  tailwindcss: {
    cssPath: "~/assets/css/tailwind.css",
    viewer: false,
  },
  devtools: { enabled: false },
  runtimeConfig: {
    public: {
      appName: process.env.NUXT_PUBLIC_APP_NAME || "SDEditor",
      logLevel: process.env.NUXT_PUBLIC_LOG_LEVEL || "info",
      monitoringEndpoint: process.env.NUXT_PUBLIC_MONITORING_ENDPOINT || "",
    },
  },
  app: {
    head: {
      title: "SDEditor",
      meta: [
        { name: "viewport", content: "width=device-width, initial-scale=1" },
        { name: "description", content: "Path of Exile StatDescriptions translation editor" },
      ],
      link: [
        { rel: "manifest", href: "/site.webmanifest" },
        { rel: "icon", href: "/favicon.ico" },
        {
          rel: "stylesheet",
          href: "https://fonts.googleapis.com/css2?family=Sarabun&family=Kanit:wght@400;600;700&family=Noto+Sans+JP:wght@400;600;700&family=Noto+Sans+KR:wght@400;600;700&family=Noto+Sans+SC:wght@400;600;700&family=Noto+Sans+TC:wght@400;600;700&display=swap",
        },
        {
          rel: "stylesheet",
          href: "https://cdn.jsdelivr.net/gh/spoqa/spoqa-han-sans@master/css/SpoqaHanSansNeo.css",
        },
      ],
    },
  },
  nitro: {
    preset: process.env.NITRO_PRESET || "node-server",
    compressPublicAssets: true,
  },
  vite: {
    build: {
      cssCodeSplit: true,
    },
    optimizeDeps: {
      include: ["diff", "file-saver", "jszip"],
    },
  },
});
