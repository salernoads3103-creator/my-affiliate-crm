# Landing Publication API

Server API for publishing a current Landing Factory build to a hostname already
registered in the workspace domain pool. The API uploads files to private R2,
records an immutable version, switches the database pointer, and then updates the
Worker's exact-host manifest. No browser client writes publication tables or R2.
The Domains and Landings UI does not yet expose these endpoints.

## Authentication and permissions

Requests use the existing bearer-token authentication. Publishing and rollback
require `landing_pages.manage`; version history requires `landing_pages.read` or
`landing_pages.manage`. Workspace, landing, host, reservation, active offer,
technical readiness, and form origin are checked on the server and by controlled
database RPCs. A hostname is reserved atomically during publication if it is
currently free. A hostname reserved by another landing or workspace is rejected.

All responses use the existing `{ success, data }` or `{ success, code, error }`
API envelope. Public URLs use HTTPS. Internal R2 credentials, object keys, and
database details are not returned.

## Publish

`POST /api/workspaces/{workspaceId}/landings/{landingId}/publication`

Headers:

- `Authorization: Bearer …`
- `Content-Type: application/json`
- `Idempotency-Key: <16–128 ASCII letters, digits, dot, underscore, colon, or dash>`

Body:

```json
{ "hostId": "<workspace domain host UUID>" }
```

The server recomputes Landing Factory readiness, downloads only the current
adapted ZIP, validates its ZIP structure and static file types again, strips the
detected `siteRootPath`, verifies each uploaded object, and stores objects below
the immutable database-generated prefix. Only after every file is present does
the database atomically move the current-version pointer and add the exact
published HTTPS origin to the existing Intake integration. The Worker manifest
is updated last. The response includes `hostname`, `versionId`, `versionNumber`,
`url`, and `replayed`.

Use the same idempotency key when retrying a timed-out request. Reusing a key
with different ZIP contents or another landing on the same hostname returns
`409`. A concurrent publication for that hostname is rejected while an earlier
operation is unresolved. R2 object PUTs are idempotent within the immutable
version prefix, so a timed-out upload can be retried with the same key. Partial
objects may remain under an unpublished version prefix after a failed attempt;
they are never served by the Worker. Upload or verification failures leave the
active Worker manifest unchanged. If the database pointer has switched but
R2's manifest result cannot be confirmed, the operation remains locked for a
same-key retry/recovery; it is not reported as successful.

## History and rollback

`GET /api/workspaces/{workspaceId}/landings/{landingId}/publication`

Returns at most 200 completed publication versions, newest first, with host,
version number, timestamp, HTTPS URL, and whether it is current. Incomplete or
failed uploads are excluded.

`POST /api/workspaces/{workspaceId}/landings/{landingId}/publication/rollback`

Use the same authentication and `Idempotency-Key` header. Body:

```json
{
  "hostId": "<workspace domain host UUID>",
  "targetVersionId": "<completed version UUID>"
}
```

Rollback validates that the target was previously published for this exact host
and landing, checks that `index.html` still exists in R2, then atomically changes
the database pointer and Worker manifest. It does not re-upload or mutate the
immutable version. Status from an Intake request remains independent of landing
publication status.

## R2 and Worker configuration

The application server needs a least-privilege R2 S3 credential for the target
private bucket:

- `CLOUDFLARE_R2_ACCOUNT_ID`
- `CLOUDFLARE_R2_ACCESS_KEY_ID`
- `CLOUDFLARE_R2_SECRET_ACCESS_KEY` (secret)
- `CLOUDFLARE_R2_BUCKET_NAME`

The Worker must bind that same private bucket as `LANDING_BUCKET`. It reads only
`host-manifests/{exact-lowercase-hostname}.json`, accepts only `GET` and `HEAD`,
and validates the version prefix. The server writes manifests and static files;
the public Worker has no R2 write binding or methods. Never put the S3 access key
or secret in a landing ZIP, browser bundle, API response, or log.

The server adapter uses the portable R2 S3 endpoint and Web Crypto SigV4 so it
works from Render or a future VPS without Cloudflare-specific server bindings.
The conventional alternative is an AWS S3 SDK client, which carries more
dependency weight but delegates signing and transport edge cases to a maintained
library. The repository has no S3 SDK dependency, so this stage keeps one narrow
adapter and pins its signature format with a deterministic test. Scope the R2
credential to this bucket with object read/write access; the server does not
need bucket listing or deletion, and the Worker only has its private read binding.

### Read-only DEV connection check

`GET /api/workspaces/{workspaceId}/r2-health` performs a signed S3 `HeadBucket`
request. It does not read or write objects, create publication records, or return
credentials. It is available only when all of these conditions match: Render is
running service `crmonia-intake-api-test` from branch `develop`, and
`CRMONIA_R2_DIAGNOSTICS_ENABLED=true`. The authenticated caller also needs
`landing_pages.manage` in the requested workspace. The endpoint returns only a
status (`connected`, `configuration_error`, `provider_rejected`, `unreachable`,
or `unavailable`) and, for a provider rejection, its HTTP status and request ID.
Keep the opt-in variable unset outside the DEV service.

## Isolated workers.dev test

The existing `crmonia-landing-poc.salernoads3103.workers.dev` address can use the
normal publication checks without a production exception:

1. In a development workspace, register the exact Worker hostname as a root
   address in Domains and run the normal HTTPS verification. The checker makes
   a live HTTPS `HEAD`; a Worker `404` before a manifest exists is acceptable as
   proof of reachable HTTPS, while it does not claim the page is published.
2. Run the CRMONIA development server with a separate Cloudflare R2 credential
   restricted to `crmonia-landing-poc-test`, and set
   `CLOUDFLARE_R2_BUCKET_NAME=crmonia-landing-poc-test`. The Worker PoC already
   binds this bucket privately as `LANDING_BUCKET`.
3. Connect the landing form to its existing Intake configuration, then publish
   to the verified Worker host using the authenticated endpoint above. The
   publication transaction adds only `https://crmonia-landing-poc.salernoads3103.workers.dev`
   as an exact allowed origin for that published form.
4. Verify the returned URL, CSS/images, and a test lead in the development CRM.
   Keep the test bucket and credentials separate from production R2.

This tests the complete R2/Worker/Intake path. It does not validate custom-domain
DNS automation, Cloudflare routes, or production domain ownership. No wildcard
origin or `.workers.dev` suffix exception is added.

## Migration and activation

Apply append-only migration
`20261025140000_landing_publication_operations.sql` to the intended database,
then run `supabase/tests/landing-publication-operations-rls.sql` on a disposable
database. The migration adds server-only idempotency/recovery state and narrow
RPCs; it does not change existing domain tables or apply itself remotely.

Configure the server-side R2 variables, deploy the matching Worker code/config
manually, then deploy the CRM server. Before a production rollout, exercise a
failed upload, duplicate request, and rollback in a non-production workspace.
