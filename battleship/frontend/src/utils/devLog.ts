type LogData = Record<string, unknown>;

function makeJsonSafe(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === "bigint") return value.toString();
  if (value && typeof value === "object") {
    if (seen.has(value)) return "[Circular]";
    seen.add(value);
  }

  if (value instanceof Error) {
    const errorWithDetails = value as Error & {
      code?: unknown;
      shortMessage?: unknown;
      details?: unknown;
      metaMessages?: unknown;
      cause?: unknown;
      data?: unknown;
    };

    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
      code: makeJsonSafe(errorWithDetails.code, seen),
      shortMessage: makeJsonSafe(errorWithDetails.shortMessage, seen),
      details: makeJsonSafe(errorWithDetails.details, seen),
      metaMessages: makeJsonSafe(errorWithDetails.metaMessages, seen),
      cause: makeJsonSafe(errorWithDetails.cause, seen),
      data: makeJsonSafe(errorWithDetails.data, seen),
    };
  }

  if (Array.isArray(value)) return value.map((item) => makeJsonSafe(item, seen));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      makeJsonSafe(item, seen),
    ])
  );
}

export function devLog(tag: string, data: LogData = {}): void {
  const payload = {
    time: new Date().toISOString(),
    tag,
    data: makeJsonSafe(data),
  };

  console.log(`[Battleship:${tag}]`, payload.data);

  if (!import.meta.env.DEV) return;

  fetch("/__battleship_log", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  }).catch(() => {
    // Terminal logging should never break the app.
  });
}

export function devTrace(tag: string, data: LogData = {}): void {
  if (localStorage.getItem("battleshipDebugTrace") !== "1") return;

  devLog(tag, data);
}
