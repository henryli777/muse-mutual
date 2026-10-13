import {handle} from '@/lib/server/route';import {json,readJson} from '@/lib/server/http';
import {hash} from '@/lib/server/identity';import {rateLimit} from '@/lib/server/rate-limit';
import {createInvite,listInvites} from '@/lib/server/invite-repository';import {validateSubmission} from '@/lib/domain';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(request,async({db})=>{const p=new URL(request.url).searchParams;return json({invites:await listInvites(db,{sort:p.get('sort')??'latest',filter:p.get('filter')??'available'})});});}
export async function POST(request:Request){return handle(request,async({db,visitorHash})=>{const input=validateSubmission(await readJson(request));await rateLimit(db,'share:'+visitorHash,10,3600);const ownerToken=crypto.randomUUID()+crypto.randomUUID();const invite=await createInvite(db,input,await hash(ownerToken),Math.floor(Date.now()/1000));return json({invite,ownerToken},201);});}
