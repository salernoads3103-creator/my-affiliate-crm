# Lumen CRM

A premium, full-stack **Lead Management CRM** built as a production-grade SaaS
product. Inspired by the polish of Linear, Notion, and Stripe Dashboard — with
a warm cream + indigo design language, smooth Framer Motion micro-interactions,
real-time search, pipeline analytics, and a clean layered architecture.

> Two deployable backends, one API contract. Ship the frontend on Vercel and
> run the API either in-app (TanStack server routes) or as the standalone
> **Express** service in [`/server`](./server) on Render — swap between them
> by changing a single environment variable.

---

## ✨ Features

- 🔐 **Authentication** — Supabase Auth with invitation-only workspace membership
- 📋 **Leads CRUD** — Create, read, update, delete with React Hook Form + Zod-style validation
- 🔎 **Realtime search** — Debounced, server-side `ILIKE` across name, email, company
- 🎯 **Filters & pagination** — Status filter + 10-per-page client pagination
- 🟣 **Status pipeline** — `New → Contacted → Qualified → Converted / Lost`
- 📊 **Dashboard analytics** — Stat cards, donut chart by status, 14-day trend area chart (Recharts)
- 📥 **CSV export** — One-click export of the current filtered view
- ⌘ **Command palette** — `⌘K` / `Ctrl+K` for fast navigation and "Add lead"
- 🎨 **Premium UI** — Cream `#F8F5F0` background, indigo + purple accents, glassmorphism cards, elegant shadows
- 🌗 **Light / Dark themes** — Cream-light by default, polished dark mode
- 📱 **Fully responsive** — Mobile-first layout with collapsible sidebar
- 💬 **Toast feedback**, skeletons, empty states, optimistic invalidation

---

## 🧱 Tech Stack

**Frontend**

- React 19 + TypeScript
- TanStack Start (file-based routing, SSR-ready) + TanStack Router
- TanStack Query (server-state cache)
- Tailwind CSS v4 + custom design tokens
- Framer Motion (animations)
- React Hook Form + Zod (forms & validation)
- Recharts (statistics)
- Lucide icons, Sonner toasts, shadcn/ui primitives

**Backend (two interchangeable implementations)**

- **In-app**: TanStack Start server routes under `src/routes/api/*`
- **Standalone**: Express + TypeScript in [`/server`](./server) — deployable to Render

**Database & Auth**

- Supabase (Postgres + Row-Level Security + Auth)

---

## 📁 Folder Structure

```
.
├── src/
│   ├── routes/
│   │   ├── __root.tsx                 # App shell
│   │   ├── index.tsx                  # Redirect → /dashboard or /auth
│   │   ├── auth.tsx                   # Sign in / sign up
│   │   ├── _authenticated/
│   │   │   ├── route.tsx              # Auth gate (managed)
│   │   │   ├── dashboard.tsx          # Stats + charts + recent activity
│   │   │   └── leads.tsx              # Full leads table
│   │   └── api/leads/                 # REST endpoints (TanStack server routes)
│   │       ├── index.ts               # GET / POST
│   │       ├── $id.ts                 # PUT / DELETE
│   │       ├── search.ts              # GET ?q=
│   │       └── stats.ts               # GET
│   ├── components/
│   │   ├── layout/AppShell.tsx
│   │   ├── dashboard/{StatsCards,DashboardCharts}.tsx
│   │   ├── leads/{LeadModal,DeleteModal,StatusBadge}.tsx
│   │   ├── common/CommandPalette.tsx
│   │   └── ui/                        # shadcn primitives
│   ├── hooks/                         # useLeadsApi, useDebounce, useCommandPalette
│   ├── lib/leads/                     # service / controller / types (shared shape)
│   ├── services/                      # api.ts + leadService.ts (HTTP client)
│   ├── integrations/supabase/         # Generated clients (do not edit)
│   └── styles.css                     # Cream + indigo design tokens
├── server/                            # Standalone Express backend (Render-ready)
│   ├── src/
│   │   ├── index.ts | app.ts
│   │   ├── config/ | middlewares/ | routes/ | controllers/ | services/ | types/ | utils/
│   ├── package.json | tsconfig.json | render.yaml | .env.example
│   └── README.md
├── supabase/migrations/               # SQL migration history
└── README.md
```

