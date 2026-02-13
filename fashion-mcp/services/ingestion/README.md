# ingestion service (placeholder)

Responsibilities:
- Pull product feeds (affiliate / partner API)
- Normalize into a canonical product/offer schema
- Deduplicate and enrich attributes (category/color/material)
- Push updates into Postgres (products table) + optionally a search index

Production notes:
- Use idempotent upserts
- Track source + last_seen + price/availability history
- Validate compliance with partner terms
