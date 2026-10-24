# Orders MVP

The Orders module records a separate order snapshot after an operator confirms a
lead with the customer. Creating a draft does not change the lead status and
does not create a shipment.

## Data model

The workspace_orders table stores one product-backed offer per order for this
MVP. Workspace, lead, offer, and product foreign keys enforce tenant
consistency. The product and offer names, unit price, buyer contacts, and
generated total remain on the order if the live product or offer changes.
Referenced leads, offers, and products cannot be deleted while an order points
to them.

Order status is independent from lead and delivery status:

- draft can move to confirmed or cancelled.
- confirmed can move to cancelled.
- cancelled is terminal.

The generated total is quantity multiplied by unit_price_minor; prices are
integer UAH kopiykas. A unique workspace-scoped idempotency key makes creation
retries return the original order.

## API contract

All endpoints require an authenticated Supabase bearer token. The server uses
the caller's JWT for database access. Workspace and lead scope checks happen in
RLS and in the order RPCs; browser clients have no direct order write grants.

| Method and path                                            | Access                                                             | Request / response                                                                                                                                                        |
| ---------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET /api/workspaces/{workspaceId}/orders?q=                | orders.read or orders.manage, plus leads.read, scoped to each lead | Returns a success envelope with orders; newest 500 visible orders at most.                                                                                                |
| GET /api/workspaces/{workspaceId}/orders/context?leadId=   | orders.manage and leads.read for that lead                         | Returns lead contact and the linked offer/product context used to prefill an order.                                                                                       |
| POST /api/workspaces/{workspaceId}/orders                  | orders.manage and leads.read for that lead                         | Accepts leadId, UUID idempotencyKey, quantity, unitPriceUah, buyerName, buyerPhone, optional buyerEmail, and optional operatorComment. Returns an order id with HTTP 201. |
| GET /api/workspaces/{workspaceId}/orders/{orderId}         | Same row visibility as list                                        | Returns the order snapshot.                                                                                                                                               |
| PATCH /api/workspaces/{workspaceId}/orders/{orderId}       | orders.manage and leads.read; order must be a draft                | Replaces editable quantity, price, buyer contacts, and comment. Snapshot identity fields are not accepted.                                                                |
| POST /api/workspaces/{workspaceId}/orders/{orderId}/status | orders.manage and leads.read                                       | Accepts a confirmed or cancelled status; the database enforces allowed transitions.                                                                                       |

Errors use the existing success/code/error response envelope. Validation,
unauthorized, forbidden, not-found, and conflict responses use HTTP 400, 401,
403, 404, and 409 respectively. Unexpected database details stay in server
logs.

## Activation

Review and apply supabase/migrations/20261024100000_orders_mvp.sql to a
disposable database first, then run supabase/tests/orders-rls.sql there. The
migration has not been applied to remote Supabase by this implementation.
