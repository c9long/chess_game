CREATE TYPE "public"."age_band" AS ENUM('13-15', '16-17', '18+');--> statement-breakpoint
CREATE TYPE "public"."legal_acceptance_kind" AS ENUM('accepted', 'acknowledged');--> statement-breakpoint
CREATE TABLE "pending_guest_links" (
	"new_user_id" text PRIMARY KEY NOT NULL,
	"guest_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sign_in_throttle" (
	"key" text PRIMARY KEY NOT NULL,
	"failures" integer DEFAULT 0 NOT NULL,
	"window_started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_until" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "age_band" "age_band";--> statement-breakpoint
ALTER TABLE "legal_acceptances" ADD COLUMN "kind" "legal_acceptance_kind";--> statement-breakpoint
-- Backfill existing rows: Terms are accepted, the Privacy Policy is acknowledged (PLAN §5).
UPDATE "legal_acceptances" SET "kind" = CASE WHEN "document" = 'privacy' THEN 'acknowledged'::"legal_acceptance_kind" ELSE 'accepted'::"legal_acceptance_kind" END;--> statement-breakpoint
ALTER TABLE "legal_acceptances" ALTER COLUMN "kind" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "pending_guest_links" ADD CONSTRAINT "pending_guest_links_new_user_id_users_id_fk" FOREIGN KEY ("new_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_guest_links" ADD CONSTRAINT "pending_guest_links_guest_id_users_id_fk" FOREIGN KEY ("guest_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pending_guest_links_guest_idx" ON "pending_guest_links" USING btree ("guest_id");--> statement-breakpoint
ALTER TABLE "match_players" ADD CONSTRAINT "match_players_civ_version_fk" FOREIGN KEY ("civ_id","civ_version") REFERENCES "public"."civilization_versions"("civ_id","version") ON DELETE restrict ON UPDATE no action;