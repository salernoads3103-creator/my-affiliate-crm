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

## Engineering and security rules

- Before changing the database, inspect the existing schema, migration order, dependencies, and data-preservation behavior. Do not apply remote Supabase migrations automatically.
- Deny access by default; enforce authorization on the server and with PostgreSQL RLS. Keep permission checks consistent and minimize privileges.
- Never put production secrets, Supabase `service_role` keys, or other secret keys in frontend code or browser environment variables.
- Preserve existing users, leads, and other data unless the user explicitly authorizes a data change.
- Do not create Git commits or push without explicit user permission.
- Communicate and provide user-facing instructions in Ukrainian.
