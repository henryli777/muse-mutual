import { runtime } from './runtime';
import { getVisitor,isAdmin } from './identity.ts';import {checkOrigin,errorResponse} from './http.ts';import {AppError} from '../domain.ts';
export type Context=ReturnType<typeof runtime>&{visitorHash:string};
export async function handle(request:Request,action:(ctx:Context)=>Promise<Response>){
 try{if(request.method!=='GET')checkOrigin(request);const e=runtime();const visitor=await getVisitor(request,e.secret);const response=await action({...e,visitorHash:visitor.hash});if(visitor.setCookie)response.headers.append('Set-Cookie',visitor.setCookie);return response;}
 catch(error){return errorResponse(error);}
}
export async function requireAdmin(request:Request,secret:string){if(!await isAdmin(request,secret))throw new AppError(401,'admin_required','请先登录维护入口');}
