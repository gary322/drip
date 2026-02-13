import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema, ListToolsResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { setTimeout as sleep } from "node:timers/promises";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const serverUrl = process.env.MCP_URL ?? "http://localhost:8787/mcp";
const originHeader = process.env.MCP_ORIGIN ?? new URL(serverUrl).origin;
const authToken = process.env.MCP_TOKEN ?? "dev_budget_internet_test_user";
const budget = Number(process.env.BUDGET_USD ?? 120);
const tryonPollIntervalMs = Number(process.env.TRYON_POLL_INTERVAL_MS ?? 1000);
const tryonTimeoutMs = Number(process.env.TRYON_TIMEOUT_MS ?? 120000);
const month = process.env.CAPSULE_MONTH ?? new Date().toISOString().slice(0, 7);

const client = new Client({ name: "internet-budget-tryon-test", version: "1.0.0" }, { capabilities: {} });
const transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
  requestInit: {
    headers: {
      Authorization: `Bearer ${authToken}`,
      Origin: originHeader,
    },
  },
});

function getStructured(result) {
  const structured = result.structuredContent;
  if (!structured || typeof structured !== "object") {
    throw new Error("missing_structured_content");
  }
  return structured;
}

async function requestWithRetry(payload, schema) {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const result = await client.request(payload, schema);
      return result;
    } catch (err) {
      const code = typeof err?.code === "number" ? err.code : null;
      if (code !== 429 || attempt === maxRetries - 1) throw err;

      // Best-effort parse: {"error":"rate_limited","retryAfterSec":28}
      const msg = typeof err?.message === "string" ? err.message : "";
      const match = msg.match(/retryAfterSec\"\\s*:\\s*(\\d+)/);
      // Some transport errors (e.g., SSE stream open) omit the JSON body; default to a full window.
      const retryAfterSec = match ? Number(match[1]) : 60;
      await sleep(Math.max(1, retryAfterSec + 1) * 1000);
    }
  }
  throw new Error("request_retry_exhausted");
}

async function callTool(name, args) {
  return requestWithRetry(
    {
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    CallToolResultSchema
  );
}

async function listTools() {
  return requestWithRetry(
    { method: "tools/list", params: {} },
    ListToolsResultSchema
  );
}

function toDollars(cents) {
  return Math.round(cents) / 100;
}

async function fileToDataUri(path, mimeType) {
  const buffer = await readFile(path);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function main() {
  await client.connect(transport);

  const here = dirname(fileURLToPath(import.meta.url));
  const userPhotoUrl =
    process.env.USER_PHOTO_URL ??
    (await fileToDataUri(resolve(here, "../proof/male-inputs/person_front_male.jpg"), "image/jpeg"));

  const tools = await listTools();
  const toolNames = tools.tools.map((t) => t.name).sort();

  await callTool("profile.upsertBudgetAndGoals", {
    monthlyBudget: budget,
    goals: ["budget-conscious outfit planning", "visual try-on"],
    styleTags: ["casual", "clean"],
  });

  const ingestResult = await callTool("profile.ingestPhotos", {
    fileIds: ["internet-user-photo-1"],
    photoUrls: [userPhotoUrl],
    consentGranted: true,
    source: "import",
  });
  const ingest = getStructured(ingestResult);

  const capsuleResult = await callTool("plan.generateCapsule", {
    month,
    budget,
    outfitCount: 3,
  });
  const capsule = getStructured(capsuleResult).plan;
  if (!capsule || !Array.isArray(capsule.items) || capsule.items.length === 0) {
    throw new Error("capsule_generation_failed_or_empty");
  }

  const outfitId = capsule.outfits?.[0]?.id;
  if (!outfitId) {
    throw new Error("no_outfit_generated");
  }

  const tryonStartResult = await callTool("tryon.renderOutfitOnUser", {
    outfitId,
    photoSetId: ingest.photoSetId,
    idempotencyKey: `internet-e2e-${Date.now()}`,
  });
  const tryonStart = getStructured(tryonStartResult);
  const jobId = tryonStart.jobId;
  if (!jobId) {
    throw new Error("tryon_job_not_created");
  }

  let finalJob = null;
  const deadline = Date.now() + tryonTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(tryonPollIntervalMs);
    const statusResult = await callTool("tryon.getJobStatus", { jobId });
    const status = getStructured(statusResult);
    if (status.status === "completed" || status.status === "failed") {
      finalJob = status;
      break;
    }
  }

  if (!finalJob) {
    throw new Error(`tryon_job_timeout:${jobId}:${tryonTimeoutMs}ms`);
  }

  const report = {
    ok: finalJob.status === "completed",
    serverUrl,
    userPhotoUrl,
    budget,
    toolCount: toolNames.length,
    photoSetId: ingest.photoSetId,
    month,
    capsule: {
      budget: toDollars(capsule.budgetCents),
      total: toDollars(capsule.totalCents),
      itemCount: capsule.items.length,
      outfitCount: capsule.outfits.length,
      items: capsule.items.map((i) => ({
        id: i.id,
        title: i.title,
        brand: i.brand,
        category: i.category,
        price: i.price,
        imageUrl: i.imageUrl,
      })),
    },
    tryon: {
      jobId,
      status: finalJob.status,
      mode: finalJob.mode,
      targetId: finalJob.targetId,
      resultUrls: finalJob.resultUrls,
      error: finalJob.error ?? null,
      pollIntervalMs: tryonPollIntervalMs,
      timeoutMs: tryonTimeoutMs,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  await transport.close();
}

main().catch(async (error) => {
  console.error("E2E test failed:", error);
  try {
    await transport.close();
  } catch {}
  process.exit(1);
});
