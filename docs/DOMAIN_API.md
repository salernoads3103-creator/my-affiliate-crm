# Domains API (stage 2)

All routes require a valid `Authorization: Bearer <Supabase access token>` header.
The server checks the caller's `landing_pages.read` or `landing_pages.manage`
permission in the requested workspace before using the service-role client.
Database writes are available only through service-role RPCs. Request bodies are
strict JSON objects; unknown fields are rejected.

## `GET /api/workspaces/{workspaceId}/domains`

Requires `landing_pages.read` or `landing_pages.manage`. Returns the unified
address pool, including root domains and subdomains:

The response includes the complete workspace pool (no client cursor); server
queries read bounded database pages so the Supabase row limit does not silently
truncate the list.

```json
{
  "success": true,
  "data": {
    "addresses": [{
      "id": "<host UUID>",
      "domainId": "<domain UUID>",
      "hostname": "britva.myshop.com",
      "apexDomain": "myshop.com",
      "addressType": "subdomain",
      "domainStatus": "active",
      "technicalStatus": "ready",
      "technicalCheckedAt": "<ISO timestamp>",
      "technicalErrorCode": null,
      "usageStatus": "free",
      "createdAt": "<ISO timestamp>"
    }]
  }
}
```

`technicalStatus` is `not_configured | checking | ready | error`. `usageStatus`
is `free | reserved | published | disabled`. A legacy `connectionStatus=active`
does not make an address ready; only a successful live HTTPS probe does.

## `POST /api/workspaces/{workspaceId}/domains`

Requires `landing_pages.manage`. Body: `{ "domainName": "myshop.com" }`.
The server canonicalizes international hostnames to lower-case ASCII, rejects
URLs, ports, IP addresses, local/special-use suffixes and malformed names, then
atomically creates the root domain and its address. A repeated request for the
same workspace returns the existing IDs; a hostname owned elsewhere returns
`409 CONFLICT` without identifying its owner.

## `POST /api/workspaces/{workspaceId}/domains/{domainId}/hosts`

Requires `landing_pages.manage`. Body:
`{ "hostnames": "britva\nshaver.myshop.com" }`. A connected, verified root
domain is required. Up to 500 non-empty lines are accepted. Each line returns
`added | already_exists | invalid | conflict`, the original line number, and
the normalized hostname when valid. Short labels and fully-qualified names under
the selected root are accepted; offer IDs are not accepted or stored here.

## `POST /api/workspaces/{workspaceId}/domain-hosts/{hostId}/verify`

Requires `landing_pages.manage`; no request body. The server makes a bounded
HTTPS `HEAD` request without credentials, follows no redirects and reads no
response body. Literal IPs and local/special-use hostname suffixes are rejected.
Any HTTPS response confirms DNS resolution and TLS reachability; network/TLS
failures and timeouts are stored as allowlisted error codes. The standard Fetch
runtime does not pin the DNS answer, so DNS rebinding to a private address is not
fully eliminated; keep this permission restricted to trusted workspace managers
until a provider-aware verifier can validate the intended public DNS target.
This check also does not prove that DNS points to a future CRMONIA Worker. A
publication flow must verify its expected routing target separately.

## `GET /api/workspaces/{workspaceId}/domain-hosts/available`

Requires `landing_pages.read` or `landing_pages.manage`. Returns only addresses
whose parent domain is active, usage is free, technical state is ready and the
live check is less than five minutes old.

## Reserve and release

- `POST /api/workspaces/{workspaceId}/domain-hosts/{hostId}/reservation`
  requires `landing_pages.manage`; body: `{ "landingId": "<UUID>" }`. The
  server repeats the live check, then a row-locking RPC atomically reserves the
  hostname for an active same-workspace landing. Repeating the same reservation
  is idempotent; a competing reservation returns `409 CONFLICT`.
- `DELETE /api/workspaces/{workspaceId}/domain-hosts/{hostId}/reservation?landingId=<UUID>`
  requires `landing_pages.manage`. It releases only that landing's reservation.
  An active publication cannot be released through this endpoint.

Errors use the standard API envelope `{ "success": false, "code": "...", "error": "..." }`.
Expected codes include `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`,
`VALIDATION_ERROR`, `CONFLICT`, `PAYLOAD_TOO_LARGE` and `INTERNAL_ERROR`.
