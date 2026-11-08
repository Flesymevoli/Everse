import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {importCard} from '../server/cards.js';
import {buildContext} from '../server/context.js';
import {Store} from '../server/store.js';
import {createApp} from '../server/app.js';
const fixture={spec:'chara_card_v3',spec_version:'3.0',data:{name:'灯',first_mes:'你好',alternate_greetings:['第二开场'],character_book:{entries:[{keys:['塔'],content:'秘密'}]}}};
test('校验卡片并公开不支持字段',()=>{assert.throws(()=>importCard({}));assert.ok(importCard(fixture).warnings.some(w=>w.includes('alternate_greetings')));});
test('关键词和预算不会改变原历史',()=>{const {card}=importCard(fixture);const history=[{role:'assistant' as const,content:'原文'.repeat(2000)}];const p=buildContext(card,history,'塔',2048,512);assert.equal(p.matchedEntries,1);assert.equal(p.omitted,1);assert.equal(history.length,1);assert.throws(()=>buildContext(card,[],'x'.repeat(3000),2048,512));});
test('导入、开局、模拟流、重启 SQLite 恢复',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'narrative-'));const path=join(dir,'game.sqlite');let store=new Store(path);
 try{
 const app=createApp(store);
 const post=(url:string,value:unknown)=>app.request(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(value)});
 const card=await (await post('/api/cards',fixture)).json() as {id:string};
 const session=await (await post('/api/sessions',{cardId:card.id})).json() as {id:string};
 const r=await post('/api/sessions/'+session.id+'/turn',{input:'去塔',config:{baseUrl:'http://127.0.0.1:1/v1',apiKey:'',model:'mock',mock:true}});
 const text=await r.text();assert.match(text,/"type":"done"/);assert.match(text,/"type":"prompt"/);
 store.close();store=new Store(path);const saved=store.session(session.id);assert.equal(saved.messages.length,3);assert.equal(saved.messages[1].content,'去塔');
 }finally{store.close();rmSync(dir,{recursive:true,force:true});}
});

