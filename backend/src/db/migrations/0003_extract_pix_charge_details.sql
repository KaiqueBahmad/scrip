ALTER TABLE `pix_charges` RENAME TO `charges`;
--> statement-breakpoint
ALTER TABLE `charges` ADD COLUMN `payment_method` text DEFAULT 'pix' NOT NULL CHECK("payment_method" IN ('pix'));
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS `pix_charge_details` (
	`charge_id` text PRIMARY KEY NOT NULL,
	`qr_code` text NOT NULL,
	`qr_code_txid` text NOT NULL,
	`qr_code_expires_at` text NOT NULL,
	`e2e_id` text,
	FOREIGN KEY (`charge_id`) REFERENCES `charges`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
INSERT INTO `pix_charge_details` (`charge_id`, `qr_code`, `qr_code_txid`, `qr_code_expires_at`, `e2e_id`)
SELECT `id`, `qr_code`, `qr_code_txid`, `qr_code_expires_at`, `e2e_id` FROM `charges`;
--> statement-breakpoint
ALTER TABLE `charges` DROP COLUMN `qr_code`;
--> statement-breakpoint
ALTER TABLE `charges` DROP COLUMN `qr_code_txid`;
--> statement-breakpoint
ALTER TABLE `charges` DROP COLUMN `qr_code_expires_at`;
--> statement-breakpoint
ALTER TABLE `charges` DROP COLUMN `e2e_id`;
