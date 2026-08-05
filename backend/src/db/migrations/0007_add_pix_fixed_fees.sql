PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`webhook_url` text,
	`webhook_secret` text NOT NULL,
	`kyc_status` text DEFAULT 'pending' NOT NULL,
	`kyc_reason` text,
	`kyc_reviewed_at` text,
	`pix_fee_in_bps` integer DEFAULT 0 NOT NULL,
	`pix_fee_out_bps` integer DEFAULT 0 NOT NULL,
	`pix_fee_in_fixed` integer DEFAULT 0 NOT NULL,
	`pix_fee_out_fixed` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "merchants_kyc_status" CHECK("__new_merchants"."kyc_status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "merchants_pix_fee_in_bps" CHECK("__new_merchants"."pix_fee_in_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "merchants_pix_fee_out_bps" CHECK("__new_merchants"."pix_fee_out_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "merchants_pix_fee_in_fixed" CHECK("__new_merchants"."pix_fee_in_fixed" >= 0),
	CONSTRAINT "merchants_pix_fee_out_fixed" CHECK("__new_merchants"."pix_fee_out_fixed" >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_merchants`("id", "name", "webhook_url", "webhook_secret", "kyc_status", "kyc_reason", "kyc_reviewed_at", "pix_fee_in_bps", "pix_fee_out_bps", "created_at", "updated_at") SELECT "id", "name", "webhook_url", "webhook_secret", "kyc_status", "kyc_reason", "kyc_reviewed_at", "pix_fee_in_bps", "pix_fee_out_bps", "created_at", "updated_at" FROM `merchants`;--> statement-breakpoint
DROP TABLE `merchants`;--> statement-breakpoint
ALTER TABLE `__new_merchants` RENAME TO `merchants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;