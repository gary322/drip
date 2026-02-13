import type { Request, Response, NextFunction } from "express";

type Bucket = {
  count: number;
  resetAt: number;
};

export function createInMemoryRateLimit(options: {
  windowMs: number;
  max: number;
  keyPrefix: string;
}): (req: Request, res: Response, next: NextFunction) => void {
  const buckets = new Map<string, Bucket>();

  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const rawKey = req.ip || req.headers["x-forwarded-for"]?.toString() || "unknown";
    const key = `${options.keyPrefix}:${rawKey}`;

    const current = buckets.get(key);
    if (!current || current.resetAt <= now) {
      buckets.set(key, { count: 1, resetAt: now + options.windowMs });
      return next();
    }

    if (current.count >= options.max) {
      const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      return res.status(429).json({ error: "rate_limited", retryAfterSec });
    }

    current.count += 1;
    buckets.set(key, current);
    return next();
  };
}

