CREATE TABLE IF NOT EXISTS `withdrawals` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`confirmed_at` text,
	`denied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "withdrawals_amount" CHECK("withdrawals"."amount" > 0),
	CONSTRAINT "withdrawals_status" CHECK("withdrawals"."status" IN ('pending', 'confirmed', 'denied'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_withdrawals_merchant_created` ON `withdrawals` (`merchant_id`,"created_at" DESC);
