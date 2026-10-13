// Intentionally empty by default.
// Add Drizzle tables here when the site actually needs a database.
// See examples/d1/db/schema.ts for an opt-in example.
import { sql } from 'drizzle-orm';
import { sqliteTable,text,integer,index,uniqueIndex,check,primaryKey } from 'drizzle-orm/sqlite-core';

export const invites=sqliteTable('invites',{
  id:text('id').primaryKey(), code:text('code').notNull(), nickname:text('nickname').notNull().default(''),
  initialRemaining:integer('initial_remaining').notNull(), remaining:integer('remaining').notNull(),
  copiedCount:integer('copied_count').notNull().default(0), ownerHash:text('owner_hash').notNull(),
  createdAt:integer('created_at').notNull(), updatedAt:integer('updated_at').notNull(),
  reviewStatus:text('review_status').notNull().default('normal'), copyRevision:integer('copy_revision').notNull().default(0)
},t=>[uniqueIndex('invites_code_unique').on(t.code),index('invites_created').on(t.createdAt),
  check('remaining_bounds',sql`${t.remaining} BETWEEN 0 AND 30`),check('initial_bounds',sql`${t.initialRemaining} BETWEEN 0 AND 30`),
  check('review_states',sql`${t.reviewStatus} IN ('normal','pending','invalid')`)]);
export const claims=sqliteTable('claims',{
  operationId:text('operation_id').primaryKey(),inviteId:text('invite_id').notNull().references(()=>invites.id),
  visitorHash:text('visitor_hash').notNull(),copyRevision:integer('copy_revision').notNull(),
  status:text('status').notNull(),createdAt:integer('created_at').notNull(),expiresAt:integer('expires_at').notNull(),
  confirmedAt:integer('confirmed_at')
},t=>[index('claims_active').on(t.inviteId,t.status,t.expiresAt),index('claims_visitor').on(t.inviteId,t.visitorHash,t.confirmedAt),
 check('claim_states',sql`${t.status} IN ('reserved','confirming','confirmed','cancelled')`)]);
export const reports=sqliteTable('reports',{
  id:text('id').primaryKey(),inviteId:text('invite_id').notNull().references(()=>invites.id),visitorHash:text('visitor_hash').notNull(),
  reason:text('reason').notNull(),note:text('note').notNull().default(''),createdAt:integer('created_at').notNull(),resolved:integer('resolved').notNull().default(0)
},t=>[uniqueIndex('reports_one_visitor').on(t.inviteId,t.visitorHash),index('reports_queue').on(t.resolved,t.createdAt),
 check('report_reasons',sql`${t.reason} IN ('expired','incorrect','other')`)]);
export const rateLimits=sqliteTable('rate_limits',{
  key:text('key').notNull(),window:integer('window').notNull(),count:integer('count').notNull()
},t=>[primaryKey({columns:[t.key,t.window]}),index('rate_windows').on(t.window)]);
