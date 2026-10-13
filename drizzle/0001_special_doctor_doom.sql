CREATE TABLE `usage_feedback` (
	`id` text PRIMARY KEY NOT NULL,
	`operation_id` text NOT NULL,
	`invite_id` text NOT NULL,
	`copy_revision` integer NOT NULL,
	`outcome` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`operation_id`) REFERENCES `claims`(`operation_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`invite_id`) REFERENCES `invites`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "usage_outcomes" CHECK("usage_feedback"."outcome" IN ('success','failure'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `usage_feedback_operation` ON `usage_feedback` (`operation_id`);--> statement-breakpoint
CREATE INDEX `usage_feedback_invite` ON `usage_feedback` (`invite_id`,`copy_revision`,`outcome`,`recorded_at`);