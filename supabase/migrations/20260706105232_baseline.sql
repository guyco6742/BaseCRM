


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE TYPE "public"."invite_status" AS ENUM (
    'pending',
    'accepted'
);


ALTER TYPE "public"."invite_status" OWNER TO "postgres";


CREATE TYPE "public"."member_role" AS ENUM (
    'admin',
    'member'
);


ALTER TYPE "public"."member_role" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_invitation_by_token"("p_token" "text") RETURNS TABLE("id" "uuid", "org_id" "uuid", "email" "text", "role" "public"."member_role", "status" "public"."invite_status", "org_name" "text")
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select i.id, i.org_id, i.email, i.role, i.status, o.name
  from public.invitations i
  join public.organizations o on o.id = i.org_id
  where i.token = p_token;
$$;


ALTER FUNCTION "public"."get_invitation_by_token"("p_token" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;


ALTER FUNCTION "public"."handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ingest_lead"("p_token" "text", "p_payload" "jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  v_source public.lead_sources%rowtype;
  v_name text;
  v_phone text;
  v_email text;
  v_client_id uuid;
  v_status uuid;
  v_pos double precision;
  v_deduped boolean := false;
begin
  if length(p_payload::text) > 20000 then
    raise exception 'payload too large';
  end if;

  select * into v_source
  from public.lead_sources
  where token = p_token and is_active = true and is_archived = false;

  if v_source.id is null then
    raise exception 'invalid or inactive token';
  end if;

  v_name := left(nullif(trim(coalesce(
    p_payload->>'name', p_payload->>'full_name', p_payload->>'שם',
    nullif(trim(concat(coalesce(p_payload->>'first_name',''), ' ', coalesce(p_payload->>'last_name',''))), '')
  )), ''), 200);
  v_phone := left(nullif(trim(coalesce(p_payload->>'phone', p_payload->>'phone_number', p_payload->>'טלפון')), ''), 50);
  v_email := left(nullif(lower(trim(coalesce(p_payload->>'email', p_payload->>'אימייל'))), ''), 200);

  if v_name is null then
    v_name := coalesce(v_email, v_phone, 'ליד ללא שם');
  end if;

  select id into v_client_id
  from public.clients
  where org_id = v_source.org_id
    and is_archived = false
    and ((v_email is not null and lower(email) = v_email)
      or (v_phone is not null and phone = v_phone))
  limit 1;

  if v_client_id is not null then
    v_deduped := true;
  else
    select id into v_status
    from public.client_statuses
    where org_id = v_source.org_id and is_archived = false
    order by position limit 1;

    select coalesce(max(position), 0) + 1 into v_pos
    from public.clients where org_id = v_source.org_id;

    insert into public.clients (org_id, name, phone, email, status_id, notes, position)
    values (v_source.org_id, v_name, v_phone, v_email, v_status,
            'התקבל ממקור: ' || v_source.name, v_pos)
    returning id into v_client_id;
  end if;

  insert into public.leads (org_id, source_id, client_id, name, phone, email, payload, deduped)
  values (v_source.org_id, v_source.id, v_client_id, v_name, v_phone, v_email, p_payload, v_deduped);

  return jsonb_build_object('ok', true, 'client_id', v_client_id, 'deduped', v_deduped);
end;
$$;


ALTER FUNCTION "public"."ingest_lead"("p_token" "text", "p_payload" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_admin"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid() and role = 'admin'
  ) or public.is_super_admin();
$$;


ALTER FUNCTION "public"."is_org_admin"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_org_member"("p_org_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.memberships
    where org_id = p_org_id and user_id = auth.uid()
  ) or public.is_super_admin();
$$;


ALTER FUNCTION "public"."is_org_member"("p_org_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."is_super_admin"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (select is_super_admin from public.profiles where id = auth.uid()),
    false
  );
$$;


ALTER FUNCTION "public"."is_super_admin"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."protect_super_admin_flag"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if new.is_super_admin is distinct from old.is_super_admin then
    if not public.is_super_admin() then
      -- לא סופר-אדמין קיים מנסה לשנות את הדגל — מתעלמים מהשינוי ומשאירים כמות שהיה
      new.is_super_admin := old.is_super_admin;
    end if;
  end if;
  return new;
end;
$$;


ALTER FUNCTION "public"."protect_super_admin_flag"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."rls_auto_enable"() RETURNS "event_trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'pg_catalog'
    AS $$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$$;


ALTER FUNCTION "public"."rls_auto_enable"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."seed_client_statuses"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  insert into public.client_statuses (org_id, label, color, position) values
    (new.id, 'ליד', '#579bfc', 0),
    (new.id, 'בטיפול', '#fdab3d', 1),
    (new.id, 'לקוח פעיל', '#00c875', 2),
    (new.id, 'לא פעיל', '#c4c4c4', 3);
  return new;
end;
$$;


ALTER FUNCTION "public"."seed_client_statuses"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_org_logo"("p_org_id" "uuid", "p_logo_url" "text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.is_org_admin(p_org_id) then raise exception 'not authorized'; end if;
  update public.organizations set logo_url = p_logo_url where id = p_org_id;
end; $$;


ALTER FUNCTION "public"."set_org_logo"("p_org_id" "uuid", "p_logo_url" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."boards" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."boards" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_fields" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_fields" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."client_statuses" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "label" "text" NOT NULL,
    "color" "text" DEFAULT '#579bfc'::"text" NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."client_statuses" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."clients" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "status_id" "uuid",
    "company_number" "text",
    "phone" "text",
    "email" "text",
    "address" "text",
    "website" "text",
    "notes" "text",
    "owner_id" "uuid",
    "custom_values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "contact_is_self" boolean DEFAULT true NOT NULL,
    "contact_name" "text",
    "contact_role" "text",
    "contact_phone" "text",
    "contact_email" "text"
);


ALTER TABLE "public"."clients" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."columns" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "board_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "type" "text" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."columns" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."contacts" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "client_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text",
    "phone" "text",
    "email" "text",
    "notes" "text",
    "position" double precision DEFAULT 0 NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."contacts" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."groups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "board_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "color" "text" DEFAULT '#579bfc'::"text",
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."groups" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "role" "public"."member_role" DEFAULT 'member'::"public"."member_role" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(16), 'hex'::"text") NOT NULL,
    "status" "public"."invite_status" DEFAULT 'pending'::"public"."invite_status" NOT NULL,
    "invited_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "board_id" "uuid" NOT NULL,
    "group_id" "uuid" NOT NULL,
    "name" "text" DEFAULT ''::"text" NOT NULL,
    "values" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."lead_sources" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "source_type" "text" DEFAULT 'webhook'::"text" NOT NULL,
    "token" "text" DEFAULT "encode"("extensions"."gen_random_bytes"(24), 'hex'::"text") NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."lead_sources" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."leads" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "source_id" "uuid",
    "client_id" "uuid",
    "name" "text",
    "phone" "text",
    "email" "text",
    "payload" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "deduped" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."leads" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."memberships" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "public"."member_role" DEFAULT 'member'::"public"."member_role" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."memberships" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."organizations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "slug" "text",
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "logo_url" "text",
    "is_archived" boolean DEFAULT false NOT NULL,
    "features" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL
);