---

## 🔐 Environment Variables

### Frontend (`.env`)

| Variable                        | Required | Description                                                                                                                      |
| ------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | ✅       | Supabase project URL                                                                                                             |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | ✅       | Supabase anon/publishable key                                                                                                    |
| `VITE_SUPABASE_PROJECT_ID`      | ✅       | Supabase project ref                                                                                                             |
| `VITE_API_URL`                  | ❌       | If set, frontend calls this base URL (e.g. the Render-hosted Express service). If empty, uses the in-app TanStack server routes. |

### Backend (`server/.env`)

| Variable                   | Required  | Description                                            |
| -------------------------- | --------- | ------------------------------------------------------ |
| `PORT`                     | ❌        | Default `4000`                                         |
| `NODE_ENV`                 | ❌        | `development` \| `production`                          |
| `SUPABASE_URL`             | ✅        | Same Supabase URL                                      |
| `SUPABASE_PUBLISHABLE_KEY` | ✅        | Same publishable key (paired with user bearer for RLS) |
| `CORS_ORIGINS`             | ✅ (prod) | Comma-separated allowed origins                        |

---

## 🗄 Database Schema

```sql
create type lead_status as enum ('New','Contacted','Qualified','Converted','Lost');

create table public.leads (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  name         text not null,
  email        text not null,
  phone        text,
  company_name text,
  lead_status  lead_status not null default 'New',
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

alter table public.leads enable row level security;

-- Each user can only see/manage their own leads
create policy "Users manage own leads" on public.leads
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
```

An `update_updated_at_column()` trigger keeps `updated_at` fresh.

---

## 📡 API Documentation

Base URL: `${VITE_API_URL}` (Express) or same-origin `""` (TanStack server routes).
All endpoints require `Authorization: Bearer <supabase_access_token>`.
All responses use the envelope `{ "success": boolean, "data"?: ..., "error"?: string }`.

| Method | Path                      | Body / Query         | Returns        |
| ------ | ------------------------- | -------------------- | -------------- |
| GET    | `/api/leads`              | —                    | `Lead[]`       |
| POST   | `/api/leads`              | `LeadInput`          | `Lead` (201)   |
| PUT    | `/api/leads/:id`          | `Partial<LeadInput>` | `Lead`         |
| DELETE | `/api/leads/:id`          | —                    | `{ ok: true }` |
| GET    | `/api/leads/search?q=...` | `q` (string)         | `Lead[]`       |
| GET    | `/api/leads/stats`        | —                    | `LeadStats`    |

```ts
type LeadStatus = "New" | "Contacted" | "Qualified" | "Converted" | "Lost";

interface LeadInput {
  name: string; // 1–120 chars
  email: string; // valid email
  team_id?: string | null;
  operator_id?: string | null;
  offer_id?: string | null;
  phone?: string;
  company_name?: string;
  lead_status: LeadStatus;
  notes?: string; // max 2000 chars
}

interface LeadStats {
  total: number;
  byStatus: Record<LeadStatus, number>;
  weeklyTrend: { date: string; count: number }[]; // last 14 days
}
```

---

## 🚀 Local Setup

### 1. Prerequisites

- Node.js ≥ 18, npm or bun
- A Supabase project (free tier is fine)

### 2. Frontend

```bash
git clone <your-repo>
cd <repo>
bun install            # or npm install
cp .env.example .env   # fill in Supabase keys
bun run dev            # http://localhost:8080
```

The SQL files in `supabase/migrations/` provision the schema and RLS policies.
Review pending migrations before applying them manually with the Supabase CLI:

```bash
supabase link --project-ref <YOUR_PROJECT_REF>
supabase db push
```

### 3. Standalone Express backend (optional)

```bash
cd server
cp .env.example .env   # fill in Supabase URL + publishable key
npm install
npm run dev            # http://localhost:4000
```

Then point the frontend at it:

```
# .env (frontend)
VITE_API_URL=http://localhost:4000
```

Restart the frontend — that's the only change required.

---

## ☁️ Deployment

This project supports two paths. Pick one:

### Path A — All-in-one (Vercel)

1. Push to GitHub.
2. On Vercel: **Import Project** → framework auto-detected (TanStack Start).
3. Under **Project Settings > Build & Development Settings**:
   - Ensure the **Output Directory** is left blank/default (do NOT set it to `dist`).
