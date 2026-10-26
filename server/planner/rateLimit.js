// A small in-memory limiter. One serverless instance has one memory, so this is
// per-instance abuse mitigation, not a global quota — documented as such.

export function createRateLimiter({ windowMs = 60000, max = 10, keys = 500 } = {}) {
  const hits = new Map();

  return {
    /** @returns {{ok: boolean, retryAfter: number}} */
    take(key, now = Date.now()) {
      const name = typeof key === "string" && key ? key : "unknown";
      const record = hits.get(name);
      if (!record || now - record.start >= windowMs) {
        if (hits.has(name)) hits.delete(name);
        hits.set(name, { start: now, count: 1 });
        while (hits.size > keys) hits.delete(hits.keys().next().value);
        return { ok: true, retryAfter: 0 };
      }
      record.count += 1;
      if (record.count > max) {
        return { ok: false, retryAfter: Math.max(1, Math.ceil((record.start + windowMs - now) / 1000)) };
      }
      return { ok: true, retryAfter: 0 };
    },
    get size() {
      return hits.size;
    },
  };
}
