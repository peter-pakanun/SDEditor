export function getInitialSearchParams() {
  if (!import.meta.client) return new URLSearchParams();
  return new URLSearchParams(window.location.search);
}

export function getInitialTestMode() {
  const params = getInitialSearchParams();
  if (!params.has("testMode")) return false;
  const value = (params.get("testMode") || "").toLowerCase();
  return value === "" || value === "1" || value === "true" || value === "yes";
}

export function getInitialUrlLang() {
  return getInitialSearchParams().get("lang");
}