4. Add env vars: `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_PROJECT_ID`. **Leave `VITE_API_URL` unset** — the app uses its built-in server routes.
5. Deploy.

### Path B — Frontend on Vercel + API on Render

**Backend (Render)**

1. Push to GitHub.
2. On Render: **New → Blueprint** and select the repo. It will detect `server/render.yaml`.
3. Set environment variables when prompted:
   - `SUPABASE_URL`
   - `SUPABASE_PUBLISHABLE_KEY`
   - `CORS_ORIGINS` → your frontend origin(s), e.g. `https://your-app.vercel.app`
4. Wait for the build (`npm install && npm run build`) and note the URL, e.g. `https://lumen-crm-api.onrender.com`.

**Frontend (Vercel)**

1. Same steps as Path A, but **also** set `VITE_API_URL` to the Render URL.
2. Redeploy.

**Supabase**

- Apply migrations: `supabase db push` (or paste the SQL from `supabase/migrations/`).
- In **Authentication → Providers**, ensure Email is enabled. The migration assumes the default `auth.users` table.

---

## 🧪 Smoke Test Checklist

- ✅ Open a valid workspace invitation and create or sign in to the invited account
- ✅ Confirm the invited email before accepting workspace access
- ✅ A public account without an invitation receives no workspace membership
- ✅ Sign in / sign out
- ✅ Create a lead via "Add lead"
- ✅ Edit a lead (status, notes, contact)
- ✅ Delete a lead (confirmation modal)
- ✅ Search updates as you type (debounced 250 ms)
- ✅ Filter by status
- ✅ Pagination (10 per page)
- ✅ Status change persists via inline update
- ✅ Dashboard stat cards reflect current totals
- ✅ Donut + area charts render with real data
- ✅ CSV export downloads filtered rows
- ✅ Mobile layout: sidebar collapses, tables scroll, modals fit viewport

## Багатокористувацький MVP

Міграція `supabase/migrations/20261022090000_workspace_access_foundation.sql`
створює одну робочу область `main`, таблиці членств/команд/оферів/дозволів,
журнал доступу, запрошення та RLS-політики. Вона переносить наявні ліди до
`main`, зберігає їхні ID та поля, а попередній `user_id` записує як
`operator_id`. Облікові записи не видаляються. Міграція не створює членств і не
призначає Super Admin.

### Порядок запуску

1. До міграції знайдіть і незалежно звірте UUID, email та підтвердження email
   поточного акаунта. Якщо UUID невідомий або `email_confirmed_at` дорівнює
   `NULL`, зупиніться: не застосовуйте міграцію, доки не підтвердите правильний
   наявний акаунт.

   ```sql
   SELECT id, email, email_confirmed_at
   FROM auth.users
   WHERE lower(email) = lower('ВАША_ПОШТА');
   ```

2. Зробіть резервну копію БД і перевірте чинні RLS-політики до будь-яких змін:

   ```sql
   SELECT count(*) AS leads_before_migration FROM public.leads;

   SELECT policyname, cmd, roles, qual, with_check
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'leads'
   ORDER BY policyname;
   ```

   Очікується лише `Users manage own leads`. Якщо є інша політика, зупиніться й
   перегляньте її вручну: міграція навмисно переривається, щоб невідома
   permissive policy не розширила доступ через об'єднання правил через `OR`.

3. Перевірте історію міграцій (`supabase link --project-ref <PROJECT_REF>`, потім
   `supabase migration list --linked`) і переконайтеся, що файл
   `20261022090000_workspace_access_foundation.sql` є очікуваною наступною
   міграцією. Перегляньте його diff і виконайте `supabase db push` вручну.
   CRM не запускає міграції автоматично. Виконайте це у вікно технічного
   обслуговування: до завершення bootstrap чинні акаунти без членства не матимуть
   доступу до workspace. Тримайте SQL Editor під довіреним власником БД відкритим
   і запускайте bootstrap одразу після контрольних запитів.