ALTER TABLE "public"."organizations" OWNER TO "postgres";


COMMENT ON COLUMN "public"."organizations"."features" IS 'מפת תכונות אופציונליות מופעלות לארגון, למשל {"send_contract": true}. נשלט ע"י סופר-אדמין בלבד (מדיניות orgs_update הקיימת).';



CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "full_name" "text",
    "email" "text",
    "is_super_admin" boolean DEFAULT false NOT NULL,
    "avatar_url" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "org_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text",
    "color" "text" DEFAULT '#0073ea'::"text",
    "position" double precision DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_archived" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."workspaces" OWNER TO "postgres";


ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_fields"
    ADD CONSTRAINT "client_fields_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."client_statuses"
    ADD CONSTRAINT "client_statuses_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."columns"
    ADD CONSTRAINT "columns_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_token_key" UNIQUE ("token");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_org_id_user_id_key" UNIQUE ("org_id", "user_id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_slug_key" UNIQUE ("slug");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_pkey" PRIMARY KEY ("id");



CREATE INDEX "idx_boards_workspace" ON "public"."boards" USING "btree" ("workspace_id");



CREATE INDEX "idx_client_fields_org" ON "public"."client_fields" USING "btree" ("org_id");



CREATE INDEX "idx_client_statuses_org" ON "public"."client_statuses" USING "btree" ("org_id");



