ALTER TABLE `invites` ADD `pinned` integer DEFAULT 0 NOT NULL CONSTRAINT `pinned_boolean` CHECK (`pinned` IN (0,1));
