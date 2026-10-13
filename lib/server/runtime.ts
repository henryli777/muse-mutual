import { env } from 'cloudflare:workers';
import { AppError } from '../domain.ts';
export function runtime(){
 const e=env as unknown as {DB?:D1Database;MUSE_SESSION_SECRET?:string;MUSE_ADMIN_TOKEN?:string};
 if(!e.DB||!e.MUSE_SESSION_SECRET)throw new AppError(503,'unconfigured','服务正在准备，请稍后再试');
 return {db:e.DB,secret:e.MUSE_SESSION_SECRET,adminToken:e.MUSE_ADMIN_TOKEN??''};
}
