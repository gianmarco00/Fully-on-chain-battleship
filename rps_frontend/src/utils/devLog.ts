type LogData = Record<string, unknown>;

function makeJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
    };
  }
  if (Array.isArray(value)) return value.map(makeJsonSafe);
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      makeJsonSafe(item),
    ])
  );
}

export function devLog(tag: string, data: LogData = {}): void {
  const payload = {
    time: new Date().toISOString(),
    tag,
    data: makeJsonSafe(data),
  };

  console.log(`[RPS:${tag}]`, payload.data);

  if (!import.meta.env.DEV) return;

  fetch("/__rps_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Terminal logging should never break the app.
  });
}

export function devTrace(tag: string, data: LogData = {}): void {
  if (localStorage.getItem("rpsDebugTrace") !== "1") return;

  devLog(tag, data);
}
