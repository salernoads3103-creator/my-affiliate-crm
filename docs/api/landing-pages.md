# Landing Pages API (MVP)

Authenticated workspace API for creating and reviewing landing-page drafts. The API does not publish sites, execute uploaded JavaScript, extract archives to a filesystem, or rewrite HTML.

## Permissions

- `landing_pages.read` lists landing drafts and reads their archive analysis.
- `landing_pages.manage` creates drafts and uploads source ZIPs. Manage permission also allows listing.
- Draft creation additionally requires `offers.read`, because the selected active offer is verified against the existing offer catalog.
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

On success, returns HTTP 201 with the landing ID, workspace-scoped private archive path, and ZIP analysis. Status is `draft`. Unrecognized structure is flagged with `requiresAdaptation`; analysis never implies that a form has been rewritten or is ready to publish.

## Archive validation and storage

- The server enforces a 26 MiB multipart-body limit, ZIP structure and extension, at most 500 entries, at most 100 MiB total uncompressed data, at most 50 MiB per file, and a maximum compression ratio of 200:1.
- Only ordinary static assets are accepted: HTML, CSS, JavaScript, common image/font/media files, JSON, text, XML, web manifests, source maps, and PDF. Symlinks, special files, encrypted/multi-disk/ZIP64 archives, unsupported extensions, absolute paths, traversal, and ambiguous duplicate paths are rejected.
- Entries are streamed through bounded decompression for validation and inspection. The server never writes archive entries to a filesystem or executes their contents.
- Source archives are stored in the private `crmonia-landing-archives` bucket at `{workspaceId}/{landingId}/source.zip`. Database rows contain only the object path and JSON analysis, never ZIP bytes.
- The Supabase service-role credential is used only by the server-side route after authentication, workspace permission checks, offer verification, and ZIP validation; it is never included in browser code or responses.

## Analysis behavior

The analyzer recognizes `index.html` at the archive root or in one unique top-level folder when every file belongs to that folder. It stores `siteRootPath` in the analysis JSON (`""` for the archive root, otherwise the folder prefix, such as `"HARKIV HTML/"`; `null` when no unique root can be selected). Forms, fields, and known Meta, TikTok, and Google tracking snippets are analyzed relative to that root. The source ZIP is never rewritten. Multiple candidates or an ambiguous folder layout require adaptation. It reports JavaScript and unscanned-script warnings. Candidate detection is heuristic and must not be treated as proof that a form is compatible with the public lead-intake API.

## Errors

Responses use the existing `{ "success": false, "code": "...", "error": "..." }` envelope. Common statuses are `400` for invalid fields/archives, `401` for missing or invalid authentication, `403` for permission failures, `404` for an unavailable offer, `413` for an oversized upload, and `500` for unexpected storage/database failures. Internal database or Storage details are not returned.

## Scope deferred to a later stage

Publishing, custom domains, Cloudflare Workers/API, ZIP extraction for deployment, HTML/form rewrites, pixel management, previewing untrusted HTML, and editing/duplicating landing pages are not part of this API.