4. Після міграції окремо перевірте чотири політики `leads_read_authorized`,
   `leads_insert_authorized`, `leads_update_authorized` і
   `leads_delete_authorized`, а також відсутність інших політик для `public.leads`:

   ```sql
   SELECT policyname, cmd, roles, qual, with_check
   FROM pg_catalog.pg_policies
   WHERE schemaname = 'public' AND tablename = 'leads'
   ORDER BY policyname;

   SELECT has_function_privilege(
     'anon', 'lumen_private.bootstrap_first_super_admin(uuid,text)', 'EXECUTE'
   ) AS anon_can_bootstrap,
   has_function_privilege(
     'authenticated', 'lumen_private.bootstrap_first_super_admin(uuid,text)', 'EXECUTE'
   ) AS user_can_bootstrap;
   ```

   Обидва значення доступу мають бути `false`. Також перевірте, що створено один
   workspace зі slug `main` і що кількість лідів збігається з контрольним
   значенням до міграції:

   ```sql
   SELECT id, slug FROM public.workspaces WHERE slug = 'main';
   SELECT count(*) AS leads_after_migration FROM public.leads;
   ```

5. Відкрийте `supabase/operations/bootstrap-first-super-admin.sql`, підставте
   перевірені UUID та email і запустіть окремо в Supabase SQL Editor під
   довіреним власником БД. Приватна SQL-функція ще раз звіряє UUID, email і
   підтвердження email, а транзакційне блокування не дає двом паралельним
   bootstrap-запускам створити різні перші акаунти. Повторний bootstrap
   відхиляється. Публічного endpoint або RPC для самопризначення Super Admin немає.
6. Після виконання перевірте призначення окремими запитами:

   ```sql
   SELECT user_id, role FROM public.system_admins
   WHERE user_id = 'ПЕРЕВІРЕНИЙ_UUID';

   SELECT workspace_id, user_id, role, status
   FROM public.workspace_memberships
   WHERE user_id = 'ПЕРЕВІРЕНИЙ_UUID'
     AND workspace_id = public.main_workspace_id();

   SELECT public.is_super_admin('ПЕРЕВІРЕНИЙ_UUID');
   ```

   Очікується рівно один рядок Super Admin, активне членство `admin` у `main`
   та `true`. Далі увійдіть саме цим акаунтом і перевірте `GET /api/workspaces`
   через його bearer-токен. Якщо bootstrap транзакція перервалася, виправте
   вхідні UUID/email і запустіть той самий скрипт повторно.

7. Для відновлення доступу довірений власник БД може запустити
   `supabase/operations/recover-super-admin-access.sql` після повторної
   незалежної перевірки UUID/email. Скрипт додає перевірений акаунт Super Admin
   та відновлює активне членство в `main`, але не видаляє наявних адміністраторів.
   Якщо помилково призначено інший акаунт, спершу відновіть доступ правильному
   акаунту, перевірте вхід і лише потім окремо виправте неправильний запис під
   контролем власника БД.
8. Для TanStack Start задай серверні змінні середовища з `.env.example`:
   `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` та `APP_BASE_URL`. Щоб сервер
   надсилав листи-запрошення, додай `SUPABASE_SERVICE_ROLE_KEY` у середовище
   сервера. Цей ключ застосовується лише в серверному обробнику запрошень;
   не додавай префікс `VITE_`, не зберігай ключ у браузері та не коміть його.
   У production `APP_BASE_URL` обов'язковий і має бути HTTPS origin; локальний
   HTTP дозволений лише для loopback. Додай `${APP_BASE_URL}/auth` до дозволених
   redirect URL у Supabase Auth. Запрошення передаються лише через серверні
   обробники, мають `Referrer-Policy: no-referrer` і вилучають токен з URL після
   успішного прийняття.
9. Запусти застосунок звичайною командою `bun run dev`. Отримай ID основного
   workspace через `GET /api/workspaces`, використовуючи свій bearer-токен.
10. Створи запрошення:

```http
POST /api/workspaces/<WORKSPACE_ID>/invitations
Authorization: Bearer <SUPABASE_ACCESS_TOKEN>
Content-Type: application/json

{"email":"operator@example.com","role":"operator"}
```

Відповідь містить `inviteUrl`. Якщо `emailSent` дорівнює `false`, передай
це посилання запрошеному вручну. Новий користувач створює акаунт лише через
чинне посилання; членство додається після підтвердження тієї самої адреси.
Існуючий користувач входить у свій акаунт через посилання. Запрошення чинне
сім днів. Публічна реєстрація не додає обліковий запис до workspace.

