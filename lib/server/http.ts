import { AppError } from '../domain.ts';
export function checkOrigin(request:Request){if(request.headers.get('origin')!==new URL(request.url).origin)throw new AppError(403,'wrong_origin','请求来源不正确，请从网站页面操作');}
export async function readJson(request:Request):Promise<Record<string,unknown>>{
 if(!request.headers.get('content-type')?.toLowerCase().startsWith('application/json'))throw new AppError(400,'json_required','请发送 JSON 数据');
 const reader=request.body?.getReader();if(!reader)throw new AppError(400,'empty_body','请填写内容');
 const decoder=new TextDecoder();let text='',size=0;
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>8192){await reader.cancel();throw new AppError(413,'body_too_large','提交内容过大');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();
 let v;try{v=JSON.parse(text);}catch{throw new AppError(400,'bad_json','JSON 内容格式不正确');}
 if(!v||typeof v!=='object'||Array.isArray(v))throw new AppError(400,'bad_input','请填写有效内容');return v;
}
export function json(value:unknown,status=200){return Response.json(value,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});}
export function errorResponse(error:unknown){if(error instanceof AppError){const r=json({error:{code:error.code,message:error.message}},error.status);if(error.status===429)r.headers.set('Retry-After','60');return r;}console.error('MUSE request failed',error);return json({error:{code:'server_error',message:'服务暂时不可用，请稍后再试'}},500);}
