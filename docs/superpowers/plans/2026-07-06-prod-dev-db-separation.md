# Prod/Dev Database Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split BaseCRM's single Supabase project into two independent cloud projects — prod (existing) and dev (new) — each holding the full schema and data, with the Supabase CLI migration workflow adopted for future changes.

**Architecture:** Keep `TheGuysCRM` (`iezgyetfwgmlczcrnrvx`) as prod (Netlify unchanged). Baseline its live schema into a CLI migration, create a new `TheGuysCRM-dev` project, push the baseline schema, then copy `auth.users` + `public` data into dev. Local `.env` points at dev; Netlify keeps prod.

**Tech Stack:** Supabase CLI (`npx supabase`, installed as a devDependency), Supabase MCP server (project ops + SQL), Vite env files, git.

## Global Constraints

- Org: `TheGuys` = `lnyoznifozabylwjjfts`. Second project cost: **$0/month** (confirmed).
- prod project ref: `iezgyetfwgmlczcrnrvx`, region `eu-west-1`, Postgres 17.
- dev project: name `TheGuysCRM-dev`, region `eu-west-1`.
- CLI installed as devDependency only — **no global install, no Docker**.
- Secrets are never committed. `.env` and `.claude/` are gitignored; `.mcp.json` is untracked.
- Baseline schema comes from prod's **live** schema via `db pull`, not the repo's `schema.sql`.
- Data copy order: `auth.users` **before** `public` (FK `public.profiles.id → auth.users.id`).
- Expected prod table row counts (parity check target): profiles 5, organizations 4, memberships 3, invitations 3, workspaces 8, boards 18, columns 121, groups 54, items 830, client_statuses 17, client_fields 10, clients 9, contacts 1, lead_sources 2, leads 3; auth.users 5.
- **Execution owner** is marked per task: `[AGENT/MCP]` = Claude runs via MCP tools; `[USER/CLI]` = the human runs an interactive `npx supabase` command (DB-password / login prompts cannot run in the non-interactive agent session) and pastes output back.

---

### Task 1: Install & authenticate the Supabase CLI  `[USER/CLI]`

**Files:**
- Modify: `package.json` (adds `supabase` to `devDependencies`)
- Modify: `package-lock.json`

**Interfaces:**
- Produces: a working `npx supabase` authenticated against the `TheGuys` org.

- [ ] **Step 1: Install the CLI as a dev dependency**

Run:
```bash
npm install supabase --save-dev
```
Expected: `package.json` gains `"supabase"` under `devDependencies`; no errors.

- [ ] **Step 2: Authenticate the CLI**

Run:
```bash
npx supabase login
```
Follow the browser prompt. Expected: `Finished supabase login.`

- [ ] **Step 3: Verify the CLI sees the org and prod project**

