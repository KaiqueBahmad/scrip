-- Baseline. Hand-edited once, on purpose: every CREATE carries IF NOT EXISTS so this
-- migration also applies to a database that predates the migration layer (it was built by
-- the old schema.sql, whose tables are identical). Keep the guards if you regenerate it.
-- Later migrations are plain drizzle-kit output and need no such treatment.
CREATE TABLE IF NOT EXISTS `charge_events` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`from_status` text,
	`to_status` text NOT NULL,
	`reason` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `pix_charges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_charge_events_charge` ON `charge_events` (`charge_id`,`created_at`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `idempotency_keys` (
	`key` text NOT NULL,
	`merchant_id` text NOT NULL,
	`endpoint` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_status` integer NOT NULL,
	`response_body` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`merchant_id`, `endpoint`, `key`),
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `integration_tokens` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`name` text,
	`token` text NOT NULL,
	`expires_at` text,
	`revoked_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_tokens_merchant` ON `integration_tokens` (`merchant_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `kyc_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`type` text NOT NULL,
	`filename` text NOT NULL,
	`mime_type` text NOT NULL,
	`size` integer NOT NULL,
	`content` blob NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "kyc_documents_status" CHECK("kyc_documents"."status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_kyc_merchant` ON `kyc_documents` (`merchant_id`,"created_at" DESC);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `merchants` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`webhook_url` text,
	`webhook_secret` text NOT NULL,
	`kyc_status` text DEFAULT 'pending' NOT NULL,
	`kyc_reason` text,
	`kyc_reviewed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "merchants_kyc_status" CHECK("merchants"."kyc_status" IN ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pix_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payer_document` text,
	`payer_name` text,
	`description` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`qr_code` text NOT NULL,
	`qr_code_txid` text NOT NULL,
	`qr_code_expires_at` text NOT NULL,
	`e2e_id` text,
	`refunded_amount` integer DEFAULT 0 NOT NULL,
	`paid_at` text,
	`expired_at` text,
	`canceled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pix_charges_amount" CHECK("pix_charges"."amount" > 0),
	CONSTRAINT "pix_charges_refunded_amount" CHECK("pix_charges"."refunded_amount" >= 0),
	CONSTRAINT "pix_charges_status" CHECK("pix_charges"."status" IN ('pending', 'paid', 'expired', 'canceled', 'partially_refunded', 'refunded'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_charges_merchant_created` ON `pix_charges` (`merchant_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_charges_status` ON `pix_charges` (`status`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pix_refunds` (
	`id` text PRIMARY KEY NOT NULL,
	`charge_id` text NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'succeeded' NOT NULL,
	`reason` text,
	`e2e_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`charge_id`) REFERENCES `pix_charges`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pix_refunds_amount" CHECK("pix_refunds"."amount" > 0),
	CONSTRAINT "pix_refunds_status" CHECK("pix_refunds"."status" IN ('succeeded', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_refunds_charge` ON `pix_refunds` (`charge_id`);--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `webhook_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`charge_id` text,
	`event` text NOT NULL,
	`url` text NOT NULL,
	`payload` text NOT NULL,
	`signature` text,
	`attempt` integer DEFAULT 0 NOT NULL,
	`max_attempts` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`response_status` integer,
	`response_body` text,
	`error` text,
	`scheduled_at` text,
	`delivered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`charge_id`) REFERENCES `pix_charges`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "webhook_deliveries_status" CHECK("webhook_deliveries"."status" IN ('pending', 'delivered', 'failed'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deliveries_merchant` ON `webhook_deliveries` (`merchant_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deliveries_charge` ON `webhook_deliveries` (`charge_id`);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS `idx_deliveries_status` ON `webhook_deliveries` (`status`);