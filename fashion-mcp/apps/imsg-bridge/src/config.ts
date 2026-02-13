import { z } from "zod";

const BoolDefaultTrueSchema = z
  .string()
  .optional()
  .transform((value) => (value == null ? true : value === "true"));

const ConfigSchema = z.object({
  BACKEND_BASE_URL: z.string().url().default("http://localhost:8787"),
  BRIDGE_SHARED_SECRET: z.string().min(8, "BRIDGE_SHARED_SECRET is required"),

  IMSG_BIN: z.string().min(1).default("imsg"),
  IMSG_REGION: z.string().min(2).max(2).default("US"),
  IMSG_SEND_SERVICE: z.enum(["imessage", "sms", "auto"]).default("auto"),

  IMSG_WATCH_CHAT_ID: z.coerce.number().int().positive().optional(),
  IMSG_ATTACHMENTS: BoolDefaultTrueSchema,

  STATE_DIR: z.string().min(1).default("./.state"),

  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  OUTBOX_MAX_BATCH_SIZE: z.coerce.number().int().min(1).max(25).default(10),
});

export type BridgeConfig = z.infer<typeof ConfigSchema>;

let cached: BridgeConfig | null = null;

export function getConfig(): BridgeConfig {
  if (!cached) cached = ConfigSchema.parse(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = null;
}
