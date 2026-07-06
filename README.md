# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and Oxlint's TypeScript related rules in your project.

## Database (prod / dev)

The app runs against two independent Supabase projects:

- **dev** — `TheGuysCRM-dev` (`atgoyrojmwxmntonbmpd`). Used by `npm run dev` via `.env`.
- **prod** — `TheGuysCRM` (`iezgyetfwgmlczcrnrvx`). Used by Netlify (env vars set in the Netlify UI).

Both hold the same data. `.env` (local, gitignored) points at dev; production credentials live only in Netlify.

### Schema changes flow through CLI migrations

Schema is managed with the Supabase CLI (installed as a devDependency — run via `npx supabase`). The current schema lives in `supabase/migrations/`; `supabase/legacy/` holds the pre-CLI hand-written SQL, kept for reference only.

To make a schema change:

1. `npx supabase migration new <name>` and write the SQL.
2. `npx supabase link --project-ref atgoyrojmwxmntonbmpd` then `npx supabase db push` — apply to **dev**, test.
3. `npx supabase link --project-ref iezgyetfwgmlczcrnrvx` then `npx supabase db push` — apply to **prod**.

> `db push` runs against the remote directly and needs no Docker. `db pull` / `db dump` (schema/data snapshots) do require Docker Desktop running.