Run:
```bash
npx supabase projects list
```
Expected: a table listing `TheGuysCRM` with ref `iezgyetfwgmlczcrnrvx` under org `TheGuys`.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add supabase CLI as dev dependency"
```

---

### Task 2: Initialize the CLI project and link to prod  `[USER/CLI]`

**Files:**
- Create: `supabase/config.toml`
- Create: `supabase/migrations/` (empty dir)
- Modify: `.gitignore` (if `supabase init` adds ignore entries — keep them)

**Interfaces:**
- Consumes: authenticated CLI from Task 1.
- Produces: a linked local Supabase project directory.

- [ ] **Step 1: Initialize (keep existing SQL files in place for now)**

Run:
```bash
npx supabase init
```
If prompted about VS Code / Deno settings, answer `n`. Expected: creates `supabase/config.toml` and `supabase/migrations/`. Existing `supabase/*.sql` files are untouched.

- [ ] **Step 2: Link to the prod project**

Run:
```bash
npx supabase link --project-ref iezgyetfwgmlczcrnrvx
```
Paste the prod DB password when prompted (Supabase dashboard → Project Settings → Database → Connection string / password). Expected: `Finished supabase link.`

- [ ] **Step 3: Verify link**

Run:
```bash
npx supabase migration list
```
Expected: a table with **no local migrations and no remote migrations** (both sides empty — confirms the ad-hoc history and that we are baselining from scratch).

- [ ] **Step 4: Commit**

```bash
git add supabase/config.toml .gitignore
git commit -m "chore: initialize supabase CLI and link prod"
```

---

### Task 3: Baseline the prod schema into a migration  `[USER/CLI]`

**Files:**
- Create: `supabase/migrations/<timestamp>_baseline.sql`

**Interfaces:**
- Consumes: linked project from Task 2.
- Produces: the baseline schema migration — the new source of truth for schema.

- [ ] **Step 1: Dump the live prod schema (public only)**

> **Note (Docker):** `db pull` reported "No schema changes found" against the empty
> migration history, and both `db pull`/`db dump` require **Docker Desktop running**.
> With Docker started, use `db dump` (a straight pg_dump — no diff) instead of `db pull`.

Run:
```bash
npx supabase db dump -f supabase/baseline.sql
```
Expected: `Dumped schema to ...supabase/baseline.sql`. `db dump` emits **public** only (managed `auth`/`storage` schemas are excluded), so the push to dev won't hit "already exists". `auth.users` **data** is copied in Task 6; the `logos` storage bucket + policy are recreated in Task 6.

- [ ] **Step 1b: Turn the dump into a timestamped migration (AGENT)**

`mkdir -p supabase/migrations` and move the dump to
`supabase/migrations/<YYYYMMDDHHMMSS>_baseline.sql`. Verify it contains 15 tables,
10 functions, 46 policies, 2 enums, 2 public triggers.

- [ ] **Step 1c: Mark the baseline as already-applied on prod (USER/CLI)**

Run (linked to prod):
```bash
npx supabase migration repair --status applied <timestamp>
```
Expected: `Repaired migration history: [<timestamp>] => applied`. This stops a future
`db push` to prod from re-running the baseline (which would fail on existing policies).

**Known gap:** the `on_auth_user_created` trigger lives on `auth.users` (auth schema)
and is NOT in the public dump. Recreate it on dev in Task 5 so new signups auto-create
profiles.

- [ ] **Step 2: Verify the baseline contains the core tables**

Run:
```bash
grep -c "create table" supabase/migrations/*_baseline.sql
```
Expected: a count ≥ 15 (the 15 public tables; storage/auth add a few more).

- [ ] **Step 3: Sanity-check key objects are present**

Run:
```bash
grep -E "create table.*(profiles|organizations|items|leads|clients)" supabase/migrations/*_baseline.sql
```
Expected: matches for each of `profiles`, `organizations`, `items`, `leads`, `clients`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/
git commit -m "feat: baseline prod schema as first migration"
```

---

### Task 4: Create the dev project  `[AGENT/MCP]`

**Files:** none (cloud resource + a note recorded for later steps).

**Interfaces:**
- Produces: `dev` project ref + anon (publishable) key + DB password, recorded for Tasks 5–7.

- [ ] **Step 1: Re-confirm cost**

MCP `get_cost` with `type: project`, `organization_id: lnyoznifozabylwjjfts`.
Expected: `amount: 0`, `recurrence: monthly`. Report the cost to the user and get a go-ahead (required by the tool contract).

- [ ] **Step 2: Create the project**

MCP `create_project` with `name: TheGuysCRM-dev`, `organization_id: lnyoznifozabylwjjfts`, `region: eu-west-1`, `confirm_cost_id` from Step 1.
Expected: returns a new project `id`/`ref` with status provisioning.

- [ ] **Step 3: Wait for healthy status**

MCP `list_projects` (poll).
Expected: `TheGuysCRM-dev` shows `status: ACTIVE_HEALTHY`. Record its `ref`.

- [ ] **Step 4: Record dev keys**

MCP `get_project_url` and `get_publishable_keys` for the dev ref.
Expected: dev URL `https://<devref>.supabase.co` and anon/publishable key — held for Task 7. (No commit; nothing in the repo yet.)

---

### Task 5: Push the baseline schema to dev  `[USER/CLI]`

**Files:** none (applies migration to the dev database).

**Interfaces:**
- Consumes: baseline migration (Task 3), dev ref (Task 4).
- Produces: dev database with the full schema and empty tables.

- [ ] **Step 1: Link to dev**

Run (replace `<devref>` with the ref from Task 4):
```bash
npx supabase link --project-ref <devref>
```
Paste the dev DB password when prompted.

- [ ] **Step 2: Push the baseline migration**

Run:
```bash
npx supabase db push
```
Expected: applies `<timestamp>_baseline.sql`; prints `Finished supabase db push.` with no errors. If it fails on a missing extension, note the extension name and report back before continuing.

- [ ] **Step 3: Verify schema landed (AGENT/MCP)**

MCP `list_tables` on the dev ref, schema `public`.
Expected: the same 15 tables, every one `rls_enabled: true`, all with `rows: 0`.

---

### Task 6: Copy data (auth.users, then public) prod → dev  `[AGENT/MCP]`

**Files:** none (data-only copy between databases).

**Interfaces:**
- Consumes: prod ref (`iezgyetfwgmlczcrnrvx`), dev ref (Task 4), schema on dev (Task 5).
- Produces: dev tables populated to match prod row counts.

- [ ] **Step 1: Copy auth.users first (FK parent)**

For the 5 rows: MCP `execute_sql` on prod → `SELECT * FROM auth.users;` (returns JSON). Then MCP `execute_sql` on dev inserting those rows into `auth.users` (preserve `id`, `email`, `encrypted_password`, `raw_app_meta_data`, `raw_user_meta_data`, `created_at`, and the identity columns). Also copy `auth.identities` for those users so email login resolves.
Verify: MCP `execute_sql` on dev → `SELECT count(*) FROM auth.users;` Expected: `5`.

- [ ] **Step 2: Copy public tables in FK-safe order**

Copy each table prod → dev with `execute_sql` (SELECT on prod, INSERT on dev), in this order so foreign keys resolve:
`profiles → organizations → memberships → invitations → workspaces → boards → columns → groups → items → client_statuses → client_fields → clients → contacts → lead_sources → leads`.

- [ ] **Step 2b: Recreate the `logos` storage bucket + policy**

MCP `execute_sql` on prod → read the `logos` row from `storage.buckets` and its policies on `storage.objects` (`logos_read`). Recreate them on dev via `execute_sql` (insert the bucket row + create the policy). Objects/files themselves are not copied (non-goal).
Verify: MCP `execute_sql` on dev → `SELECT id, public FROM storage.buckets WHERE id='logos';` Expected: one row.

- [ ] **Step 3: Verify row-count parity (AGENT/MCP)**

MCP `execute_sql` on dev:
```sql
select 'items' t, count(*) from items
union all select 'columns', count(*) from columns
union all select 'groups', count(*) from groups
union all select 'workspaces', count(*) from workspaces
union all select 'clients', count(*) from clients;
```
Expected: items 830, columns 121, groups 54, workspaces 8, clients 9 (matching the Global Constraints counts).

- [ ] **Step 4: Run the security advisor on dev (AGENT/MCP)**

MCP `get_advisors` on dev, `type: security`.
Expected: the same warning classes as prod (SECURITY DEFINER RPCs, `logos` bucket listing, leaked-password protection) — confirms schema+policy fidelity. No new ERROR-level lints.

---

### Task 7: Point local dev at the dev project  `[AGENT + USER]`

**Files:**
- Modify: `.env` (local, gitignored) — dev URL + anon key
- Modify: `.env.example` — document the prod/dev split

**Interfaces:**
- Consumes: dev URL + anon key (Task 4).
- Produces: `npm run dev` reads/writes the dev database.

- [ ] **Step 1: Update `.env` to dev (AGENT)**

Set:
```
VITE_SUPABASE_URL=https://<devref>.supabase.co
VITE_SUPABASE_ANON_KEY=<dev anon/publishable key>
```

- [ ] **Step 2: Update `.env.example` (AGENT)**

Rewrite it to document the split:
```
# Local development points at the DEV Supabase project.
# Production (Netlify) sets these vars to the PROD project in the Netlify UI.
# DEV project:  TheGuysCRM-dev
# PROD project: TheGuysCRM (iezgyetfwgmlczcrnrvx)
VITE_SUPABASE_URL=https://xxxxx.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOi...
```

- [ ] **Step 3: Verify local app hits dev (USER + AGENT via preview)**

Start the dev server and confirm it connects to the dev project (a read returns the copied data, and the network request targets `<devref>.supabase.co`, not `iezgyetfwgmlczcrnrvx`).
Expected: app loads with the demo data; requests go to the dev host.

- [ ] **Step 4: Commit**

```bash
git add .env.example
git commit -m "chore: document prod/dev env split; local points at dev"
```
(`.env` itself is gitignored and not committed.)

---

### Task 8: Archive legacy SQL and document the workflow  `[AGENT/MCP]`

**Files:**
- Move: `supabase/{schema.sql,fix_invitations_rpc.sql,run_me_pending.sql,setup_org_tonika.sql,migration_002_*.sql … migration_010_*.sql}` → `supabase/legacy/`
- Modify: `README.md` (add DB workflow section)

**Interfaces:**
- Consumes: baseline migration is now source of truth (Task 3).
- Produces: a clean `supabase/` where `migrations/` is authoritative and old SQL is archived.

- [ ] **Step 1: Archive the legacy SQL**

Run:
```bash
mkdir -p supabase/legacy
git mv supabase/schema.sql supabase/fix_invitations_rpc.sql supabase/run_me_pending.sql supabase/setup_org_tonika.sql supabase/legacy/
git mv supabase/migration_0*.sql supabase/legacy/
```
Expected: `supabase/` now contains `config.toml`, `migrations/`, and `legacy/`.

- [ ] **Step 2: Document the ongoing workflow in README**

Add a `## Database (prod/dev)` section:
```markdown
## Database (prod/dev)

- **dev** = Supabase project `TheGuysCRM-dev` — used by `npm run dev` via `.env`.
- **prod** = Supabase project `TheGuysCRM` (`iezgyetfwgmlczcrnrvx`) — used by Netlify.

Schema changes flow through CLI migrations:

1. `npx supabase migration new <name>` and write the SQL.
2. `npx supabase link --project-ref <devref>` then `npx supabase db push` — apply to dev, test.
3. `npx supabase link --project-ref iezgyetfwgmlczcrnrvx` then `npx supabase db push` — apply to prod.

`supabase/legacy/` holds the pre-CLI hand-written SQL, kept for reference only.
```

- [ ] **Step 3: Verify no stray SQL left at supabase root**

Run:
```bash
ls supabase/*.sql 2>/dev/null || echo "clean"
```
Expected: `clean` (all loose SQL moved into `legacy/`).

- [ ] **Step 4: Commit**

```bash
git add supabase/ README.md
git commit -m "chore: archive legacy SQL; document prod/dev migration workflow"
```

---

## Self-Review

**Spec coverage:**
- Two projects, both with data → Tasks 4–6. ✓
- Local→dev, Netlify→prod → Task 7 (+ prod untouched throughout). ✓
- CLI migration workflow adopted → Tasks 1–3, 5, 8. ✓
- Decision A (copy auth.users) → Task 6 Step 1. ✓
- Decision B (archive legacy SQL) → Task 8 Step 1. ✓
- Verification (row counts, RLS, auth count, advisor, local hits dev) → Tasks 5–7. ✓
- Risk: auth-before-public load order → Task 6 order + Global Constraints. ✓
- Risk: DB-password prompts → marked on Tasks 2, 3, 5. ✓
- Non-goal: storage objects not copied → left out intentionally (schema/policy only). ✓

**Placeholder scan:** `<devref>`, `<timestamp>`, `<name>`, `<dev anon key>` are runtime values discovered during execution (project ref assigned on create, migration timestamp generated by the CLI), not unfilled plan gaps. All commands and expected outputs are concrete.

**Type/name consistency:** project refs, table names, and row counts match the spec and the Global Constraints block across all tasks.
