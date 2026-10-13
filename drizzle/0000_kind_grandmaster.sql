CREATE TABLE `claims` (
	`operation_id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`copy_revision` integer NOT NULL,
	`status` text NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`confirmed_at` integer,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "claim_states" CHECK("claims"."status" IN ('reserved','confirming','confirmed','cancelled'))
);
--> statement-breakpoint
CREATE INDEX `claims_active` ON `claims` (`invite_id`,`status`,`expires_at`);--> statement-breakpoint
CREATE INDEX `claims_visitor` ON `claims` (`invite_id`,`visitor_hash`,`confirmed_at`);--> statement-breakpoint
CREATE TABLE `invites` (
	`id` text PRIMARY KEY NOT NULL,
	`code` text NOT NULL,
	`nickname` text DEFAULT '' NOT NULL,
	`initial_remaining` integer NOT NULL,
	`remaining` integer NOT NULL,
	`copied_count` integer DEFAULT 0 NOT NULL,
	`owner_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`review_status` text DEFAULT 'normal' NOT NULL,
	`copy_revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "remaining_bounds" CHECK("invites"."remaining" BETWEEN 0 AND 30),
	CONSTRAINT "initial_bounds" CHECK("invites"."initial_remaining" BETWEEN 0 AND 30),
	CONSTRAINT "review_states" CHECK("invites"."review_status" IN ('normal','pending','invalid'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `invites_code_unique` ON `invites` (`code`);--> statement-breakpoint
CREATE INDEX `invites_created` ON `invites` (`created_at`);--> statement-breakpoint
CREATE TABLE `rate_limits` (
	`key` text NOT NULL,
	`window` integer NOT NULL,
	`count` integer NOT NULL,
	PRIMARY KEY(`key`, `window`)
);
--> statement-breakpoint
CREATE INDEX `rate_windows` ON `rate_limits` (`window`);--> statement-breakpoint
CREATE TABLE `reports` (
	`id` text PRIMARY KEY NOT NULL,
	`invite_id` text NOT NULL,
	`visitor_hash` text NOT NULL,
	`reason` text NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`resolved` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "report_reasons" CHECK("reports"."reason" IN ('expired','incorrect','other'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reports_one_visitor` ON `reports` (`invite_id`,`visitor_hash`);--> statement-breakpoint
CREATE INDEX `reports_queue` ON `reports` (`resolved`,`created_at`);