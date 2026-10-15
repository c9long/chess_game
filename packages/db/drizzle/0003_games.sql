CREATE TABLE "bot_level_anchors" (
	"bot_level" text PRIMARY KEY NOT NULL,
	"mu" double precision NOT NULL,
	"sigma" double precision NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "matches_started_at_idx" ON "matches" USING btree ("started_at");--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_kind_pool" CHECK ("ratings"."kind" in ('public', 'shadow'));--> statement-breakpoint
-- Initial bot anchors: display rating = 900 + 30 * (mu - 3 * sigma) (apps/server/src/game/ratings.ts),
-- so with sigma = 1 a level L sits at mu = (L - 900) / 30 + 3; 'max' is placed at 2700.
INSERT INTO "bot_level_anchors" ("bot_level", "mu", "sigma") VALUES
  ('600', -7, 1),
  ('900', 3, 1),
  ('1200', 13, 1),
  ('1500', 23, 1),
  ('1800', 33, 1),
  ('2100', 43, 1),
  ('2400', 53, 1),
  ('max', 63, 1);
