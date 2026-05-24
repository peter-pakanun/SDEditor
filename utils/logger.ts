export type LogLevel = "debug" | "info" | "warn" | "error" | "silent";

const weights: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
  silent: 100,
};

function normalizeLevel(level: unknown): LogLevel {
  const value = String(level || "info").toLowerCase();
  return value in weights ? (value as LogLevel) : "info";
}

export function createLogger(scope: string, level: unknown = "info") {
  const configured = normalizeLevel(level);

  function shouldLog(messageLevel: LogLevel) {
    return weights[messageLevel] >= weights[configured];
  }

  function write(messageLevel: Exclude<LogLevel, "silent">, message: string, context?: unknown) {
    if (!shouldLog(messageLevel)) return;
    const payload = { scope, message, context, ts: new Date().toISOString() };
    const method = messageLevel === "debug" ? "debug" : messageLevel;
    console[method]("[" + scope + "] " + message, payload);
  }

  return {
    debug: (message: string, context?: unknown) => write("debug", message, context),
    info: (message: string, context?: unknown) => write("info", message, context),
    warn: (message: string, context?: unknown) => write("warn", message, context),
    error: (message: string, context?: unknown) => write("error", message, context),
  };
}
