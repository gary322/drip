# Tool contracts

This document describes the active MCP tool contracts in the current implementation.

## Profile tools

### profile.get
- Scope: `profile:read`
- Output: profile with budget, goals, style tags, sizes, and address.

### profile.upsertBudgetAndGoals
- Scope: `profile:write`
- Input:
  - `monthlyBudget: number`
  - `goals: string[]`
  - `styleTags: string[]`

### profile.upsertSizes
- Scope: `profile:write`
- Input:
  - `sizes: Record<string, string | number | boolean | string[]>`

### profile.ingestPhotos
- Scope: `photos:write`
- Input:
  - `fileIds: string[]`
  - `photoUrls?: string[]` (for server-accessible images used by try-on worker)
  - `consentGranted: boolean`
  - `source: "chatgpt_upload" | "import"`
- Validation:
  - By default, `photoUrls` are checked for likely full head-to-toe framing.
  - Validation state is stored per photo (`pending|approved|rejected`) with a validation report payload.
  - If validation fails, tool returns `ok: false` with `reason: "full_body_photo_required"` and machine-readable failure details.
- Output:
  - `photoSetId`
  - `fileCount`
  - `approvedPhotoCount`
  - `rejectedPhotoCount`

### profile.deletePhotos
- Scope: `photos:write`
- Input:
  - `photoSetId: string`

### profile.setAddress
- Scope: `profile:write`
- Input:
  - `address: { line1, line2?, city, state, postalCode, country }`

## Catalog tools

### catalog.search
- Scope: `catalog:read`
- Input:
  - `q?: string`
  - `filters?: { category?: string[], brand?: string[], minPrice?: number, maxPrice?: number }`
  - `limit: number`

### catalog.getItem
- Scope: `catalog:read`
- Input:
  - `itemId: string`

## Style map tools

### styleMap.getViewportItems
- Scope: `stylemap:read`, `catalog:read`
- Input:
  - `viewport: { xmin, xmax, ymin, ymax }`
  - `zoom: number`
  - `filters?: { category?, brand?, minPrice?, maxPrice? }`
  - `limit: number`
- Output `structuredContent`:
  - `type: "style_map"`
  - `items: product[]`
  - `clusters: cluster[]`

### styleMap.getClusters
- Scope: `stylemap:read`, `catalog:read`
- Input:
  - `viewport?`
  - `zoom`
  - `filters?`

### styleMap.getItemNeighbors
- Scope: `stylemap:read`, `catalog:read`
- Input:
  - `itemId: string`
  - `limit: number`

## Feedback tools

### feedback.rateItem
- Scope: `feedback:write`
- Input:
  - `itemId: string`
  - `rating: -1 | 0 | 1`

## Planning tools

### plan.generateCapsule
- Scope: `plans:write`, `catalog:read`
- Input:
  - `month: "YYYY-MM"`
  - `budget?: number`
  - `outfitCount: number`

### plan.generateOutfits
- Scope: `plans:write`, `catalog:read`
- Input:
  - `budget?: number`
  - `outfitCount: number`
  - `includeItemIds: string[]`

### plan.swapItemInOutfit
- Scope: `plans:write`, `catalog:read`
- Input:
  - `outfitId: string`
  - `removeItemId: string`
  - `replacementCategory?: string`

## Try-on tools

### tryon.renderItemOnUser
- Scope: `tryon:write`, `photos:write`
- Input:
  - `itemId: string`
  - `photoSetId: string`
  - `idempotencyKey?: string`
- Notes:
  - Requires an approved primary full-body photo when `TRYON_REQUIRE_FULL_BODY_PHOTOS=true`.

### tryon.renderOutfitOnUser
- Scope: `tryon:write`, `photos:write`
- Input:
  - `outfitId: string`
  - `photoSetId: string`
  - `idempotencyKey?: string`
- Notes:
  - Requires an approved primary full-body photo when `TRYON_REQUIRE_FULL_BODY_PHOTOS=true`.

### tryon.getJobStatus
- Scope: `tryon:read`
- Input:
  - `jobId: uuid`

## Commerce tools (deep-link approval)

### checkout.createApprovalLink
- Scope: `orders:write`, `catalog:read`
- Input:
  - `itemIds: string[]`
  - `notes?: string`
  - `allowOverBudget?: boolean` (default false)
  - `successUrl?: string` (optional Stripe success redirect)
  - `cancelUrl?: string` (optional Stripe cancel redirect)
  - `idempotencyKey?: string`

### orders.getApprovalStatus
- Scope: `orders:write`
- Input:
  - `token: string`

## Webhooks

### POST /webhooks/stripe
- Validates `Stripe-Signature` using `STRIPE_WEBHOOK_SECRET`.
- Handles:
  - `checkout.session.completed`
  - `checkout.session.async_payment_succeeded`
  - `checkout.session.expired`
  - `checkout.session.async_payment_failed`
- Uses event-id dedupe (`stripe_webhook_events`) to ensure idempotent processing.
