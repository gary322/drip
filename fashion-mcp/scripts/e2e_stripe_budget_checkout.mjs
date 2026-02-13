import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { CallToolResultSchema } from "@modelcontextprotocol/sdk/types.js";
import { setTimeout as sleep } from "node:timers/promises";

const serverUrl = process.env.MCP_URL ?? "http://localhost:8787/mcp";
const originHeader = process.env.MCP_ORIGIN ?? new URL(serverUrl).origin;
const authToken = process.env.MCP_TOKEN ?? "dev_stripe_budget_test_user";
const monthlyBudget = Number(process.env.MONTHLY_BUDGET_USD ?? 50);

const overBudgetItemIds = (process.env.OVER_BUDGET_ITEM_IDS ?? "prod_004")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const withinBudgetItemIds = (process.env.WITHIN_BUDGET_ITEM_IDS ?? "prod_005")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const client = new Client({ name: "stripe-budget-e2e", version: "1.0.0" }, { capabilities: {} });
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

async function fetchJson(url) {
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`fetch_failed:${res.status}:${text.slice(0, 200)}`);
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

async function main() {
  await client.connect(transport);

  // Health helps confirm the server is actually using Stripe (and strict try-on provider policy).
  const healthUrl = serverUrl.replace(/\/mcp\/?$/, "") + "/healthz";
  const health = await fetchJson(healthUrl);

  await callTool("profile.upsertBudgetAndGoals", {
    monthlyBudget,
    goals: ["budget-conscious outfit planning"],
    styleTags: ["clean"],
  });

  const overBudgetBlocked = getStructured(
    await callTool("checkout.createApprovalLink", {
      itemIds: overBudgetItemIds,
      allowOverBudget: false,
      notes: "e2e over budget (should block)",
      idempotencyKey: `stripe-over-budget-block-${Date.now()}`,
    })
  );

  const overBudgetAllowed = getStructured(
    await callTool("checkout.createApprovalLink", {
      itemIds: overBudgetItemIds,
      allowOverBudget: true,
      notes: "e2e over budget (allowed)",
      idempotencyKey: `stripe-over-budget-allow-${Date.now()}`,
    })
  );

  const withinBudgetAllowed = getStructured(
    await callTool("checkout.createApprovalLink", {
      itemIds: withinBudgetItemIds,
      allowOverBudget: false,
      notes: "e2e within budget (should pass)",
      idempotencyKey: `stripe-within-budget-${Date.now()}`,
    })
  );

  const report = {
    ok: true,
    serverUrl,
    health,
    monthlyBudget,
    cases: {
      overBudgetBlocked,
      overBudgetAllowed,
      withinBudgetAllowed,
    },
  };

  console.log(JSON.stringify(report, null, 2));
  await transport.close();
}

main().catch(async (error) => {
  console.error("E2E Stripe budget test failed:", error);
  try {
    await transport.close();
  } catch {}
  process.exit(1);
});
