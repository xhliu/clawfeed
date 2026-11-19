import fs from 'node:fs';import vm from 'node:vm';import assert from 'node:assert/strict';import {meteredEvaluate} from './x-browser-metered-evaluate.mjs';
const source=fs.readFileSync(new URL('./clawfeed-x-pipeline.mjs',import.meta.url),'utf8');
for(const [name,arg] of [['makeFetchFn',2],['makeFetchFollowingSearchFn',{pages:2,hours:1,query:'filter:follows',sliceMinutes:10,minSliceMinutes:1,pagesPerSlice:2,untilMs:Date.now()}],['makeFetchFollowingListFn',{pages:2}]]){
 const start=source.indexOf('function '+name+'('),end=source.indexOf('\nfunction ',start+1);
 const factory=vm.runInNewContext('('+source.slice(start,end)+')',{X_BEARER_FALLBACK:'fixture',HOME_QUERY_ID_FALLBACK:'fixture',SEARCH_QUERY_ID_FALLBACK:'fixture',FOLLOWING_QUERY_ID_FALLBACK:'fixture'});
 for(const denied of [false,true]){
 let charged=0,sent=0;const context=vm.createContext({Response,setTimeout:f=>{f();},location:{hostname:'x.com'},document:{scripts:[],cookie:'ct0=fixture; twid=u%3D123'},window:{fetch:async()=>{sent++;return new Response('blocked',{status:429});}}});
 const out=await meteredEvaluate({fn:factory(arg),evaluate:async code=>vm.runInContext('('+code+')()',context),guard:async()=>{},reserve:async()=>{if(denied)throw Error('expired');charged++;},sleep:async()=>{},timeoutMs:1000});
 assert.equal(sent,denied?0:1,name);assert.equal(charged,sent,name);if(denied)assert.equal(out.budgetDenied,true,name);
 }
 console.log(name+': real generated fetch admitted once; expired grant dispatches zero');
}
