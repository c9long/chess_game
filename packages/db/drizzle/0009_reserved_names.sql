CREATE TABLE "reserved_names" (
	"name" text PRIMARY KEY NOT NULL,
	"reserved_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "reserved_names_until_idx" ON "reserved_names" USING btree ("reserved_until");