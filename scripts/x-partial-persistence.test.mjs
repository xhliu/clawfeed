import fs from 'node:fs';import vm from 'node:vm';import os from 'node:os';import path from 'node:path';import assert from 'node:assert/strict';
const s=fs.readFileSync(new URL('./clawfeed-x-pipeline.mjs',import.meta.url),'utf8');
function caller(name,ctx){const start=s.indexOf('async function '+name+'('),end=s.indexOf('\n}',start)+2;return vm.runInNewContext('('+s.slice(start,end)+')',ctx);}
let writes=0;const result={ok:false,budgetDenied:true,complete:false,error:'expired',tweets:[{id:'1',authorHandle:'example',text:'saved',createdAt:'2026-11-19T12:00:00Z'}],pages:[{status:200}]};
const db={prepare:()=>({run:()=>{writes++;return {changes:1};}}),transaction:fn=>fn};
const home=caller('fetchTweets',{getDb:()=>db,getUser:()=>({id:1}),loadSourceMap:()=>new Map(),evaluateOnX:async()=>result,makeFetchFn:()=>'',normalizeIsoDate:x=>x,prepareOwnXTab:()=>{}});
const out=await home({});assert.equal(writes,1);assert.equal(out.ok,false);assert.equal(out.complete,false);assert.equal(out.storedChanges,1);
const dir=fs.mkdtempSync(path.join(os.tmpdir(),'following-partial-'));const dbPath=path.join(dir,'fixture.db');
const sync=caller('syncFollowingSources',{getDb:()=>({prepare(){throw Error('Authoritative DB mutation forbidden');}}),getUser:()=>({id:1}),fetchFollowingList:async()=>({...result,following:[{handle:'example'}]}),writeFileSync:fs.writeFileSync,renameSync:fs.renameSync,Date});
const follow=await sync({dbPath});const saved=JSON.parse(fs.readFileSync(follow.artifact));assert.equal(saved.complete,false);assert.equal(saved.following.length,1);assert.equal(follow.ok,false);console.log('actual Home caller persists admitted rows as incomplete; actual following caller persists partial artifact without subscription mutation');
