# Landing Lead Intake API (MVP)

`POST /api/v1/intake/leads` accepts a public lead from an owned landing page. It is separate from the authenticated CRM APIs. The browser sends only a public form ID; the server loads the workspace and offer from the saved integration. Anonymous clients cannot insert into `public.leads` or read integration tables.

## Connect an offer

1. Open **Offers**, edit an active offer, and open **Landing page connection**.
2. Enter the exact origin of the landing page (for example `https://shop.example.com`, with no path or trailing slash). HTTPS is required; local `localhost` and `127.0.0.1` origins may use HTTP for development.
3. Connect the page and copy the generated HTML/JavaScript example. The public form ID is an identifier, not a credential.
4. Keep `SUPABASE_SERVICE_ROLE_KEY` server-side only. Never copy it into the landing page.

Creating a connection again after deactivation rotates the public form ID. Update the landing page snippet after reactivation. Deactivating a form or its offer stops intake.

## Request

Content type is `application/json`. `Idempotency-Key` is recommended for retries; the copied example generates one for each submission. If omitted, the API derives a short-lived key from the validated request body.

```json
{
  "formId": "public-form-uuid",
  "name": "Олена",
  "phone": "+380501234567",
  "email": "olena@example.com",
  "utmSource": "tiktok",
  "utmMedium": "paid",
  "utmCampaign": "autumn",
  "utmContent": "video-1",
  "utmTerm": "shaver",
  "ttclid": "click-id",
  "gclid": "google-click-id",
  "gbraid": "google-bridge-id",
  "wbraid": "web-bridge-id",
  "subId": "placement-7",
  "deliveryType": "warehouse",
  "cityRef": "provider-city-ref",
  "cityName": "Київ",
  "warehouseRef": "provider-warehouse-ref",
  "warehouseName": "Відділення 1"
}
```

Required: `formId`, `name`, and a Ukrainian phone number (accepted formats normalize to `+380XXXXXXXXX`). Email, attribution and delivery fields are optional. Attribution supports UTM values, TikTok `ttclid`, Google Ads `gclid`/`gbraid`/`wbraid`, and `subId`; click IDs are stored as opaque values on the lead. `deliveryType` is one of `warehouse`, `postomat`, or `address`. Delivery references and names are stored separately; no carrier lookup or API call is made.

Unknown fields, including `workspace_id`, `operator_id`, and client-supplied prices, are rejected. The generated snippet includes an off-screen `website` honeypot; when it is filled the API returns the same generic acceptance response without creating a lead. Workspace, offer, status (`New`), source (`landing`), and author (`NULL`) are assigned by the server.

## Response and errors

Accepted and idempotent replay both return `202` with only `{ "success": true, "accepted": true }`. No lead or workspace ID, contact data, or database detail is returned.

| HTTP | Code                 | Meaning                                                   |
| ---- | -------------------- | --------------------------------------------------------- |
| 400  | `VALIDATION_ERROR`   | Invalid JSON or field values                              |
| 404  | `FORM_UNAVAILABLE`   | Unknown/inactive form, inactive offer, or origin mismatch |
| 413  | `PAYLOAD_TOO_LARGE`  | JSON body exceeds 16 KiB                                  |
| 429  | `RATE_LIMITED`       | Per-IP or per-form request limit reached                  |
| 503  | `INTAKE_UNAVAILABLE` | Server configuration or database operation unavailable    |

The configured origin is checked on the public intake route only. Preflight allows `POST` with `Content-Type` and `Idempotency-Key`; credentialed CORS is disabled. CORS is a browser policy, not authorization.

## Abuse controls and deployment

- Database-side atomic limits: 5 submissions per minute per form and hashed IP, plus 60 intake/preflight requests per minute per hashed IP. Rate state is shared across app instances.
- Request validation caps every field and the JSON body at 16 KiB. Duplicate requests are serialized and deduplicated in PostgreSQL.
- Public intake rows are written through a `SECURITY DEFINER` function executable only by `service_role`; there is no anonymous insert grant or policy on `leads`.
- IPs are HMACed before they reach the database. Configure `LANDING_INTAKE_IP_HASH_SECRET` as a random server-only value of at least 32 characters.
- On Render, set `LANDING_INTAKE_TRUSTED_PROXY_HEADER=cf-connecting-ip`. Render routes public web-service traffic through Cloudflare; Cloudflare provides `CF-Connecting-IP` to the origin as a single client address. The API validates it as an IP literal and fails closed (503) when it is missing or invalid rather than sharing an `unknown` rate-limit bucket. `X-Forwarded-For` is not used for Render because a caller can supply a leftmost value in that chain.
- For a VPS or custom reverse proxy, `LANDING_INTAKE_TRUSTED_PROXY_HEADER=x-forwarded-for` is supported only when the proxy overwrites the incoming header with one verified client address (no comma-separated chain), and the application origin is reachable only through that proxy. Never select the first address from a client-supplied forwarded chain. Render's general guidance identifies `X-Forwarded-For` for client IPs, but does not define a universal chain topology; see [Render guidance](https://render.com/articles/how-render-handles-ddos-attacks) and [Cloudflare header behavior](https://developers.cloudflare.com/fundamentals/reference/http-headers/).
- The server also needs its existing server-only Supabase URL and service-role configuration. Never use `VITE_` variables for privileged keys.

## Local demo

Start CRMONIA with `bun run dev` and note the local URL printed by Vite. In another terminal, serve the static example from the repository root:

```powershell
python -m http.server 4173 --directory examples/landing-demo
```

Connect the offer with allowed origin `http://localhost:4173`. In `examples/landing-demo/index.html`, set `API_ENDPOINT` to the CRMONIA URL plus `/api/v1/intake/leads` and replace `PUBLIC_FORM_ID` with the generated ID. Open `http://localhost:4173`. The demo includes no secrets and does not call Nova Poshta.
