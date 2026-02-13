import { Jimp } from "jimp";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const userUrl = process.env.USER_URL;
const garmentUrl = process.env.GARMENT_URL;
const resultUrl = process.env.RESULT_URL;
const outFile = process.env.OUT_FILE ?? "generated/vertex_tryon_proof.png";
const targetHeight = Number(process.env.TARGET_HEIGHT ?? 900);
const spacing = Number(process.env.SPACING ?? 24);

if (!userUrl || !garmentUrl || !resultUrl) {
  console.error("Missing USER_URL, GARMENT_URL, or RESULT_URL");
  process.exit(2);
}

async function fetchBuffer(url) {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`fetch_failed:${res.status}:${url}:${text.slice(0, 200)}`);
  }
  const ab = await res.arrayBuffer();
  return Buffer.from(ab);
}

function resizeToHeight(img, h) {
  const height = Math.max(1, Math.floor(h));
  const ratio = height / Math.max(1, img.bitmap.height);
  const width = Math.max(1, Math.round(img.bitmap.width * ratio));
  return img.resize({ w: width, h: height });
}

async function main() {
  const [userBuf, garmentBuf, resultBuf] = await Promise.all([
    fetchBuffer(userUrl),
    fetchBuffer(garmentUrl),
    fetchBuffer(resultUrl),
  ]);

  const [userImg, garmentImg, resultImg] = await Promise.all([
    Jimp.read(userBuf),
    Jimp.read(garmentBuf),
    Jimp.read(resultBuf),
  ]);

  resizeToHeight(userImg, targetHeight);
  resizeToHeight(garmentImg, targetHeight);
  resizeToHeight(resultImg, targetHeight);

  const width =
    userImg.bitmap.width + spacing + garmentImg.bitmap.width + spacing + resultImg.bitmap.width;
  const canvas = new Jimp({ width, height: targetHeight, color: 0xffffffff });

  let x = 0;
  canvas.composite(userImg, x, 0);
  x += userImg.bitmap.width + spacing;
  canvas.composite(garmentImg, x, 0);
  x += garmentImg.bitmap.width + spacing;
  canvas.composite(resultImg, x, 0);

  const outPath = resolve(process.cwd(), outFile);
  const outBuf = await canvas.getBuffer("image/png");
  await writeFile(outPath, outBuf);
  console.log(JSON.stringify({ ok: true, outFile, outBytes: outBuf.length }, null, 2));
}

main().catch((err) => {
  console.error("collage_failed:", err);
  process.exit(1);
});

