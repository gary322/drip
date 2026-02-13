import { closePool, getPool } from "./pool.js";
import { ensureDatabaseUrl } from "./resolveDatabaseUrl.js";

async function main() {
  await ensureDatabaseUrl();
  const pool = getPool();
  console.log("Seeding demo products…");

  await pool.query("TRUNCATE products CASCADE");

  // A tiny demo catalog. In production, ingest via partner feeds/APIs.
  const rows = [
    {
      id: "prod_001",
      title: "Relaxed Oxford Shirt",
      brand: "North & Pine",
      category: "tops",
      price_cents: 5800,
      currency: "USD",
      image_url: "https://images.unsplash.com/photo-1520975958225-32f4b1b19a14?auto=format&fit=crop&w=800&q=60",
      retailer_url: "https://example.com/products/prod_001",
      sizes: ["S","M","L","XL"],
      x: 0.22, y: 0.74
    },
    {
      id: "prod_002",
      title: "Straight-Leg Chinos",
      brand: "North & Pine",
      category: "bottoms",
      price_cents: 7400,
      currency: "USD",
      image_url: "https://images.unsplash.com/photo-1520975693416-35a5a1b7d3a4?auto=format&fit=crop&w=800&q=60",
      retailer_url: "https://example.com/products/prod_002",
      sizes: ["30","32","34","36"],
      x: 0.26, y: 0.71
    },
    {
      id: "prod_003",
      title: "Minimal Leather Sneaker",
      brand: "Sola Studio",
      category: "shoes",
      price_cents: 9800,
      currency: "USD",
      image_url: "https://images.unsplash.com/photo-1528701800489-20be4cdd6df0?auto=format&fit=crop&w=800&q=60",
      retailer_url: "https://example.com/products/prod_003",
      sizes: ["8","9","10","11"],
      x: 0.24, y: 0.77
    },
    {
      id: "prod_004",
      title: "Wool Overcoat",
      brand: "Atelier Grey",
      category: "outerwear",
      price_cents: 22000,
      currency: "USD",
      image_url: "https://images.unsplash.com/photo-1514996937319-344454492b37?auto=format&fit=crop&w=800&q=60",
      retailer_url: "https://example.com/products/prod_004",
      sizes: ["S","M","L"],
      x: 0.19, y: 0.81
    },
    {
      id: "prod_005",
      title: "Streetwear Graphic Tee",
      brand: "Neon District",
      category: "tops",
      price_cents: 3800,
      currency: "USD",
      image_url: "https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?auto=format&fit=crop&w=800&q=60",
      retailer_url: "https://example.com/products/prod_005",
      sizes: ["S","M","L","XL"],
      x: 0.72, y: 0.22
    }
  ];

  for (const p of rows) {
    await pool.query(
      `INSERT INTO products
        (id, title, brand, category, price_cents, currency, image_url, retailer_url, sizes, x, y)
       VALUES
        ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        p.id, p.title, p.brand, p.category, p.price_cents, p.currency,
        p.image_url, p.retailer_url, p.sizes, p.x, p.y
      ]
    );
  }

  console.log("Seed complete.");
  await closePool();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
