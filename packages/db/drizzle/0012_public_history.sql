-- IF [NOT] EXISTS: a development database may hold an earlier draft of this migration.
DROP INDEX IF EXISTS "match_players_user_idx";--> statement-breakpoint
ALTER TABLE "user_settings" ADD COLUMN IF NOT EXISTS "public_history" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "match_players_user_match_idx" ON "match_players" USING btree ("user_id","match_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "matches_finished_ended_idx" ON "matches" USING btree ("ended_at") WHERE "matches"."status" = 'finished';