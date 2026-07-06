# Prod/Dev Database Separation — Design

**Date:** 2026-07-06
**Status:** Approved (design)

## Problem

BaseCRM runs against a **single** Supabase cloud project (`TheGuysCRM`, ref
`iezgyetfwgmlczcrnrvx`). Both local development (`npm run dev` → `.env`) and
production (Netlify) point at the same database. There is no separation: local
experiments touch production data, and there is no safe place to develop schema
changes.

All current data is test data, and the app is pre-launch. We want a full
separation between a **production** environment and a **local/dev** environment,
with **both environments containing the same data** (needed to demo that data
exists and to show its flow).

## Goals

- Two independent Supabase cloud projects — `prod` and `dev` — each with a full
  copy of the current schema **and** data.
- Local dev (`localhost:5173`) always talks to `dev`; Netlify always talks to
  `prod`.
- Adopt the Supabase CLI migration workflow so future schema changes flow to
  both environments via `db push` instead of hand-pasting SQL into two
  dashboards.

## Non-Goals

- A clean/empty production database (explicitly rejected — both envs must hold
  data for the demo).
- Local Supabase via Docker (rejected — `dev` is a second cloud project).
- Copying Storage bucket **objects** (the `logos` bucket files). Bucket schema
  and policies come across via the schema dump; the binary objects do not, and
  that is acceptable for now.

## Environments

| Environment | Supabase project | Ref | Consumed by |
|-------------|------------------|-----|-------------|
| **prod** | `TheGuysCRM` (existing) | `iezgyetfwgmlczcrnrvx` | Netlify (unchanged) |
| **dev** | `TheGuysCRM-dev` (new) | _assigned on create_ | `localhost:5173` via `.env` |

- Organization: `TheGuys` (`lnyoznifozabylwjjfts`).
- New project region: `eu-west-1` (matches prod).
- Cost of second project: **$0/month** (org free-tier confirmed via `get_cost`).

## Approach — Supabase CLI

Chosen over a one-time `pg_dump`/`pg_restore` because the durable pain is
maintaining two databases over time, not the initial copy. The CLI turns future
changes into a single `db push`; the initial clone is a side effect.

### Tooling

- Install the Supabase CLI as a **dev dependency**: `npm i supabase --save-dev`.
  Invoked as `npx supabase ...`. No global install, no Docker. Windows-friendly.

### Phase 1 — Initialize + baseline the schema

The current project has **no** CLI migration history (`list_migrations` returns
`[]`); the schema was applied ad-hoc through the SQL editor. We capture the live
schema as a single baseline migration.

1. `npx supabase init` → creates `supabase/config.toml` and `supabase/migrations/`.
2. `npx supabase link` → link to prod (`iezgyetfwgmlczcrnrvx`).
3. `npx supabase db pull` → generate `supabase/migrations/<ts>_baseline.sql` from
   the live prod schema. **From this point the baseline migration is the source
   of truth for schema**, not the hand-written `.sql` files.

### Phase 2 — Create dev + duplicate schema and data

4. Create the `TheGuysCRM-dev` project (via MCP `create_project`; cost already
   confirmed $0).
5. `npx supabase db push` against dev → applies the baseline schema.
6. Copy data prod → dev:
   - `npx supabase db dump --data-only` for the `public` schema.
   - **Also dump `auth.users`** so the 5 existing auth users come across and
     login works in dev (decision A).
   - Load both dumps into dev.

### Phase 3 — Wire environment config

7. `.env` (local, gitignored) → **dev** project URL + anon key. `npm run dev`
   therefore always hits dev.
8. Netlify environment variables → **prod** URL + anon key (already set; not
   touched).
9. Update `.env.example` to document the prod/dev split and where each set of
   keys goes.

### Phase 4 — Archive legacy SQL + document workflow

10. Move the existing hand-written SQL (`schema.sql`, `migration_002…010`,
    `fix_invitations_rpc.sql`, `run_me_pending.sql`, `setup_org_tonika.sql`) into
    `supabase/legacy/` — archived, not deleted (decision B).
11. Document the ongoing workflow (README): schema change →
    `npx supabase migration new <name>` → write SQL → `db push` to dev → verify →
    `db push` to prod.

## Decisions

- **A. Auth users:** copy `auth.users` from prod into dev so dev login works and
  the real flow can be demoed.
- **B. Legacy SQL files:** move to `supabase/legacy/` as an archive once the
  baseline migration is the source of truth.

## Data Flow

```
Developer machine                    Supabase Cloud (org: TheGuys)
-----------------                    -----------------------------
npm run dev (localhost:5173) --.env--> TheGuysCRM-dev   (dev,  data ✓)
                                            ^
                                            | baseline schema push
                                            | data-only + auth.users dump
                                            |
Netlify build ----------env vars------> TheGuysCRM       (prod, data ✓)
                                            ^
                                            └ baseline pulled from here
```

## Risks / Edge Cases

- **DB password prompts:** `link` / `db pull` / `db dump` connect directly to the
  database and will prompt for each project's DB password (available in the
  Supabase dashboard). Not stored in the repo.
- **auth.users FK integrity:** `public.profiles` references `auth.users`. Load
  `auth.users` **before** the `public` data-only dump so foreign keys resolve.
- **Extensions / roles:** the baseline pull should include required extensions;
  verify `db push` to dev succeeds without missing-extension errors before
  loading data.
- **Storage objects:** the `logos` bucket policy/schema transfers, but existing
  files do not. Re-upload if a demo needs a specific logo.
- **`schema.sql` drift:** we rely on `db pull` (live schema), not the repo's
  `schema.sql`, to avoid drift between the file and the actual database.

## Verification

- `npx supabase db push` against dev completes with no errors.
- `list_tables` on dev returns the same 15 tables, all `rls_enabled: true`.
- Row counts on dev match prod for the key tables (`items` 830, `columns` 121,
  `groups` 54, etc.).
- `auth.users` count on dev = 5; a known test user can log in against dev.
- `npm run dev` locally reads/writes dev (confirm a write in dev appears in the
  dev project, not prod).
- Netlify build still points at prod (unchanged env vars).
