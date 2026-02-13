import { getAuth } from "../../auth/requestContext.js";

export const STYLE_MAP_RESOURCE_URI = "ui://widget/style-map.html";

export function getCurrentUserId(): string {
  return getAuth()?.userId ?? "anonymous";
}

export function priceToMoney(priceCents: number, currency: string) {
  return { amount: Math.round(priceCents) / 100, currency };
}

export function mapProductToStyleItem(product: {
  id: string;
  x: number;
  y: number;
  title: string;
  brand: string;
  category: string;
  price_cents: number;
  currency: string;
  image_url: string;
  retailer_url: string;
  sizes: string[];
}) {
  return {
    id: product.id,
    x: product.x,
    y: product.y,
    kind: "product",
    title: product.title,
    brand: product.brand,
    category: product.category,
    price: priceToMoney(product.price_cents, product.currency),
    imageUrl: product.image_url,
    retailerUrl: product.retailer_url,
    sizes: product.sizes,
    score: 0.75,
  };
}

