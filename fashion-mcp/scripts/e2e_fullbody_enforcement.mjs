import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { Jimp } from "jimp";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

const serverUrl = process.env.MCP_URL ?? "http://localhost:8787/mcp";
const originHeader = process.env.MCP_ORIGIN ?? new URL(serverUrl).origin;
const authToken = process.env.MCP_TOKEN ?? "dev_fullbody_e2e_user";
const tryonPollIntervalMs = Number(process.env.TRYON_POLL_INTERVAL_MS ?? 1500);
const tryonTimeoutMs = Number(process.env.TRYON_TIMEOUT_MS ?? 180000);

function getStructured(result) {
  const structured = result.structuredContent;
  if (!structured || typeof structured !== "object") {
    throw new Error("missing_structured_content");
  }
  return structured;
}

async function requestWithRetry(client, payload, schema) {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      return await client.request(payload, schema);
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

async function callTool(client, name, args) {
  const result = await requestWithRetry(
    client,
    {
      method: "tools/call",
      params: {
        name,
        arguments: args,
      },
    },
    CallToolResultSchema
  );
  return getStructured(result);
}

async function connectWithRetry(createTransport) {
  const maxRetries = 4;
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    const client = new Client(
      { name: "fullbody-enforcement-e2e", version: "1.0.0" },
      { capabilities: {} }
    );
    const transport = createTransport();
    try {
      await client.connect(transport);
      return { client, transport };
    } catch (err) {
      const code = typeof err?.code === "number" ? err.code : null;
      if (code !== 429 || attempt === maxRetries - 1) throw err;

      const msg = typeof err?.message === "string" ? err.message : "";
      const match = msg.match(/retryAfterSec\"\\s*:\\s*(\\d+)/);
      // Some transport errors (e.g., SSE stream open) omit the JSON body; default to a full window.
      const retryAfterSec = match ? Number(match[1]) : 60;
      try {
        await transport.close();
      } catch {}
      await sleep(Math.max(1, retryAfterSec + 1) * 1000);
    }
  }
  throw new Error("connect_retry_exhausted");
}

async function toDataUri(width, height, color) {
  const image = new Jimp({ width, height, color });
  const buffer = await image.getBuffer("image/png");
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

async function fileToDataUri(path, mimeType) {
  const buffer = await readFile(path);
  return `data:${mimeType};base64,${buffer.toString("base64")}`;
}

async function paddedHeadshotDataUri(headshotPath) {
  const headshotBuffer = await readFile(headshotPath);
  const headshot = await Jimp.read(headshotBuffer);
  // Pad to a typical portrait size so dimension/aspect heuristics alone would pass.
  const canvas = new Jimp({ width: 900, height: 1350, color: 0xffffffff });
  canvas.composite(headshot, 0, 0);
  const out = await canvas.getBuffer("image/jpeg");
  return `data:image/jpeg;base64,${out.toString("base64")}`;
}

async function main() {
  const { client, transport } = await connectWithRetry(() => new StreamableHTTPClientTransport(new URL(serverUrl), {
    requestInit: {
      headers: {
        Authorization: `Bearer ${authToken}`,
        Origin: originHeader,
      },
    },
  }));

  const here = dirname(fileURLToPath(import.meta.url));
  const fullBodyPath = resolve(here, "../proof/male-inputs/person_front_male.jpg");
  const headshotPath = resolve(here, "../proof/male-multi-look/person_base_front.jpg");

  const headshotLikePhoto = await paddedHeadshotDataUri(headshotPath);
  const fullBodyLikePhoto = await fileToDataUri(fullBodyPath, "image/jpeg");

  const rejectedStructured = await callTool(client, "profile.ingestPhotos", {
    fileIds: ["headshot-only"],
    photoUrls: [headshotLikePhoto],
    consentGranted: true,
    source: "import",
  });
  if (rejectedStructured.ok !== false || rejectedStructured.reason !== "full_body_photo_required") {
    throw new Error(
      `expected_rejection_not_returned:${JSON.stringify(rejectedStructured)}`
    );
  }

  const acceptedStructured = await callTool(client, "profile.ingestPhotos", {
    fileIds: ["full-body-front"],
    photoUrls: [fullBodyLikePhoto],
    consentGranted: true,
    source: "import",
  });
  if (acceptedStructured.ok !== true || !acceptedStructured.photoSetId) {
    throw new Error(`expected_acceptance_not_returned:${JSON.stringify(acceptedStructured)}`);
  }

  // Prefer a known seeded item id. Some test runs may leave temporary catalog items
  // with broken image URLs; those will cause try-on to fail during image fetch.
  let itemId = "prod_005";
  const seeded = await callTool(client, "catalog.getItem", { itemId });
  if (!seeded?.found) {
    const catalogStructured = await callTool(client, "catalog.search", { limit: 50 });
    const items = Array.isArray(catalogStructured.items) ? catalogStructured.items : [];
    const firstUsable = items.find((it) => {
      if (typeof it?.imageUrl !== "string") return false;
      return it.imageUrl.startsWith("http://") || it.imageUrl.startsWith("https://");
    });
    if (!firstUsable?.id) {
      throw new Error("no_catalog_item_available");
    }
    itemId = firstUsable.id;
  }

  const tryonStructured = await callTool(client, "tryon.renderItemOnUser", {
    itemId,
    photoSetId: acceptedStructured.photoSetId,
    idempotencyKey: `fullbody-e2e-${Date.now()}`,
  });
  if (tryonStructured.ok !== true || !tryonStructured.jobId) {
    throw new Error(`tryon_job_not_created:${JSON.stringify(tryonStructured)}`);
  }

  let finalJob = null;
  const deadline = Date.now() + tryonTimeoutMs;
  while (Date.now() < deadline) {
    await sleep(tryonPollIntervalMs);
    const status = await callTool(client, "tryon.getJobStatus", { jobId: tryonStructured.jobId });
    if (status.status === "completed" || status.status === "failed") {
      finalJob = status;
      break;
    }
  }
  if (!finalJob) {
    throw new Error(`tryon_job_timeout:${tryonStructured.jobId}:${tryonTimeoutMs}ms`);
  }
  if (finalJob.status !== "completed" || !Array.isArray(finalJob.resultUrls) || finalJob.resultUrls.length === 0) {
    throw new Error(`tryon_job_failed:${JSON.stringify(finalJob)}`);
  }

  console.log(
    JSON.stringify(
      {
        ok: true,
        serverUrl,
        rejectedReason: rejectedStructured.reason,
        acceptedPhotoSetId: acceptedStructured.photoSetId,
        tryonJobId: tryonStructured.jobId,
        tryonResultUrls: finalJob.resultUrls,
      },
      null,
      2
    )
  );

  await transport.close();
}

main().catch((error) => {
  console.error("full-body enforcement e2e failed:", error);
  process.exit(1);
});
