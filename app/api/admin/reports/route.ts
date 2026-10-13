import {handle,requireAdmin} from '@/lib/server/route';import {json} from '@/lib/server/http';import {listReports} from '@/lib/server/report-repository';
export const dynamic='force-dynamic';
export async function GET(request:Request){return handle(request,async({db,secret})=>{await requireAdmin(request,secret);return json({reports:await listReports(db)});});}
