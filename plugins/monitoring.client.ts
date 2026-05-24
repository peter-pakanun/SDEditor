import { createLogger } from "~/utils/logger";

export default defineNuxtPlugin((nuxtApp) => {
  const config = useRuntimeConfig();
  const logger = createLogger("monitoring", config.public.logLevel);
  const endpoint = String(config.public.monitoringEndpoint || "");

  function report(kind: string, error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    const stack = error instanceof Error ? error.stack : undefined;
    const payload = { kind, message, stack, href: window.location.href, ts: new Date().toISOString() };

    logger.error(kind, payload);
    if (!endpoint) return;

    const body = JSON.stringify(payload);
    if (navigator.sendBeacon) {
      navigator.sendBeacon(endpoint, new Blob([body], { type: "application/json" }));
      return;
    }
    fetch(endpoint, { method: "POST", body, headers: { "content-type": "application/json" }, keepalive: true }).catch(() => {});
  }

  window.addEventListener("error", (event) => report("window-error", event.error || event.message));
  window.addEventListener("unhandledrejection", (event) => report("unhandled-rejection", event.reason));
  nuxtApp.vueApp.config.errorHandler = (error) => report("vue-error", error);
});