### SQL-перевірки

`supabase/tests/workspace-access.sql` перевіряє bootstrap, повторний запуск,
відновлення доступу, права ролей, workspace/team/operator/offer scopes,
між-workspace ізоляцію, прямі RPC-виклики, відмови RLS і старі/нові значення
журналу аудиту. Запускайте його тільки у disposable local Supabase/PostgreSQL
після міграцій. Для збереження вже наявного ліда є пара
`supabase/tests/prepare-lead-preservation.sql` та
`supabase/tests/assert-lead-preservation.sql`: перший скрипт запускається перед
цільовою міграцією, другий — після неї. Не запускайте fixture-скрипти на
віддаленій або робочій базі.

### Ролі та дозволи

- `Super Admin` має повний системний доступ. Його призначення виконується лише
  ручною процедурою з UUID; публічна реєстрація не надає цю роль.
- `Admin` за замовчуванням може переглядати workspace і список членів. Запрошення,
  зміна ролей та інші підвищені дії потребують окремих дозволів.
- `permissions.manage` дає Admin право керувати індивідуальними overrides, але
  саме по собі не дозволяє видати будь-який дозвіл. Для кожного конкретного
  дозволу потрібен окремий дозвіл Super Admin з `delegable: true`; Super Admin
  deny має найвищий пріоритет і Admin не може змінити, скасувати чи обійти його.
- `Operator` може переглядати, створювати й оновлювати ліди, призначені йому.
- Призначення ліда іншому оператору, команді чи оферу проходить окремі дозволи
  `leads.assign`, `leads.assign_team` та `leads.assign_offer`; самі поля не надають
  доступу до відповідних лідів.
- `Viewer` може переглядати лише дозволені йому ліди.
- Адміністратор може надати дозвіл іншому члену лише тоді, коли Super Admin
  видав йому такий дозвіл із `delegable: true`. Admin не може змінювати власну
  роль чи дозволи, а самостійно ставити `delegable: true` може лише Super Admin.
- Дозволи до лідів мають область `workspace`, `team`, `operator` або `offer`.
  Умови виконуються серверними SQL-функціями та RLS, включно із запитами через
  Express API.

Основні серверні операції:

| Операція                      | Метод і шлях                                                                                                    |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Перелік доступних workspace   | `GET /api/workspaces`                                                                                           |
| Члени                         | `GET /api/workspaces/:workspaceId/members`                                                                      |
| Зміна ролі                    | `PATCH /api/workspaces/:workspaceId/members/:userId` з `{"role":"viewer"}`                                      |
| Дозволи члена                 | `GET /api/workspaces/:workspaceId/permissions?user_id=<UUID>`                                                   |
| Надати/відкликати дозвіл      | `POST /api/workspaces/:workspaceId/permissions`                                                                 |
| Перелік/створення команд      | `GET` / `POST /api/workspaces/:workspaceId/teams`                                                               |
| Перелік/створення оферів      | `GET` / `POST /api/workspaces/:workspaceId/offers`                                                              |
| Перелік/відкликання запрошень | `GET /api/workspaces/:workspaceId/invitations`, `DELETE /api/workspaces/:workspaceId/invitations/:invitationId` |
| Журнал доступу                | `GET /api/workspaces/:workspaceId/audit?limit=100`                                                              |

Приклад тіла запиту для дозволу:

```json
{
  "userId": "<MEMBER_UUID>",
  "permission": "leads.read",
  "allowed": true,
  "scopeType": "team",
  "scopeId": "<TEAM_UUID>",
  "delegable": false
}
```

Для відкликання конкретного override передай `"allowed": null`. Super Admin
може встановлювати `delegable: true`; Admin — ні. Перевірки виконуються в
PostgreSQL навіть якщо клієнт напряму викличе RPC або PostgREST.

---

## 🧭 Switching backends

| Want…                          | Set                                 |
| ------------------------------ | ----------------------------------- |
| Single-deploy on Vercel        | `VITE_API_URL` unset                |
| External Express API on Render | `VITE_API_URL=https://<render-url>` |

No code change, no rebuild logic — the frontend's HTTP client (`src/services/api.ts`) reads `VITE_API_URL` at build time and falls back to same-origin when absent.

---

## 📄 License

MIT — Lumen CRM.
