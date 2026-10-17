CREATE TYPE "public"."friend_request_policy" AS ENUM('anyone', 'played_with');--> statement-breakpoint
CREATE TABLE "user_settings" (
	"user_id" text PRIMARY KEY NOT NULL,
	"friend_requests" "friend_request_policy" DEFAULT 'anyone' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "user_settings" ADD CONSTRAINT "user_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
-- Player search (PLAN §3 "Friends", 2026-10-17): Postgres only, no separate search engine.
-- Exact username lookups use the existing unique index on users.username (Better Auth stores
-- the normalized, lowercase username there, so it is case-insensitive already).
-- Search-as-you-type uses pg_trgm (a trusted extension since PostgreSQL 13: the database owner
-- can create it; it ships with the PostgreSQL contrib modules and the postgres:16-alpine image).
-- If the server doesn't offer it, the migration still succeeds and search falls back to a
-- prefix match on a text_pattern_ops index (see docs/DEPLOY.md "PostgreSQL extensions").
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_trgm unavailable (%): player search uses prefix matching only', SQLERRM;
END
$$;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_trgm') THEN
    CREATE INDEX IF NOT EXISTS "users_username_trgm_idx" ON "users"
      USING gin (lower("username") gin_trgm_ops) WHERE "username" IS NOT NULL;
  ELSE
    CREATE INDEX IF NOT EXISTS "users_username_prefix_idx" ON "users"
      (lower("username") text_pattern_ops) WHERE "username" IS NOT NULL;
  END IF;
END
$$;
