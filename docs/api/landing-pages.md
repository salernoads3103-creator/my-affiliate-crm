# Landing Pages API (MVP)

Authenticated workspace API for managing landing-page drafts and preparing a static archive for the existing Landing Intake API. The API does not publish sites, execute uploaded JavaScript, extract archives to a filesystem, or preview untrusted HTML.

## Permissions

- `landing_pages.read` lists landing drafts and reads their archive analysis.
- `landing_pages.manage` creates, edits, and deletes workspace drafts. Manage permission also allows listing.
- Draft creation and editing additionally require `offers.read`, because the selected offer is verified against the existing workspace offer catalog. A draft can keep its current inactive offer while its name is edited; changing the offer requires an active offer.
- Requests use the existing bearer-token authentication. Workspace and creator IDs come from the authenticated route context, not the multipart body.
- PostgreSQL RLS scopes reads. The route checks the caller's RBAC permissions before it uses the server-only service-role client to write metadata and upload the already validated archive. Authenticated browser clients have no direct INSERT/UPDATE or Storage upload permission for this feature. Each landing references an offer through a composite `(workspace_id, offer_id)` foreign key.

## List drafts

`GET /api/workspaces/{workspaceId}/landings?q={search}`

Returns `{ "success": true, "data": { "landings": [...] } }`. Search is capped at 120 characters and matches the landing or offer name. Each row includes the private Storage object path, not a public URL or signed download URL.

## Create a draft

`POST /api/workspaces/{workspaceId}/landings` as `multipart/form-data` with exactly these fields:

| Field     | Type | Requirements                       |
| --------- | ---- | ---------------------------------- |
| `name`    | text | 1–160 characters                   |
| `offerId` | UUID | Active offer in the same workspace |
| `archive` | file | `.zip`, 1–25 MiB                   |

On success, returns HTTP 201 with the landing ID, workspace-scoped private archive path, ZIP size, and ZIP analysis. Status is `draft`. Unrecognized structure is flagged with `requiresAdaptation`; analysis never implies that a form has been rewritten or is ready to publish.

## Edit a draft

`PATCH /api/workspaces/{workspaceId}/landings/{landingId}` as `multipart/form-data` with `name` and `offerId`, plus an optional `archive` file. The server applies the same size, archive format, decompression, path-safety, and analysis checks as draft creation. Only editable drafts in the route workspace can be changed. When a replacement ZIP is supplied, it is uploaded to a new private object path before metadata switches to it; the previous ZIP is removed only after the database update succeeds. Failed metadata updates leave the old archive referenced and clean up the unused replacement when possible.

## Delete a draft

`DELETE /api/workspaces/{workspaceId}/landings/{landingId}` requires `landing_pages.manage`. Only drafts can be deleted. The server first marks the row as pending deletion, then removes the private ZIP, then deletes metadata. If Storage or the database fails, the pending row remains visible with a retry action; subsequent DELETE requests resume the same operation. Published or otherwise non-draft landing pages are never deleted by this API.

## Connect a standard form

`POST /api/workspaces/{workspaceId}/landings/{landingId}/adapter` requires `landing_pages.manage` and `offers.read`. The optional JSON body is `{ "allowedOrigin": "https://shop.example.com" }`; if present, the value must be one exact HTTPS origin (local HTTP is accepted only for localhost in development). The server reads the linked offer from the stored landing row and creates or reuses its existing form integration. The browser cannot choose an offer, workspace, public form ID, or API URL.

The API statically checks the saved source ZIP and adapts only one unambiguous HTML form with one name field and one phone field. Existing submit/fetch/XHR behavior, unknown remote scripts, multiple forms, unsupported encodings, or ambiguous fields return HTTP 200 with `adapter_status: "needs_adaptation"` and a stable `adapter_reason`. No integration is created for a form rejected by this preflight. Successful adaptation returns only the state, reason, archive size, and a boolean indicating that a private ZIP is available; storage paths and form IDs are not returned.

