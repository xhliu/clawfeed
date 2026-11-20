import {dispatchChargedRequest} from './x-request-dispatch.mjs';
// Credentials and request bodies remain inside the owned page. Only URL/sequence cross the bridge.
// timeoutMs is a WORK budget across the in-page bridge round-trips. Mandatory shared pacing and
// reservation waits re-read the grant/ledger each time and are NOT charged to this budget, so a modest
// number of spaced requests no longer times out mid-run. Expiry/revocation/cap are enforced on every
// reservation, not by this timer.
export async function meteredEvaluate({fn,evaluate,reserve,guard,sleep,timeoutMs=120000,now=Date.now}) {
  const key='__clawfeedMeter_'+Math.random().toString(36).slice(2);
  await evaluate(`()=>{const job={done:false,seq:0,pending:null};window[${JSON.stringify(key)}]=job;const nativeFetch=window.fetch.bind(window);const fetch=async(...args)=>{const seq=++job.seq;const allowed=await new Promise(resolve=>{job.pending={seq,url:String(args[0]?.url||args[0])};job.resolve=resolve;});if(!allowed)return new Response('Scoped request grant or budget denied',{status:429});return nativeFetch(...args);};Promise.resolve().then(()=>(${fn})()).then(result=>{job.result=result;job.done=true;},error=>{job.error=String(error.message);job.done=true;});return true;}`);
  let refusal=null;
  let workLeft=timeoutMs;
  try {
    for (;;) {
      if (workLeft <= 0) throw Error('Metered browser request timed out');
      const stepStart=now();
      const state=await evaluate(`()=>{const j=window[${JSON.stringify(key)}];return j?{done:j.done,pending:j.pending,result:j.result,error:j.error}:null;}`);
      workLeft-=now()-stepStart;
      if(!state)throw Error('Owned request context disappeared');
      if(state.done){if(state.error)throw Error(state.error);return refusal?{...state.result,ok:false,complete:false,rateLimited:true,budgetDenied:true,error:refusal}:state.result;}
      if(state.pending){
        try {
          if(refusal)throw Error(refusal);
          await guard();
          await dispatchChargedRequest({request:state.pending,reserve,dispatch:async request=>evaluate(`()=>{const j=window[${JSON.stringify(key)}];if(!j||j.pending?.seq!==${state.pending.seq})throw Error('Request sequence changed');const resolve=j.resolve;j.pending=null;j.resolve=null;resolve(true);return true;}`)});
        }catch(error){refusal=String(error.message);await evaluate(`()=>{const j=window[${JSON.stringify(key)}];if(j?.resolve){const r=j.resolve;j.pending=null;j.resolve=null;r(false);}return true;}`);}
      }
      await sleep(50);
    }
  } finally {await evaluate(`()=>{const j=window[${JSON.stringify(key)}];if(j?.resolve)j.resolve(false);delete window[${JSON.stringify(key)}];return true;}`).catch(()=>{});}
}
