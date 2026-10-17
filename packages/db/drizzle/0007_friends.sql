CREATE TYPE "public"."friendship_status" AS ENUM('pending', 'accepted');--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_a" text NOT NULL,
	"user_b" text NOT NULL,
	"status" "friendship_status" DEFAULT 'pending' NOT NULL,
	"requested_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"accepted_at" timestamp with time zone,
	CONSTRAINT "friendships_user_a_user_b_pk" PRIMARY KEY("user_a","user_b"),
	CONSTRAINT "friendships_ordered_pair" CHECK ("friendships"."user_a" < "friendships"."user_b" collate "C"),
	CONSTRAINT "friendships_requester_in_pair" CHECK ("friendships"."requested_by" = "friendships"."user_a" or "friendships"."requested_by" = "friendships"."user_b"),
	CONSTRAINT "friendships_accepted_at" CHECK (("friendships"."status" = 'accepted') = ("friendships"."accepted_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_users_id_fk" FOREIGN KEY ("user_a") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_users_id_fk" FOREIGN KEY ("user_b") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "friendships_user_b_idx" ON "friendships" USING btree ("user_b");