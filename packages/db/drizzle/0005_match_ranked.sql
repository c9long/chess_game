ALTER TABLE "matches" ADD COLUMN "ranked" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Ranked games so far: every rated game is ranked (0004 cleared the older auto-rated ones).
UPDATE "matches" SET "ranked" = true WHERE "rated";
