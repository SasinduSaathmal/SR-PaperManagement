export async function inviteAccount(client,values,fetcher=globalThis.fetch){
 const {data,error}=await client.auth.getSession();
 if(error||!data.session?.access_token)throw Error("Sign in again before inviting a marker.");
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
 try{
  const response=await fetcher('/api/admin/invite',{method:'POST',headers:{Authorization:`Bearer ${data.session.access_token}`,'Content-Type':'application/json'},body:JSON.stringify(values),signal:controller.signal});
  let result;try{result=await response.json();}catch{throw Error("The invitation service is unavailable. Refresh the website and try again.");}
  if(!response.ok)throw Error(result.error||"Could not invite this account.");
  return result;
 }catch(e){throw Error(controller.signal.aborted?"Invitation timed out. Retry without changing the form, then refresh accounts to check.":e.message);}
 finally{clearTimeout(timer);}
}
