# Offers API (MVP)

All endpoints require a Supabase access token in `Authorization: Bearer <token>`.
Workspace IDs come from the URL and are checked against the caller's permissions.
Responses use the shared `{ success, data }` envelope.

## `GET /api/workspaces/{workspaceId}/offers/catalog?q={search}`

Returns workspace offers visible under `offers.read`, with the linked product's
name, SKU, photo, and current sale price. The caller also needs `products.read`.
Search matches the offer name, product name, or SKU. Legacy offers without a
catalog product remain in the result with null product and offer-price fields.

## `POST /api/workspaces/{workspaceId}/offers`

Creates a catalog-backed offer. Requires `offers.manage` and `products.read`.
The server validates all fields and the database checks that the product belongs
to the same workspace.

```json
{
  "productId": "uuid",
  "name": "НХ-8503 — спеціальна ціна",
  "priceUah": "1190.00",
  "landingUrl": "https://shop.example/razor",
  "isActive": true
}
```

`priceUah` is converted to an integer number of kopiykas. A request containing
only the legacy `name` field continues to use the existing workspace-offer RPC
for compatibility with Administration permission scopes.

## `PUT /api/workspaces/{workspaceId}/offers/{offerId}`

Updates the same fields as `POST`. Requires `offers.manage` for that offer and
`products.read`. The product relation is checked against the workspace both in
the server RPC and by a composite database foreign key.

## Lead association

Lead create/update requests keep using the existing `offer_id` field. The lead
RLS policy and composite workspace foreign key remain the authorization and
tenant-isolation boundary; UI labels never replace internal IDs.
