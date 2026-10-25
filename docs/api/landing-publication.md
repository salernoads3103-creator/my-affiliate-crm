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

The server adapter uses `@aws-sdk/client-s3` against the account's R2 S3 endpoint,
with region `auto` and path-style bucket addressing. Credentials are passed only
to the server-side client. The SDK owns SigV4 signing and HTTP transport; the
small CRMONIA adapter still validates object keys, bounds manifest reads,
sanitizes provider errors, and uses one SDK attempt so publication recovery stays
under the existing idempotent workflow. Compared with retaining the smaller
handwritten signer, this adds SDK dependencies and server bundle size while
removing our responsibility for canonical request construction and SigV4
edge cases. The publication path needs object
`HeadObject`, `GetObject`, and `PutObject`; it does not require `HeadBucket`,
bucket listing, or deletion. The DEV diagnostic keeps `HeadBucket` separate
from `HeadObject`, since a bucket-level 403 does not establish that object
access is failing. Keep the credential scoped to this bucket with the required
object access, and leave the Worker's private read binding unchanged.

### Read-only DEV connection check

`GET /api/workspaces/{workspaceId}/r2-health` performs a signed S3 `HeadBucket`
request and a body-free `HeadObject` request for the known PoC file
`sites/landing-1/version-1/index.html`. The two outcomes are returned separately,
so a bucket-level denial is not treated as proof that object access is broken.
It does not return object content, write objects, create publication records, or
return credentials. It is available only when all of these conditions match: Render is
running service `crmonia-intake-api-test` from branch `develop`, and
`CRMONIA_R2_DIAGNOSTICS_ENABLED=true`. The authenticated caller also needs
`landing_pages.manage` in the requested workspace. The endpoint returns only a
status per probe (`connected`, `not_found`, `configuration_error`,
`provider_rejected`, `unreachable`, or `unavailable`). For provider rejections,
it may include the HTTP status, a sanitized S3 error code, and request ID.
`SignatureDoesNotMatch` can mean an incorrect secret or a SigV4
canonical-request mismatch; compare with a trusted S3 client before concluding
which one. `InvalidAccessKeyId` identifies an unrecognized access key.
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
