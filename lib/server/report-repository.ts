import {AppError} from '../domain.ts';import type {ReportReason} from '../domain.ts';import {getInvite} from './invite-repository.ts';
export async function submitReport(db:D1Database,input:{inviteId:string;visitorHash:string;reason:ReportReason;note:string},now:number){
 if(!['expired','incorrect','other'].includes(input.reason))throw new AppError(400,'invalid_reason','请选择反馈原因');
 if(typeof input.note!=='string'||input.note.length>500)throw new AppError(400,'invalid_note','补充说明最多500字');
 await getInvite(db,input.inviteId);
 await db.batch([
 db.prepare(`INSERT INTO reports(id,invite_id,visitor_hash,reason,note,created_at,resolved) VALUES(?,?,?,?,?,?,0)
 ON CONFLICT(invite_id,visitor_hash) DO UPDATE SET reason=excluded.reason,note=excluded.note,created_at=excluded.created_at,resolved=0 WHERE reports.resolved=1`).bind(crypto.randomUUID(),input.inviteId,input.visitorHash,input.reason,input.note.trim(),now),
 db.prepare("UPDATE invites SET review_status='pending' WHERE id=? AND review_status!='invalid' AND EXISTS(SELECT 1 FROM reports WHERE invite_id=invites.id AND resolved=0)").bind(input.inviteId)
 ]);return getInvite(db,input.inviteId);
}
export async function reviewInvite(db:D1Database,id:string,action:'invalidate'|'restore',now:number){
 await getInvite(db,id);
 if(action==='invalidate')await db.prepare("UPDATE invites SET review_status='invalid',copy_revision=copy_revision+1,updated_at=? WHERE id=?").bind(now,id).run();
 else if(action==='restore')await db.batch([db.prepare('UPDATE reports SET resolved=1 WHERE invite_id=?').bind(id),db.prepare("UPDATE invites SET review_status='normal',updated_at=? WHERE id=?").bind(now,id)]);
 else throw new AppError(400,'invalid_action','请选择失效或恢复');return getInvite(db,id);
}
export interface ReportRow {id:string;inviteId:string;code:string;nickname:string;remaining:number;reviewStatus:string;reason:string;note:string;createdAt:number}
export async function listReports(db:D1Database){const {results}=await db.prepare(`SELECT r.id,r.invite_id AS inviteId,i.code,i.nickname,i.remaining,i.review_status AS reviewStatus,r.reason,r.note,r.created_at AS createdAt FROM reports r JOIN invites i ON i.id=r.invite_id WHERE r.resolved=0 ORDER BY r.created_at DESC LIMIT 200`).all<ReportRow>();return results.map(v=>({...v,createdAt:new Date(v.createdAt*1000).toISOString()}));}
