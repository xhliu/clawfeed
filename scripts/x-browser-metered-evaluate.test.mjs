import vm from 'node:vm';
import assert from 'node:assert/strict';
import {meteredEvaluate} from './x-browser-metered-evaluate.mjs';
async function run(cap,failGuard=false){
 let debit=0,dispatch=0;
 const context=vm.createContext({Response,window:{fetch:async()=>{dispatch++;return new Response('{}',{status:200});}}});
 const result=await meteredEvaluate({fn:`async()=>{const pages=[];for(let i=0;i<3;i++){const r=await fetch('https://x.com/i/api/graphql/test');if(!r.ok)return {ok:false,pages,complete:false};pages.push(await r.json());}return {ok:true,pages,complete:true};}`,
 evaluate:async code=>vm.runInContext('('+code+')()',context),
 reserve:async()=>{if(debit>=cap)throw Error('budget');debit++;},
 guard:async()=>{if(failGuard)throw Error('identity');},sleep:async()=>{},timeoutMs:1000});
 return {result,debit,dispatch};
}
let a=await run(3);assert.equal(a.dispatch,3);assert.equal(a.debit,3);assert.equal(a.result.complete,true);
a=await run(1);assert.equal(a.dispatch,1);assert.equal(a.debit,1);assert.equal(a.result.pages.length,1);assert.equal(a.result.complete,false);
a=await run(3,true);assert.equal(a.dispatch,0);assert.equal(a.debit,0);assert.equal(a.result.complete,false);
console.log('browser bridge: per-fetch debit, denied remainder, retained partial pages, guard denial passed');
