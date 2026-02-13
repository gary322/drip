import type { Request, Response } from "express";
import { getPool } from "../db/pool.js";
import { getConfig } from "../config.js";
import { checkFullBodyValidatorHealth } from "../photos/fullBody.js";

export async function health(_req: Request, res: Response) {
  let dbUp = false;
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    dbUp = true;
  } catch {
    dbUp = false;
  }

  const cfg = getConfig();
  const validator = await checkFullBodyValidatorHealth();
  const validatorRequiredAndDown =
    cfg.FULLBODY_VALIDATOR_MODE === "strict" && validator.status !== "up";

  const ok = dbUp && !validatorRequiredAndDown;

  res.status(ok ? 200 : 503).json({
    ok,
    authMode: cfg.AUTH_MODE,
    db: dbUp ? "up" : "down",
    tryonProvider: cfg.TRYON_PROVIDER,
    tryonProviderStrict: Boolean(cfg.TRYON_PROVIDER_STRICT),
    checkoutProvider: cfg.CHECKOUT_PROVIDER,
    fullBodyValidator: validator,
    timestamp: new Date().toISOString(),
  });
}
