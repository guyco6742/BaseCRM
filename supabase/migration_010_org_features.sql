-- ============================================================================
-- Migration 010 — דגלי תכונות (feature flags) פר-ארגון
-- מאפשר לסופר-אדמין להפעיל/לכבות עמודים אופציונליים לארגון ספציפי,
-- למשל עמוד "שליחת חוזה". להריץ ב-Supabase → SQL Editor.
-- ============================================================================

alter table public.organizations
  add column if not exists features jsonb not null default '{}'::jsonb;

comment on column public.organizations.features is
  'מפת תכונות אופציונליות מופעלות לארגון, למשל {"send_contract": true}. נשלט ע"י סופר-אדמין בלבד (מדיניות orgs_update הקיימת).';

-- אין צורך בשינוי RLS — עדכון organizations כבר מוגבל לסופר-אדמין בלבד
-- דרך המדיניות orgs_update הקיימת ב-schema.sql.
