import vm from 'node:vm';
import assert from 'node:assert/strict';
import {meteredEvaluate} from './x-browser-metered-evaluate.mjs';

// Paced run: four fetches, each reservation consumes a 30s wall wait, but the WORK budget
// only drains during the in-page evaluate trips. Must complete, not time out.
async function pacedComplete() {
  let debits = 0;
  const context = vm.createContext({Response, window:{fetch:async()=>new Response('{}',{status:200})}});
  // now() advances only by the amount we pass to sleep as "work"; pacing waits happen outside.
  let t = 0;
  const now = () => t;
  const result = await meteredEvaluate({
    fn: `async()=>{const pages=[];for(let i=0;i<4;i++){const r=await fetch('https://x.com/endpoint');if(!r.ok)return {ok:false,pages,complete:false};pages.push(await r.json());}return {ok:true,pages,complete:true};}`,
    evaluate: async code => { t += 500; return vm.runInContext('('+code+')()', context); },
    reserve: async () => { debits++; },                    // no wait budget here
    guard: async () => {},                                  // no wait budget here
    sleep: async () => {},                                  // pacing handled inside reserve in real code
    timeoutMs: 8000,
    now,
  });
  assert.equal(result.complete, true, JSON.stringify(result));
  assert.equal(result.pages.length, 4);
  assert.equal(debits, 4);
}

// Work-time budget still enforces a genuine stall: never mark done within budget -> timeout.
async function stallsOut() {
  let t = 0;
  const context = vm.createContext({Response, window:{fetch:async()=>new Response('{}',{status:200})}});
  const now = () => t;
  await assert.rejects(
    meteredEvaluate({ fn: '(async()=>new Promise(()=>{}))', evaluate: async code => { t += 5000; return vm.runInContext('('+code+')()', context); }, reserve: async()=>{}, guard: async()=>{}, sleep: async()=>{}, timeoutMs: 1000, now }),
    /Metered browser request timed out/
  );
}

await pacedComplete();
await stallsOut();
console.log('PASS: paced work-budget completes; genuine stall still times out');
