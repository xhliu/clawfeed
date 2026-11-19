// Each attempt must reserve independently; denied attempts never dispatch.
export async function dispatchChargedRequest({reserve,dispatch,request,retries=0,retryable=()=>false}) {
  for(let attempt=0;;attempt++) {
    await reserve({...request,attempt});
    try {return await dispatch(request,attempt);}
    catch(error){if(attempt>=retries || !retryable(error))throw error;}
  }
}
export async function dispatchChargedBatch({requests,...options}) {
  const results=[];
  for(const request of requests){
    try {results.push(await dispatchChargedRequest({...options,request}));}
    catch(error){return {complete:false,results,error:String(error.message)};}
  }
  return {complete:true,results};
}
