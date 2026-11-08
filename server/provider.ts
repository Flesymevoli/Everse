import type { Message } from './context.js';
export interface Config{baseUrl:string;apiKey:string;model:string;mock:boolean}
export async function* generate(config:Config,messages:Message[],maxTokens:number):AsyncGenerator<string>{
 if(config.mock){for(const part of ['【模拟回复】','远处的灯亮了。','你想走近看看吗？']){await new Promise(r=>setTimeout(r,40));yield part;}return;}
 const url=new URL(config.baseUrl.replace(/\/$/,'')+'/chat/completions');
 if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('API 地址无效');
 const response=await fetch(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(90000),headers:{'Content-Type':'application/json',...(config.apiKey?{Authorization:'Bearer '+config.apiKey}:{})},body:JSON.stringify({model:config.model,messages,stream:true,max_tokens:maxTokens})});
 if(!response.ok||!response.body)throw new Error('模型请求失败，HTTP '+response.status);
 let buffer='';let done=false;
 for await(const chunk of response.body.pipeThrough(new TextDecoderStream())){
  buffer+=chunk;
  let end:number;
  while((end=buffer.indexOf('\n'))>=0){
   const line=buffer.slice(0,end).trim();buffer=buffer.slice(end+1);
   if(!line.startsWith('data:'))continue;
   const data=line.slice(5).trim();
   if(data==='[DONE]'){done=true;continue;}
   const value=JSON.parse(data) as {choices?:{delta?:{content?:unknown};finish_reason?:string}[];error?:unknown};
   if(value.error)throw new Error('模型返回错误');
   const choice=value.choices?.[0];
   if(choice?.finish_reason==='length')throw new Error('回复达到输出上限，请提高预算后重试');
   if(choice?.finish_reason==='stop')done=true;
   if(typeof choice?.delta?.content==='string')yield choice.delta.content;
  }
 }
 if(!done)throw new Error('模型流意外中断');
}

