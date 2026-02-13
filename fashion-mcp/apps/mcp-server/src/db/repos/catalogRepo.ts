import { getPool } from "../pool.js";

export type ProductRow = {
  id: string;
  title: string;
  brand: string;
  category: string;
  price_cents: number;
  currency: string;
  image_url: string;
  retailer_url: string;
  sizes: string[];
  x: number;
  y: number;
  created_at: string;
};

type ProductFilters = {
  category?: string[];
  brand?: string[];
  maxPrice?: number;
  minPrice?: number;
};

function applyProductFilters(
  params: unknown[],
  whereParts: string[],
  filters: ProductFilters | undefined
): void {
  if (!filters) return;

  if (filters.category?.length) {
    params.push(filters.category);
    whereParts.push(`category = ANY($${params.length})`);
  }
  if (filters.brand?.length) {
    params.push(filters.brand);
    whereParts.push(`brand = ANY($${params.length})`);
  }
  if (filters.maxPrice != null) {
    params.push(Math.round(filters.maxPrice * 100));
    whereParts.push(`price_cents <= $${params.length}`);
  }
  if (filters.minPrice != null) {
    params.push(Math.round(filters.minPrice * 100));
    whereParts.push(`price_cents >= $${params.length}`);
  }
}

export async function getProductById(itemId: string): Promise<ProductRow | null> {
  const pool = getPool();
  const { rows } = await pool.query("SELECT * FROM products WHERE id=$1", [itemId]);
  return (rows[0] as ProductRow | undefined) ?? null;
}

export async function searchProducts(input: {
  q?: string;
  filters?: ProductFilters;
  limit: number;
}): Promise<ProductRow[]> {
  const pool = getPool();
  const params: unknown[] = [];
  const whereParts: string[] = [];
  if (input.q) {
    params.push(`%${input.q}%`);
    whereParts.push(`(title ILIKE $${params.length} OR brand ILIKE $${params.length})`);
  }

  applyProductFilters(params, whereParts, input.filters);

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  params.push(input.limit);
  const query = `
    SELECT * FROM products
    ${whereSql}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;
  const { rows } = await pool.query(query, params);
  return rows as ProductRow[];
}

export async function getViewportProducts(input: {
  viewport: { xmin: number; xmax: number; ymin: number; ymax: number };
  filters?: ProductFilters;
  limit: number;
}): Promise<ProductRow[]> {
  const pool = getPool();
  const xmin = Math.min(input.viewport.xmin, input.viewport.xmax);
  const xmax = Math.max(input.viewport.xmin, input.viewport.xmax);
  const ymin = Math.min(input.viewport.ymin, input.viewport.ymax);
  const ymax = Math.max(input.viewport.ymin, input.viewport.ymax);

  const params: unknown[] = [xmin, xmax, ymin, ymax];
  const whereParts: string[] = ["x BETWEEN $1 AND $2", "y BETWEEN $3 AND $4"];
  applyProductFilters(params, whereParts, input.filters);
  params.push(input.limit);

  const query = `
    SELECT * FROM products
    WHERE ${whereParts.join(" AND ")}
    ORDER BY created_at DESC
    LIMIT $${params.length}
  `;
  const { rows } = await pool.query(query, params);
  return rows as ProductRow[];
}

export async function getNeighbors(itemId: string, limit: number): Promise<ProductRow[]> {
  const pool = getPool();
  const { rows } = await pool.query(
    `
      SELECT p2.*
      FROM products p1
      JOIN products p2 ON p1.id <> p2.id
      WHERE p1.id=$1
      ORDER BY ((p2.x - p1.x) * (p2.x - p1.x) + (p2.y - p1.y) * (p2.y - p1.y)) ASC
      LIMIT $2
    `,
    [itemId, limit]
  );
  return rows as ProductRow[];
}

export async function getViewportClusters(input: {
  viewport?: { xmin: number; xmax: number; ymin: number; ymax: number };
  filters?: ProductFilters;
}): Promise<Array<{ id: string; x: number; y: number; count: number; label: string }>> {
  const pool = getPool();
  const params: unknown[] = [];
  const whereParts: string[] = [];

  if (input.viewport) {
    params.push(Math.min(input.viewport.xmin, input.viewport.xmax));
    params.push(Math.max(input.viewport.xmin, input.viewport.xmax));
    params.push(Math.min(input.viewport.ymin, input.viewport.ymax));
    params.push(Math.max(input.viewport.ymin, input.viewport.ymax));
    whereParts.push(`x BETWEEN $1 AND $2`);
    whereParts.push(`y BETWEEN $3 AND $4`);
  }

  applyProductFilters(params, whereParts, input.filters);

  const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";
  const query = `
    SELECT category AS label, AVG(x) AS x, AVG(y) AS y, COUNT(*) AS count
    FROM products
    ${whereSql}
    GROUP BY category
    ORDER BY category
  `;

  const { rows } = await pool.query(query, params);
  return rows.map((row) => ({
    id: `cluster_${row.label}`,
    label: row.label,
    x: Number(row.x),
    y: Number(row.y),
    count: Number(row.count),
  }));
}
