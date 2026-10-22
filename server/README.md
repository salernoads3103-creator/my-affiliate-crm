# Lumen CRM — Standalone Express Backend

A production-ready REST API for the Lumen CRM frontend, built with Express + TypeScript + Supabase. Designed to be deployed on **Render** (or any Node host) and consumed by the Lovable/Vercel-hosted frontend simply by setting `VITE_API_URL`.

## Architecture

```
src/
├── index.ts              # Server bootstrap
├── app.ts                # Express app + middleware wiring
├── config/
│   ├── env.ts            # Validated environment variables (Zod)
│   └── supabase.ts       # Per-request Supabase client factory
├── middlewares/
│   ├── auth.ts           # Bearer-token auth (Supabase)
│   ├── errorHandler.ts   # Centralised error formatter
│   └── notFoundHandler.ts
├── controllers/
│   └── lead.controller.ts
├── services/
│   └── lead.service.ts   # All DB access lives here
├── routes/
│   └── leads.routes.ts
├── types/
│   └── lead.ts
└── utils/
    ├── ApiError.ts
    └── asyncHandler.ts
```

Layered architecture: **routes → middlewares → controllers → services → Supabase**.

## Authentication

The frontend obtains a Supabase session (email/password). Every request to this
API must include the user's access token:

```
Authorization: Bearer <supabase_access_token>
```

The `requireAuth` middleware:
1. Validates the bearer token via `supabase.auth.getUser(token)`.
2. Builds a per-request Supabase client that forwards the token, so **Row-Level
   Security policies execute as the signed-in user**. Lead queries are scoped
   by the shared PostgreSQL workspace permission functions; the Express service
   does not duplicate role or permission decisions.

The multi-user membership, invitation, role, and permission endpoints are served
by TanStack Start. They call the same PostgreSQL authorization functions used by
RLS. The Express service remains the lead API and relies on those RLS policies.
An authenticated account without an accepted workspace invitation receives no
lead access.

## REST Endpoints

All endpoints return `{ "success": boolean, "data"?: any, "error"?: string }`.

| Method | Path                | Description                       |
| ------ | ------------------- | --------------------------------- |
| GET    | `/health`           | Liveness check                    |
| GET    | `/api/leads`        | List the current user's leads     |
| POST   | `/api/leads`        | Create a lead                     |
| PUT    | `/api/leads/:id`    | Update a lead                     |
| DELETE | `/api/leads/:id`    | Delete a lead                     |
| GET    | `/api/leads/search?q=` | Search by name/email/company   |
| GET    | `/api/leads/stats`  | Totals + 14-day trend             |

### Lead schema

```ts
{
  name: string;            // required, 1–120 chars
  email: string;           // required, valid email
  phone?: string;
  company_name?: string;
  lead_status: "New" | "Contacted" | "Qualified" | "Converted" | "Lost";
  notes?: string;
}
```

## Local Development

```bash
cd server
cp .env.example .env       # fill in SUPABASE_URL + SUPABASE_PUBLISHABLE_KEY
npm install
npm run dev                # http://localhost:4000
```

Then in the frontend `.env`:

```
VITE_API_URL=http://localhost:4000
```

## Deploy to Render

The repository includes `server/render.yaml` for one-click deploys:

1. Push the repo to GitHub.
2. On Render, **New → Blueprint** and select the repo.
3. Set the environment variables when prompted:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `CORS_ORIGINS` (e.g. `https://your-app.vercel.app`)
4. Render builds with `npm install && npm run build` and starts with `npm start`.
5. Copy the resulting URL (e.g. `https://lumen-crm-api.onrender.com`) into the
   frontend env var `VITE_API_URL` and redeploy the frontend.

No code changes are required to switch the frontend between the in-app
TanStack server routes and this standalone Express backend — they expose the
same REST surface and response envelope.
