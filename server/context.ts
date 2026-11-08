import { expand, type Card } from './cards.js';
export interface Message {role:'system'|'user'|'assistant';content:string}
export function buildContext(card:Card,history:Message[],input:string,budget=8192,reserve=1024){
 const data=card.data;
 const scan=[...history.slice(-6).map(m=>m.content),input].join('\n');
 const entries=(data.character_book?.entries??[]).filter(e=>e.enabled&&(e.constant||e.keys.some(k=>k.length>0&&(e.case_sensitive?scan.includes(k):scan.toLowerCase().includes(k.toLowerCase())))));
 const text=[data.system_prompt,data.description,data.personality,data.scenario,...entries.map(e=>e.content)].filter(Boolean).join('\n\n');
 const system:Message={role:'system',content:expand(text,data.name)};
 const tail:Message[]=[{role:'user',content:input}];
 if(data.post_history_instructions) tail.push({role:'system',content:expand(data.post_history_instructions,data.name)});
 const recent=history.map(m=>({...m,content:expand(m.content,data.name)}));
 const estimate=(messages:Message[])=>messages.reduce((n,m)=>n+Buffer.byteLength(m.content,'utf8')+8,0);
 while(recent.length&&estimate([system,...recent,...tail])+reserve>budget) {
  recent.shift();
  while(recent[0]?.role==='assistant') recent.shift();
 }
 const messages=[system,...recent,...tail];
 const estimatedTokens=estimate(messages);
 if(estimatedTokens+reserve>budget) throw new Error('角色与输入超出预算，请缩短输入或提高上下文预算');
 return {messages,estimatedTokens,budget,reserve,omitted:history.length-recent.length,matchedEntries:entries.length,estimation:'UTF-8 字节数加消息开销的保守估算'};
}

