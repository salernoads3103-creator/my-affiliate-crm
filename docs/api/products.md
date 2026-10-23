# Products API

The authenticated workspace API is exposed by TanStack Start. Every request needs a valid Supabase bearer token and the permission listed below. Workspace IDs in the URL are checked by `has_workspace_permission`; request bodies cannot select a workspace.

## `GET /api/workspaces/{workspaceId}/products?q={search}`

Requires `products.read`. The optional `q` parameter searches product name and SKU. The response is `{ "success": true, "data": { "products": [...] } }`. The MVP list is capped at 500 rows. `cost_price_minor` is included only when the caller also has `products.cost.read`.

## `POST /api/workspaces/{workspaceId}/products`

Requires `products.read` and `products.manage`. Accepts `name`, `salePrice`, and optional `sku`, `costPrice`, `photoUrl`, `weightGrams`, `supplierName`, and `isActive`. Monetary inputs are decimal UAH strings with up to two decimal places. `costPrice` additionally requires `products.cost.read`. Returns the new product ID with HTTP 201.

## `PUT /api/workspaces/{workspaceId}/products/{productId}`

Requires `products.read` and `products.manage`. Uses the same product fields as create. Omitting `costPrice` preserves the existing cost; including it requires `products.cost.read` and updates or clears that value.

All successful responses use `{ "success": true, "data": ... }`. Validation errors return HTTP 400, missing authentication 401, insufficient permissions 403, unavailable products 404, and unexpected failures a generic HTTP 500 response. Prices are stored in integer kopiykas in UAH.

Product permissions have no role defaults; a Super Admin must grant `products.read`, `products.manage`, and, where appropriate, `products.cost.read` in Administration. Product photos are supplied as HTTP(S) image URLs for this MVP. Orders are not part of this module; when order items are added, their product name and prices must be copied as immutable snapshots at confirmation so later catalog edits cannot change order history.