CREATE INDEX "idx_clients_org" ON "public"."clients" USING "btree" ("org_id");



CREATE INDEX "idx_columns_board" ON "public"."columns" USING "btree" ("board_id");



CREATE INDEX "idx_contacts_client" ON "public"."contacts" USING "btree" ("client_id");



CREATE INDEX "idx_groups_board" ON "public"."groups" USING "btree" ("board_id");



CREATE INDEX "idx_items_board" ON "public"."items" USING "btree" ("board_id");



CREATE INDEX "idx_items_group" ON "public"."items" USING "btree" ("group_id");



CREATE INDEX "idx_items_values" ON "public"."items" USING "gin" ("values" "jsonb_path_ops");



CREATE INDEX "idx_lead_sources_org" ON "public"."lead_sources" USING "btree" ("org_id");



CREATE INDEX "idx_leads_client" ON "public"."leads" USING "btree" ("client_id");



CREATE INDEX "idx_leads_org" ON "public"."leads" USING "btree" ("org_id");



CREATE INDEX "idx_memberships_org" ON "public"."memberships" USING "btree" ("org_id");



CREATE INDEX "idx_memberships_user" ON "public"."memberships" USING "btree" ("user_id");



CREATE INDEX "idx_workspaces_org" ON "public"."workspaces" USING "btree" ("org_id");



CREATE UNIQUE INDEX "uq_invitations_pending" ON "public"."invitations" USING "btree" ("org_id", "lower"("email")) WHERE ("status" = 'pending'::"public"."invite_status");



CREATE OR REPLACE TRIGGER "on_org_created_seed_statuses" AFTER INSERT ON "public"."organizations" FOR EACH ROW EXECUTE FUNCTION "public"."seed_client_statuses"();



CREATE OR REPLACE TRIGGER "protect_super_admin_flag_trigger" BEFORE UPDATE ON "public"."profiles" FOR EACH ROW EXECUTE FUNCTION "public"."protect_super_admin_flag"();



ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."boards"
    ADD CONSTRAINT "boards_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_fields"
    ADD CONSTRAINT "client_fields_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."client_statuses"
    ADD CONSTRAINT "client_statuses_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."clients"
    ADD CONSTRAINT "clients_status_id_fkey" FOREIGN KEY ("status_id") REFERENCES "public"."client_statuses"("id");



ALTER TABLE ONLY "public"."columns"
    ADD CONSTRAINT "columns_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."columns"
    ADD CONSTRAINT "columns_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."contacts"
    ADD CONSTRAINT "contacts_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."groups"
    ADD CONSTRAINT "groups_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_invited_by_fkey" FOREIGN KEY ("invited_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."invitations"
    ADD CONSTRAINT "invitations_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_board_id_fkey" FOREIGN KEY ("board_id") REFERENCES "public"."boards"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_group_id_fkey" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."lead_sources"
    ADD CONSTRAINT "lead_sources_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id");



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."leads"
    ADD CONSTRAINT "leads_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "public"."lead_sources"("id");



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."memberships"
    ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."organizations"
    ADD CONSTRAINT "organizations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "public"."profiles"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."workspaces"
    ADD CONSTRAINT "workspaces_org_id_fkey" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE CASCADE;



ALTER TABLE "public"."boards" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "boards_insert" ON "public"."boards" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "boards_select" ON "public"."boards" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "boards_update" ON "public"."boards" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."client_fields" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_fields_insert" ON "public"."client_fields" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "client_fields_select" ON "public"."client_fields" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "client_fields_update" ON "public"."client_fields" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."client_statuses" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "client_statuses_insert" ON "public"."client_statuses" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "client_statuses_select" ON "public"."client_statuses" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "client_statuses_update" ON "public"."client_statuses" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."clients" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "clients_insert" ON "public"."clients" FOR INSERT WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "clients_select" ON "public"."clients" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "clients_update" ON "public"."clients" FOR UPDATE USING ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."columns" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "columns_insert" ON "public"."columns" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "columns_select" ON "public"."columns" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "columns_update" ON "public"."columns" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."contacts" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "contacts_insert" ON "public"."contacts" FOR INSERT WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "contacts_select" ON "public"."contacts" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "contacts_update" ON "public"."contacts" FOR UPDATE USING ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."groups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "groups_insert" ON "public"."groups" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "groups_select" ON "public"."groups" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "groups_update" ON "public"."groups" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."invitations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "invitations_delete" ON "public"."invitations" FOR DELETE USING ("public"."is_org_admin"("org_id"));



