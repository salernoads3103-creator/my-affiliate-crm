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

`POST /api/workspaces/{workspaceId}/landings/{landingId}/adapter` requires `landing_pages.manage` and `offers.read`. The optional JSON body supports `allowedOrigin`, one `tiktokProfileId`, and one `googleAdsProfileId`. Each profile ID is resolved server-side within the route workspace; disabled or wrong-platform profiles are rejected. The legacy `tiktokPixelId` and paired `googleAdsConversionId` / `googleAdsConversionLabel` fields remain accepted for older clients. New clients use saved profiles; older direct IDs already stored on a landing remain available through a “keep existing ID” option. The origin, if present, must be one exact HTTPS origin (local HTTP is accepted only for localhost in development). Pixel and Google Ads identifiers are public tag configuration, not secrets. The server reads the linked offer from the stored landing row and creates or reuses its existing form integration. The browser cannot choose an offer, workspace, public form ID, or API URL.

`GET /api/workspaces/{workspaceId}/landings/{landingId}/tracking-config` requires `landing_pages.manage`. It returns the selected profile IDs, indicates whether a legacy direct ID is being retained, and reports current build readiness for the source ZIP, offer, form/origin, server Intake endpoint, and resolved tracking profiles. `needsRepublish` is true when the stored adapted ZIP has no complete build fingerprint or the current inputs differ. This endpoint does not change the stored archive. DNS, HTTPS reachability, and publication are not verified.

`GET /api/workspaces/{workspaceId}/tracking-profiles` requires `landing_pages.read` or `landing_pages.manage` and lists public tracking IDs scoped to that workspace. `POST` and `PUT /api/workspaces/{workspaceId}/tracking-profiles/{profileId}` require `landing_pages.manage`; they create or edit a named TikTok Ads or Google Ads profile, including its active state. Writes use server credentials after permission checks. There is no browser table-write grant or profile delete endpoint; profiles are disabled instead. A profile edit never rewrites a prepared ZIP. The next explicit adapter run resolves the currently selected profile and produces a new ZIP; changed configuration is surfaced as requiring republishing.

The API statically checks the saved source ZIP and adapts only one unambiguous HTML form with one name field and one phone field. Existing submit/fetch/XHR behavior, unknown remote scripts, multiple forms, unsupported encodings, or ambiguous fields return HTTP 200 with `adapter_status: "needs_adaptation"` and a stable `adapter_reason`. No integration is created for a form rejected by this preflight. Successful adaptation returns only the state, reason, archive size, public TikTok/Google Ads tag configuration, and a boolean indicating that a private ZIP is available; storage paths and form IDs are not returned.

If no integration exists, the server creates an inactive form integration with the reserved `https://pending.crmonia.invalid` origin. This gives the generated bundle its public form ID without enabling submissions. An exact origin supplied in the request activates that integration while preserving the ID. Without an origin or public API URL, the ZIP is still prepared with `adapter_status: "configuration_required"`; it is not ready to publish or accept leads. Configure the server variable `CRMONIA_PUBLIC_INTAKE_API_URL` to the exact public HTTPS endpoint, for example `https://crm.example.com/api/v1/intake/leads`, then connect the form again. Never use `localhost` in a production bundle.

The legacy intake integration remains one-per-offer and retains its original exact `allowed_origin` for existing Render pages. Published domain hosts add separate exact HTTPS origins through `landing_form_allowed_origins`; the publication API registers those only after its database version switch. This preserves old Render forms while allowing multiple published hostnames without wildcard CORS. If an offer already has an active legacy integration, omitting `allowedOrigin` reuses it and preserves older manually integrated landing pages.

When a TikTok Pixel ID is configured and no TikTok Pixel or Google Tag Manager conflict is detected, the adapter adds TikTok's base code (PageView) when needed and sends `SubmitForm` only after the intake endpoint confirms HTTP 202 with `{ "success": true, "accepted": true }`. A detected matching Pixel is reused; a different or ambiguous Pixel blocks adaptation. With a Google Ads Conversion ID and Label, the adapter adds the Google tag base code (PageView) only when no Google tag, Analytics tag, or Google Tag Manager is detected, then sends one `conversion` event to `AW-ID/LABEL` after the same confirmed acceptance. Existing Google tags block Google Ads auto-installation rather than risking duplicate events. Both platforms use the same accepted-submit path; tracking failures do not change the lead result, and a honeypot submission fires neither conversion event. The adapter forwards UTM values, `ttclid`, `gclid`, `gbraid`, `wbraid`, and `sub_id` from the landing URL to Intake API.

