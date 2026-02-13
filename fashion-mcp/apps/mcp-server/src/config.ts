import { z } from "zod";

const AuthModeSchema = z.enum(["dev", "oauth"]);
const TryonProviderSchema = z.enum(["local", "google_vertex"]);
const CheckoutProviderSchema = z.enum(["deep_link", "stripe"]);
const FullBodyValidatorModeSchema = z.enum(["heuristic", "strict"]);
const AssetStoreProviderSchema = z.enum(["local", "s3"]);
const ChannelEnabledSchema = z
  .string()
  .optional()
  .transform((value) => value === "true");

const ConfigSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().int().positive().default(8787),
    PUBLIC_BASE_URL: z.string().url().default("http://localhost:8787"),
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    DATABASE_SSL: z
      .string()
      .optional()
      .transform((value) => value === "true"),
    AUTH_MODE: AuthModeSchema.default("dev"),
    JWKS_URL: z.string().url().optional(),
    JWT_ISSUER: z.string().optional(),
    JWT_AUDIENCE: z.string().optional(),
    AUTHORIZATION_SERVERS: z
      .string()
      .default("https://auth.yourcompany.com")
      .transform((value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      ),
    ALLOWED_ORIGINS: z
      .string()
      .default("https://chatgpt.com,https://www.chatgpt.com")
      .transform((value) =>
        value
          .split(",")
          .map((part) => part.trim())
          .filter(Boolean)
      ),
    APPROVAL_TTL_MINUTES: z.coerce.number().int().positive().default(60),
    MCP_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    MCP_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(120),
    APPROVAL_RATE_LIMIT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
    APPROVAL_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(30),
    TRYON_WORKER_ENABLED: z
      .string()
      .optional()
      .transform((value) => (value == null ? true : value !== "false")),
    TRYON_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1500),
    TRYON_OUTPUT_DIR: z.string().default("./generated"),
    TRYON_REQUIRE_FULL_BODY_PHOTOS: z
      .string()
      .optional()
      .transform((value) => (value == null ? true : value === "true")),
    TRYON_MIN_FULL_BODY_WIDTH_PX: z.coerce.number().int().positive().default(512),
    TRYON_MIN_FULL_BODY_HEIGHT_PX: z.coerce.number().int().positive().default(900),
    TRYON_MIN_FULL_BODY_ASPECT_RATIO: z.coerce.number().positive().default(1.3),
    FULLBODY_VALIDATOR_MODE: FullBodyValidatorModeSchema.default("heuristic"),
    FULLBODY_VALIDATOR_URL: z.string().url().default("http://127.0.0.1:8090/validate"),
    FULLBODY_VALIDATOR_TIMEOUT_MS: z.coerce.number().int().positive().default(20_000),
    FULLBODY_REQUIRE_FEET_VISIBLE: z
      .string()
      .optional()
      .transform((value) => (value == null ? true : value === "true")),
    // When enabled, the server must use the real try-on provider (Vertex).
    // This prevents accidentally returning incorrect compositor images.
    TRYON_PROVIDER_STRICT: z
      .string()
      .optional()
      .transform((value) => value === "true"),
    TRYON_PROVIDER: TryonProviderSchema.default("local"),
    CHECKOUT_PROVIDER: CheckoutProviderSchema.default("deep_link"),
    CHECKOUT_ENFORCE_BUDGET: z
      .string()
      .optional()
      .transform((value) => (value == null ? true : value === "true")),
    STRIPE_SECRET_KEY: z.string().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().optional(),
    STRIPE_SUCCESS_URL: z.string().url().optional(),
    STRIPE_CANCEL_URL: z.string().url().optional(),
    GOOGLE_CLOUD_PROJECT: z.string().optional(),
    GOOGLE_CLOUD_LOCATION: z.string().default("us-central1"),
    GOOGLE_VERTEX_VTO_MODEL: z.string().default("virtual-try-on-001"),
    GOOGLE_VERTEX_VTO_PERSON_GENERATION: z.string().default("allow_adult"),
    GOOGLE_VERTEX_VTO_SAFETY_SETTING: z.string().default("block_medium_and_above"),
    GOOGLE_VERTEX_VTO_BASE_STEPS: z.coerce.number().int().min(1).max(100).default(32),
    GOOGLE_VERTEX_VTO_ADD_WATERMARK: z
      .string()
      .optional()
      .transform((value) => (value == null ? true : value === "true")),
    GOOGLE_VERTEX_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),

    // Media storage (local for dev; production should use S3 behind signed URLs)
    ASSET_STORE_PROVIDER: AssetStoreProviderSchema.default("local"),
    ASSET_S3_BUCKET: z.string().optional(),
    ASSET_S3_MEDIA_PREFIX: z.string().default("media"),
    ASSET_S3_GENERATED_PREFIX: z.string().default("generated"),
    ASSET_S3_PRESIGN_TTL_SECONDS: z.coerce.number().int().min(60).max(7 * 24 * 3600).default(3600),
    MEDIA_DIR: z.string().default("./media"),
    MEDIA_MAX_BYTES: z.coerce.number().int().positive().default(12_000_000),

    // Omnichannel flags + provider config
    WHATSAPP_ENABLED: ChannelEnabledSchema,
    WHATSAPP_WEBHOOK_VERIFY_TOKEN: z.string().optional(),
    WHATSAPP_APP_SECRET: z.string().optional(),
    WHATSAPP_ACCESS_TOKEN: z.string().optional(),
    WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
    WHATSAPP_API_BASE_URL: z.string().url().default("https://graph.facebook.com"),
    WHATSAPP_API_VERSION: z.string().default("v19.0"),

    TELEGRAM_ENABLED: ChannelEnabledSchema,
    TELEGRAM_BOT_TOKEN: z.string().optional(),
    TELEGRAM_WEBHOOK_SECRET_TOKEN: z.string().optional(),
    TELEGRAM_API_BASE_URL: z.string().url().default("https://api.telegram.org"),

    IMESSAGE_BRIDGE_ENABLED: ChannelEnabledSchema,
    IMESSAGE_BRIDGE_SHARED_SECRET: z.string().optional(),
  })
  .superRefine((cfg, ctx) => {
    if (cfg.AUTH_MODE === "oauth") {
      if (!cfg.JWKS_URL) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWKS_URL"],
          message: "JWKS_URL is required when AUTH_MODE=oauth",
        });
      }
      if (!cfg.JWT_ISSUER) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_ISSUER"],
          message: "JWT_ISSUER is required when AUTH_MODE=oauth",
        });
      }
      if (!cfg.JWT_AUDIENCE) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["JWT_AUDIENCE"],
          message: "JWT_AUDIENCE is required when AUTH_MODE=oauth",
        });
      }
    }
    if (cfg.TRYON_PROVIDER === "google_vertex") {
      if (!cfg.GOOGLE_CLOUD_PROJECT) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["GOOGLE_CLOUD_PROJECT"],
          message: "GOOGLE_CLOUD_PROJECT is required when TRYON_PROVIDER=google_vertex",
        });
      }
    }
    if (cfg.TRYON_PROVIDER_STRICT && cfg.TRYON_PROVIDER !== "google_vertex") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TRYON_PROVIDER"],
        message: "TRYON_PROVIDER must be google_vertex when TRYON_PROVIDER_STRICT=true",
      });
    }
    if (cfg.NODE_ENV === "production" && cfg.TRYON_REQUIRE_FULL_BODY_PHOTOS && cfg.FULLBODY_VALIDATOR_MODE !== "strict") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["FULLBODY_VALIDATOR_MODE"],
        message: "FULLBODY_VALIDATOR_MODE must be strict in production when TRYON_REQUIRE_FULL_BODY_PHOTOS=true",
      });
    }
    if (cfg.NODE_ENV === "production" && cfg.TRYON_PROVIDER !== "google_vertex") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["TRYON_PROVIDER"],
        message: "TRYON_PROVIDER must be google_vertex in production (local compositor is not production-safe)",
      });
    }
    if (cfg.CHECKOUT_PROVIDER === "stripe" && !cfg.STRIPE_SECRET_KEY) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["STRIPE_SECRET_KEY"],
        message: "STRIPE_SECRET_KEY is required when CHECKOUT_PROVIDER=stripe",
      });
    }

    if (cfg.ASSET_STORE_PROVIDER === "s3" && !cfg.ASSET_S3_BUCKET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ASSET_S3_BUCKET"],
        message: "ASSET_S3_BUCKET is required when ASSET_STORE_PROVIDER=s3",
      });
    }
    if (cfg.NODE_ENV === "production" && cfg.ASSET_STORE_PROVIDER !== "s3") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["ASSET_STORE_PROVIDER"],
        message: "ASSET_STORE_PROVIDER must be s3 in production",
      });
    }

    if (cfg.WHATSAPP_ENABLED) {
      const required: Array<keyof typeof cfg> = [
        "WHATSAPP_WEBHOOK_VERIFY_TOKEN",
        "WHATSAPP_APP_SECRET",
        "WHATSAPP_ACCESS_TOKEN",
        "WHATSAPP_PHONE_NUMBER_ID",
      ];
      for (const key of required) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${String(key)} is required when WHATSAPP_ENABLED=true`,
          });
        }
      }
    }

    if (cfg.TELEGRAM_ENABLED) {
      const required: Array<keyof typeof cfg> = ["TELEGRAM_BOT_TOKEN", "TELEGRAM_WEBHOOK_SECRET_TOKEN"];
      for (const key of required) {
        if (!cfg[key]) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [key],
            message: `${String(key)} is required when TELEGRAM_ENABLED=true`,
          });
        }
      }
    }

    if (cfg.IMESSAGE_BRIDGE_ENABLED && !cfg.IMESSAGE_BRIDGE_SHARED_SECRET) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["IMESSAGE_BRIDGE_SHARED_SECRET"],
        message: "IMESSAGE_BRIDGE_SHARED_SECRET is required when IMESSAGE_BRIDGE_ENABLED=true",
      });
    }
  });

export type AppConfig = z.infer<typeof ConfigSchema>;

let cachedConfig: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!cachedConfig) {
    cachedConfig = ConfigSchema.parse(process.env);
  }
  return cachedConfig;
}

export function resetConfigForTests(): void {
  cachedConfig = null;
}