CREATE POLICY "invitations_insert" ON "public"."invitations" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "invitations_select" ON "public"."invitations" FOR SELECT USING (("public"."is_org_admin"("org_id") OR ("lower"("email") = "lower"(( SELECT "profiles"."email"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))))));



CREATE POLICY "invitations_update" ON "public"."invitations" FOR UPDATE USING (("public"."is_org_admin"("org_id") OR ("lower"("email") = "lower"(( SELECT "profiles"."email"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"()))))));



ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "items_insert" ON "public"."items" FOR INSERT WITH CHECK ("public"."is_org_member"("org_id"));



CREATE POLICY "items_select" ON "public"."items" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "items_update" ON "public"."items" FOR UPDATE USING ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."lead_sources" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "lead_sources_insert" ON "public"."lead_sources" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "lead_sources_select" ON "public"."lead_sources" FOR SELECT USING ("public"."is_org_admin"("org_id"));



CREATE POLICY "lead_sources_update" ON "public"."lead_sources" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "leads_select" ON "public"."leads" FOR SELECT USING ("public"."is_org_member"("org_id"));



ALTER TABLE "public"."memberships" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "memberships_delete" ON "public"."memberships" FOR DELETE USING ("public"."is_org_admin"("org_id"));



CREATE POLICY "memberships_insert" ON "public"."memberships" FOR INSERT WITH CHECK (("public"."is_org_admin"("org_id") OR (EXISTS ( SELECT 1
   FROM ("public"."invitations" "i"
     JOIN "public"."profiles" "p" ON (("p"."id" = "auth"."uid"())))
  WHERE (("i"."org_id" = "memberships"."org_id") AND ("i"."status" = 'pending'::"public"."invite_status") AND ("lower"("i"."email") = "lower"("p"."email")) AND ("memberships"."user_id" = "auth"."uid"()))))));



CREATE POLICY "memberships_select" ON "public"."memberships" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."is_org_admin"("org_id")));



CREATE POLICY "memberships_update" ON "public"."memberships" FOR UPDATE USING ("public"."is_org_admin"("org_id"));



ALTER TABLE "public"."organizations" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orgs_delete" ON "public"."organizations" FOR DELETE USING ("public"."is_super_admin"());



CREATE POLICY "orgs_insert" ON "public"."organizations" FOR INSERT WITH CHECK ("public"."is_super_admin"());



CREATE POLICY "orgs_select" ON "public"."organizations" FOR SELECT USING ("public"."is_org_member"("id"));



CREATE POLICY "orgs_update" ON "public"."organizations" FOR UPDATE USING ("public"."is_super_admin"());



ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "profiles_insert" ON "public"."profiles" FOR INSERT WITH CHECK (("id" = "auth"."uid"()));



CREATE POLICY "profiles_select" ON "public"."profiles" FOR SELECT USING ((("id" = "auth"."uid"()) OR "public"."is_super_admin"() OR (EXISTS ( SELECT 1
   FROM ("public"."memberships" "m1"
     JOIN "public"."memberships" "m2" ON (("m1"."org_id" = "m2"."org_id")))
  WHERE (("m1"."user_id" = "auth"."uid"()) AND ("m2"."user_id" = "profiles"."id"))))));



CREATE POLICY "profiles_update" ON "public"."profiles" FOR UPDATE USING (("id" = "auth"."uid"()));



ALTER TABLE "public"."workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "workspaces_insert" ON "public"."workspaces" FOR INSERT WITH CHECK ("public"."is_org_admin"("org_id"));



CREATE POLICY "workspaces_select" ON "public"."workspaces" FOR SELECT USING ("public"."is_org_member"("org_id"));



CREATE POLICY "workspaces_update" ON "public"."workspaces" FOR UPDATE USING ("public"."is_org_admin"("org_id"));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";






















































































































































GRANT ALL ON FUNCTION "public"."get_invitation_by_token"("p_token" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_invitation_by_token"("p_token" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_invitation_by_token"("p_token" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."handle_new_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ingest_lead"("p_token" "text", "p_payload" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ingest_lead"("p_token" "text", "p_payload" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."ingest_lead"("p_token" "text", "p_payload" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."ingest_lead"("p_token" "text", "p_payload" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_admin"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_admin"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_admin"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_org_member"("p_org_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."is_org_member"("p_org_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_org_member"("p_org_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "anon";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."is_super_admin"() TO "service_role";



GRANT ALL ON FUNCTION "public"."protect_super_admin_flag"() TO "anon";
GRANT ALL ON FUNCTION "public"."protect_super_admin_flag"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."protect_super_admin_flag"() TO "service_role";



GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "anon";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."rls_auto_enable"() TO "service_role";



GRANT ALL ON FUNCTION "public"."seed_client_statuses"() TO "anon";
GRANT ALL ON FUNCTION "public"."seed_client_statuses"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."seed_client_statuses"() TO "service_role";



GRANT ALL ON FUNCTION "public"."set_org_logo"("p_org_id" "uuid", "p_logo_url" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."set_org_logo"("p_org_id" "uuid", "p_logo_url" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_org_logo"("p_org_id" "uuid", "p_logo_url" "text") TO "service_role";


















GRANT ALL ON TABLE "public"."boards" TO "anon";
GRANT ALL ON TABLE "public"."boards" TO "authenticated";
GRANT ALL ON TABLE "public"."boards" TO "service_role";



GRANT ALL ON TABLE "public"."client_fields" TO "anon";
GRANT ALL ON TABLE "public"."client_fields" TO "authenticated";
GRANT ALL ON TABLE "public"."client_fields" TO "service_role";



GRANT ALL ON TABLE "public"."client_statuses" TO "anon";
GRANT ALL ON TABLE "public"."client_statuses" TO "authenticated";
GRANT ALL ON TABLE "public"."client_statuses" TO "service_role";



GRANT ALL ON TABLE "public"."clients" TO "anon";
GRANT ALL ON TABLE "public"."clients" TO "authenticated";
GRANT ALL ON TABLE "public"."clients" TO "service_role";



GRANT ALL ON TABLE "public"."columns" TO "anon";
GRANT ALL ON TABLE "public"."columns" TO "authenticated";
GRANT ALL ON TABLE "public"."columns" TO "service_role";



GRANT ALL ON TABLE "public"."contacts" TO "anon";
GRANT ALL ON TABLE "public"."contacts" TO "authenticated";
GRANT ALL ON TABLE "public"."contacts" TO "service_role";



GRANT ALL ON TABLE "public"."groups" TO "anon";
GRANT ALL ON TABLE "public"."groups" TO "authenticated";
GRANT ALL ON TABLE "public"."groups" TO "service_role";



GRANT ALL ON TABLE "public"."invitations" TO "anon";
GRANT ALL ON TABLE "public"."invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."invitations" TO "service_role";



GRANT ALL ON TABLE "public"."items" TO "anon";
GRANT ALL ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT ALL ON TABLE "public"."lead_sources" TO "anon";
GRANT ALL ON TABLE "public"."lead_sources" TO "authenticated";
GRANT ALL ON TABLE "public"."lead_sources" TO "service_role";



GRANT ALL ON TABLE "public"."leads" TO "anon";
GRANT ALL ON TABLE "public"."leads" TO "authenticated";
GRANT ALL ON TABLE "public"."leads" TO "service_role";



GRANT ALL ON TABLE "public"."memberships" TO "anon";
GRANT ALL ON TABLE "public"."memberships" TO "authenticated";
GRANT ALL ON TABLE "public"."memberships" TO "service_role";



GRANT ALL ON TABLE "public"."organizations" TO "anon";
GRANT ALL ON TABLE "public"."organizations" TO "authenticated";
GRANT ALL ON TABLE "public"."organizations" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";



GRANT ALL ON TABLE "public"."workspaces" TO "anon";
GRANT ALL ON TABLE "public"."workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."workspaces" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";




































-- ----------------------------------------------------------------------------
-- Cross-schema trigger on auth.users (not captured by `db dump` of public).
-- Auto-creates a public.profiles row when a new auth user signs up.
-- Recreated so a fresh environment built from this baseline is complete.
-- ----------------------------------------------------------------------------
DROP TRIGGER IF EXISTS "on_auth_user_created" ON "auth"."users";
CREATE TRIGGER "on_auth_user_created"
  AFTER INSERT ON "auth"."users"
  FOR EACH ROW EXECUTE FUNCTION "public"."handle_new_user"();
