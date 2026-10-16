CREATE TABLE "elo_ratings" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"mode" "match_mode" NOT NULL,
	"time_control" text NOT NULL,
	"rating" integer NOT NULL,
	"games" integer DEFAULT 0 NOT NULL,
	"peak" integer NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "elo_ratings_user_mode_tc" UNIQUE("user_id","mode","time_control"),
	CONSTRAINT "elo_ratings_games_nonnegative" CHECK ("elo_ratings"."games" >= 0)
);
--> statement-breakpoint
-- Games before ranked lobbies were "rated" automatically (four registered humans) on the
-- public OpenSkill scale. They were never ranked: clear their rated flag and the OpenSkill
-- numbers so history doesn't show them as Elo. No ranked (Elo) game exists before this.
UPDATE "match_players" SET "rating_before" = NULL, "rating_after" = NULL
  WHERE "match_id" IN (SELECT "id" FROM "matches" WHERE "rated");--> statement-breakpoint
UPDATE "matches" SET "rated" = false WHERE "rated";--> statement-breakpoint
-- Ranked games store Elo before/after (integers).
ALTER TABLE "match_players" ALTER COLUMN "rating_before" SET DATA TYPE integer USING round("rating_before")::integer;--> statement-breakpoint
ALTER TABLE "match_players" ALTER COLUMN "rating_after" SET DATA TYPE integer USING round("rating_after")::integer;--> statement-breakpoint
ALTER TABLE "elo_ratings" ADD CONSTRAINT "elo_ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "elo_ratings_leaderboard_idx" ON "elo_ratings" USING btree ("mode","time_control","rating");