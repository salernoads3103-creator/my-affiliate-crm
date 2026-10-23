# CRMONIA project context

CRMONIA is a multi-user CRM for e-commerce, product arbitrage, and independent call centers. Keep this product name; do not rename the repository, existing folders, configuration, environment variables, or components unless explicitly requested.

## Stack

- React 19, TypeScript, TanStack Start/Router, TanStack Query, and Vite.
- Supabase Auth and PostgreSQL with Row Level Security.
- TanStack Start server routes and an optional standalone Express/TypeScript API in `server/`.

## Product direction

- Manage leads, offers, landing pages, and ad campaigns; accept landing-page submissions through an API and retain UTM, `ttclid`, `sub_id`, and related attribution data.
- Support Super Admin, Admin, Operator, and Viewer roles, individual permissions, controlled delegation, and data visibility scoped to workspaces, teams, operators, and offers.
- Use one main workspace for the MVP while keeping the data model scalable to multiple workspaces.
- Plan for bidirectional status synchronization with independent call centers through APIs and webhooks, and for deployment on a customer-managed VPS.
- Preserve the existing interface and Dark Minimal direction; do not redesign it without a request.

## Engineering standards and security rules

- Keep the project structure predictable and organized around clear application or domain boundaries. Document intentional exceptions and avoid unexplained conventions.
- Use readable TypeScript and explicit types at module boundaries, including API inputs and outputs, environment configuration, and database results. Prefer generated database types and runtime validation over unchecked casts.
- Keep UI rendering, HTTP/API transport, business rules, and database access separate. Keep route handlers focused on request validation, authorization, orchestration, and response mapping.
- CRMONIA is an MVP and its screens, navigation, and feature set may change substantially. Do not recommend or perform broad UI refactors just to shorten files or impose a fixed component structure. Prefer small, incremental boundaries that isolate business rules, permissions, validation, and API contracts from the UI; extract UI components when concrete reuse or a specific change makes that useful.
- Minimize duplication and complexity. Apply DRY, KISS, and SOLID where they reduce change risk; avoid premature abstractions and unnecessary indirection.
- Keep one source of truth for validation, authorization rules, and shared API contracts where practical. Do not let parallel implementations silently drift.
- Document API contracts, including authentication, authorization, request/response shapes, errors, pagination, and versioning where applicable. Validate external input at the server boundary.
- Make configuration and dependencies explicit. Validate required configuration at startup, avoid unexplained magic values and hidden runtime dependencies, and document non-obvious decisions.
- Use consistent repository-wide TypeScript, ESLint, and Prettier rules. Run the relevant checks for changes; avoid broad lint suppressions and unreviewed mass formatting.
- Before changing the database, inspect the existing schema, migration order, dependencies, and data-preservation behavior. Keep applied migrations immutable; make new migrations narrowly scoped, reviewed, and safe for existing data. Test schema, RLS, and preservation behavior against a disposable local database. Do not apply remote Supabase migrations automatically.
- Deny access by default; enforce authorization on the server and with PostgreSQL RLS. Keep permission checks consistent and minimize privileges. Review `SECURITY DEFINER` functions, their `search_path`, and their execute grants/revokes.
- Add automated tests for critical business rules, API authorization, RBAC/RLS boundaries, migration preservation, and high-risk workflows. Never point destructive or fixture-based tests at a production or shared remote database.
- Design integrations around documented, versioned contracts. For external submissions and webhooks, account for authentication/signatures, idempotency, retries, and safe status synchronization.
- Never put production secrets, Supabase `service_role` keys, or other secret keys in frontend code or browser environment variables. Keep privileged credentials server-only and use least privilege.
- Preserve existing users, leads, and other data unless the user explicitly authorizes a data change.
- Do not create Git commits or push without explicit user permission.
- Communicate and provide user-facing instructions and audit reports in Ukrainian.
