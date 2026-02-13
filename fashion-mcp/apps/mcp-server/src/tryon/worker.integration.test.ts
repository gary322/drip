import test, { after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { Jimp } from "jimp";
import { closePool, getPool } from "../db/pool.js";
import { ensureUser, createPhotoSet, setPhotoValidationResults } from "../db/repos/profileRepo.js";
import { createTryonJob, getTryonJob } from "../db/repos/tryonRepo.js";
import { getConfig } from "../config.js";
import { runTryonWorkerOnce } from "./worker.js";

async function canConnect(): Promise<boolean> {
  try {
    const pool = getPool();
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  }
}

async function toDataUri(color: number): Promise<string> {
  const image = new Jimp({ width: 64, height: 96, color });
  const buffer = await image.getBuffer("image/png");
  return `data:image/png;base64,${buffer.toString("base64")}`;
}

test("try-on worker processes queued job and writes output", async (t) => {
  if (!(await canConnect())) {
    t.skip("database not reachable for integration test");
    return;
  }

  const runId = randomUUID().replaceAll("-", "");
  const userId = `worker_user_${runId}`;
  const productId = `worker_prod_${runId}`;
  await ensureUser(userId);

  const userPhotoDataUri = await toDataUri(0xffccccff);
  const garmentDataUri = await toDataUri(0xff3333ff);

  const pool = getPool();
  await pool.query(
    `INSERT INTO products(id, title, brand, category, price_cents, currency, image_url, retailer_url, sizes, x, y)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      productId,
      "Worker Test Top",
      "WorkerBrand",
      "tops",
      5000,
      "USD",
      garmentDataUri,
      "https://example.com/worker-top",
      ["M"],
      0.5,
      0.5,
    ]
  );

  const photoSet = await createPhotoSet({
    userId,
    source: "import",
    fileIds: [`file_${runId}`],
    photoUrls: [userPhotoDataUri],
  });
  await setPhotoValidationResults({
    userId,
    photoSetId: photoSet.photoSetId,
    updates: [
      {
        index: 0,
        status: "approved",
        isPrimary: true,
        report: { ok: true, reason: "ok", provider: "heuristic" },
      },
    ],
  });

  const job = await createTryonJob({
    userId,
    photoSetId: photoSet.photoSetId,
    mode: "item",
    targetId: productId,
  });

  const processed = await runTryonWorkerOnce();
  assert.equal(processed, true);

  const stored = await getTryonJob({ userId, jobId: job.id });
  assert.ok(stored);
  assert.equal(stored?.status, "completed");
  assert.ok((stored?.result_urls?.[0] ?? "").includes(`/generated/${job.id}.jpg`));

  const generatedPath = resolve(process.cwd(), getConfig().TRYON_OUTPUT_DIR, `${job.id}.jpg`);
  await access(generatedPath);
});

after(async () => {
  await closePool();
});
