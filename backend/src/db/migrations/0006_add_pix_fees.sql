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
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "merchants_kyc_status" CHECK("__new_merchants"."kyc_status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "merchants_pix_fee_in_bps" CHECK("__new_merchants"."pix_fee_in_bps" BETWEEN 0 AND 10000),
	CONSTRAINT "merchants_pix_fee_out_bps" CHECK("__new_merchants"."pix_fee_out_bps" BETWEEN 0 AND 10000)
);
--> statement-breakpoint
INSERT INTO `__new_merchants`("id", "name", "webhook_url", "webhook_secret", "kyc_status", "kyc_reason", "kyc_reviewed_at", "created_at", "updated_at") SELECT "id", "name", "webhook_url", "webhook_secret", "kyc_status", "kyc_reason", "kyc_reviewed_at", "created_at", "updated_at" FROM `merchants`;--> statement-breakpoint
DROP TABLE `merchants`;--> statement-breakpoint
ALTER TABLE `__new_merchants` RENAME TO `merchants`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_charges` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`payment_method` text DEFAULT 'pix' NOT NULL,
	`amount` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`payer_document` text,
	`payer_name` text,
	`description` text,
	`metadata` text DEFAULT '{}' NOT NULL,
	`callback_url` text,
	`refunded_amount` integer DEFAULT 0 NOT NULL,
	`fee_amount` integer DEFAULT 0 NOT NULL,
	`paid_at` text,
	`expired_at` text,
	`canceled_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "charges_amount" CHECK("__new_charges"."amount" > 0),
	CONSTRAINT "charges_refunded_amount" CHECK("__new_charges"."refunded_amount" >= 0),
	CONSTRAINT "charges_fee_amount" CHECK("__new_charges"."fee_amount" >= 0),
	CONSTRAINT "charges_status" CHECK("__new_charges"."status" IN ('pending', 'paid', 'expired', 'canceled', 'partially_refunded', 'refunded')),
	CONSTRAINT "charges_payment_method" CHECK("__new_charges"."payment_method" IN ('pix'))
);
--> statement-breakpoint
INSERT INTO `__new_charges`("id", "merchant_id", "payment_method", "amount", "status", "payer_document", "payer_name", "description", "metadata", "callback_url", "refunded_amount", "paid_at", "expired_at", "canceled_at", "created_at", "updated_at") SELECT "id", "merchant_id", "payment_method", "amount", "status", "payer_document", "payer_name", "description", "metadata", "callback_url", "refunded_amount", "paid_at", "expired_at", "canceled_at", "created_at", "updated_at" FROM `charges`;--> statement-breakpoint
DROP TABLE `charges`;--> statement-breakpoint
ALTER TABLE `__new_charges` RENAME TO `charges`;--> statement-breakpoint
CREATE INDEX `idx_charges_merchant_created` ON `charges` (`merchant_id`,"created_at" DESC);--> statement-breakpoint
CREATE INDEX `idx_charges_status` ON `charges` (`status`);--> statement-breakpoint
CREATE TABLE `__new_withdrawals` (
	`id` text PRIMARY KEY NOT NULL,
	`merchant_id` text NOT NULL,
	`amount` integer NOT NULL,
	`fee_amount` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`reason` text,
	`confirmed_at` text,
	`denied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`merchant_id`) REFERENCES `merchants`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "withdrawals_amount" CHECK("__new_withdrawals"."amount" > 0),
	CONSTRAINT "withdrawals_fee_amount" CHECK("__new_withdrawals"."fee_amount" >= 0),
	CONSTRAINT "withdrawals_status" CHECK("__new_withdrawals"."status" IN ('pending', 'confirmed', 'denied'))
);
--> statement-breakpoint
INSERT INTO `__new_withdrawals`("id", "merchant_id", "amount", "status", "reason", "confirmed_at", "denied_at", "created_at", "updated_at") SELECT "id", "merchant_id", "amount", "status", "reason", "confirmed_at", "denied_at", "created_at", "updated_at" FROM `withdrawals`;--> statement-breakpoint
DROP TABLE `withdrawals`;--> statement-breakpoint
ALTER TABLE `__new_withdrawals` RENAME TO `withdrawals`;--> statement-breakpoint
CREATE INDEX `idx_withdrawals_merchant_created` ON `withdrawals` (`merchant_id`,"created_at" DESC);