If no integration exists, the server creates an inactive form integration with the reserved `https://pending.crmonia.invalid` origin. This gives the generated bundle its public form ID without enabling submissions. An exact origin supplied in the request activates that integration while preserving the ID. Without an origin or public API URL, the ZIP is still prepared with `adapter_status: "configuration_required"`; it is not ready to publish or accept leads. Configure the server variable `CRMONIA_PUBLIC_INTAKE_API_URL` to the exact public HTTPS endpoint, for example `https://crm.example.com/api/v1/intake/leads`, then connect the form again. Never use `localhost` in a production bundle.

The existing intake integration is one-per-offer and allows one exact origin. Landings for the same offer must use that origin. The adapter refuses a different origin rather than silently breaking another landing or the existing offer integration. Supporting multiple origins for one offer requires a later intake data-model change.

`GET /api/workspaces/{workspaceId}/landings/{landingId}/adapter` downloads the adapted ZIP only after bearer authentication, workspace permission checks, and draft ownership checks. The adapted archive remains private; no direct Storage policy is added for it. The original source ZIP is never modified. Re-adaptation always starts from the original and writes a versioned replacement before switching metadata. Replacing the source ZIP clears the adapter state, and deleting a draft removes both private archives.

## Archive validation and storage

- The server enforces a 26 MiB multipart-body limit, ZIP structure and extension, at most 500 entries, at most 100 MiB total uncompressed data, at most 50 MiB per file, and a maximum compression ratio of 200:1.
- Only ordinary static assets are accepted: HTML, CSS, JavaScript, common image/font/media files, JSON, text, XML, web manifests, source maps, and PDF. Symlinks, special files, encrypted/multi-disk/ZIP64 archives, unsupported extensions, absolute paths, traversal, and ambiguous duplicate paths are rejected.
- Entries are streamed through bounded decompression for validation and inspection. The server never writes archive entries to a filesystem or executes their contents.
- Source archives are stored in the private `crmonia-landing-archives` bucket at `{workspaceId}/{landingId}/source.zip` for existing drafts and versioned `source-{uuid}.zip` paths for replacements. Database rows contain the private object path, byte size, and JSON analysis, never ZIP bytes.
- The Supabase service-role credential is used only by the server-side route after authentication, workspace permission checks, offer verification, and ZIP validation; it is never included in browser code or responses.
- The adapter strips the analyzer's `siteRootPath`, preserves the contained static files and relative paths, tags the chosen form/fields, and adds one external `crmonia-intake-adapter.js`. The generated handler uses `textContent`, sends only the public form ID, contact fields, and supported UTM/click IDs, prevents duplicate submits while pending, and reports success/errors in Ukrainian or English. It does not contain workspace IDs, service-role credentials, or other privileged values.
- Adapted ZIPs use versioned paths under the private archive bucket. Their private paths are not part of the list RPC or browser response. Downloads pass through the authenticated adapter endpoint; browser clients have no write policy for either archive.

## Analysis behavior

The analyzer recognizes `index.html` at the archive root or in one unique top-level folder when every file belongs to that folder. It stores `siteRootPath` in the analysis JSON (`""` for the archive root, otherwise the folder prefix, such as `"HARKIV HTML/"`; `null` when no unique root can be selected). Forms, fields, and known Meta, TikTok, and Google tracking snippets are analyzed relative to that root. The source ZIP is never rewritten. Multiple candidates or an ambiguous folder layout require adaptation. It reports JavaScript and unscanned-script warnings. Candidate detection is heuristic and must not be treated as proof that a form is compatible with the public lead-intake API.

## Errors

Responses use the existing `{ "success": false, "code": "...", "error": "..." }` envelope. Common statuses are `400` for invalid fields/archives, `401` for missing or invalid authentication, `403` for permission failures, `404` for an unavailable offer/draft, `409` for a non-editable or non-deletable landing, `413` for an oversized upload, and `500` for unexpected storage/database failures. Internal database or Storage details are not returned.

## Scope deferred to a later stage

Publishing, custom domains, Cloudflare Workers/API, ZIP extraction for deployment, HTML/form rewrites, pixel management, previewing untrusted HTML, and duplicating landing pages are not part of this API.