`GET /api/workspaces/{workspaceId}/landings/{landingId}/adapter` downloads the adapted ZIP only after bearer authentication, workspace permission checks, draft ownership checks, a server-side `prepared` state check, and a comparison of the stored build fingerprint with current server-side inputs. A ZIP in `configuration_required` or with changed inputs is not downloadable as a current publication bundle. The adapted archive remains private; no direct Storage policy is added for it. The original source ZIP is never modified. Re-adaptation always starts from the original and writes a versioned replacement before switching metadata. Replacing the source ZIP clears the adapter state, and deleting a draft removes both private archives.

The prepared build fingerprint is SHA-256 over the source ZIP bytes, workspace and offer snapshot, form ID and origin/active state, configured public Intake endpoint, resolved TikTok/Google Ads profiles and their active states, and the adapter version. Legacy adapted archives without this fingerprint are treated as stale and must be prepared again before downloading; this does not alter already deployed static sites or deactivate their existing Intake integrations. The append-only migration `20261024170000_landing_build_fingerprint.sql` must be applied before deploying code that reads/writes the new column.

## Archive validation and storage

- The server enforces a 26 MiB multipart-body limit, ZIP structure and extension, at most 500 entries, at most 100 MiB total uncompressed data, at most 50 MiB per file, and a maximum compression ratio of 200:1.
- Only ordinary static assets are accepted: HTML, CSS, JavaScript, common image/font/media files, JSON, text, XML, web manifests, source maps, and PDF. Symlinks, special files, encrypted/multi-disk/ZIP64 archives, unsupported extensions, absolute paths, traversal, and ambiguous duplicate paths are rejected.
- Entries are streamed through bounded decompression for validation and inspection. The server never writes archive entries to a filesystem or executes their contents.
- Source archives are stored in the private `crmonia-landing-archives` bucket at `{workspaceId}/{landingId}/source.zip` for existing drafts and versioned `source-{uuid}.zip` paths for replacements. Database rows contain the private object path, byte size, and JSON analysis, never ZIP bytes.
- The Supabase service-role credential is used only by the server-side route after authentication, workspace permission checks, offer verification, and ZIP validation; it is never included in browser code or responses.
- The adapter strips the analyzer's `siteRootPath`, preserves the contained static files and relative paths, tags the chosen form/fields, adds an off-screen `website` honeypot and one external `crmonia-intake-adapter.js`. It uses one idempotency key for the same in-page attempt across a network timeout, blocks concurrent submits, and reports success/errors in Ukrainian or English. It contains only public ad-tag IDs and labels, never workspace IDs, service-role credentials, or other privileged values. Personal form data is not written to adapter logs.
- Adapted ZIPs use versioned paths under the private archive bucket. Their private paths are not part of the list RPC or browser response. Downloads pass through the authenticated adapter endpoint; browser clients have no write policy for either archive.

## Analysis behavior

The analyzer recognizes `index.html` at the archive root or in one unique top-level folder when every file belongs to that folder. It stores `siteRootPath` in the analysis JSON (`""` for the archive root, otherwise the folder prefix, such as `"HARKIV HTML/"`; `null` when no unique root can be selected). Forms, fields, and known Meta, TikTok, and Google tracking snippets are analyzed relative to that root. The source ZIP is never rewritten. Multiple candidates or an ambiguous folder layout require adaptation. It reports JavaScript and unscanned-script warnings. Candidate detection is heuristic and must not be treated as proof that a form is compatible with the public lead-intake API.

## Errors

Responses use the existing `{ "success": false, "code": "...", "error": "..." }` envelope. Common statuses are `400` for invalid fields/archives, `401` for missing or invalid authentication, `403` for permission failures, `404` for an unavailable offer/draft, `409` for a non-editable or non-deletable landing, `413` for an oversized upload, and `500` for unexpected storage/database failures. Internal database or Storage details are not returned.

## Scope deferred to a later stage

The server-side publication endpoints are documented in [Landing Publication API](landing-publication.md). A publication UI, custom-domain/DNS automation, Cloudflare resource management, HTML/form rewrites beyond the standard form adapter, previewing untrusted HTML, and duplicating landing pages remain outside this API stage.
