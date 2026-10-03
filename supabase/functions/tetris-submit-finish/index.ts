import { createClient } from 'npm:@supabase/supabase-js@2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
const json=(value:unknown,status=200)=>new Response(JSON.stringify(value),{status,headers:{...headers,'Content-Type':'application/json'}});
Deno.serve(async request=>{
  if(request.method==='OPTIONS')return new Response('ok',{headers});
  if(request.method!=='POST')return json({error:'method_not_allowed'},405);
  const url=Deno.env.get('SUPABASE_URL'),publishable=Deno.env.get('SUPABASE_ANON_KEY'),secret=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!publishable||!secret)return json({error:'server_configuration'},503);
  const authorization=request.headers.get('Authorization');if(!authorization?.startsWith('Bearer '))return json({error:'unauthorized'},401);
  const caller=createClient(url,publishable,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
  const {data:user,error:authError}=await caller.auth.getUser();if(authError||!user.user)return json({error:'unauthorized'},401);
  try{
    const body=await request.json();const matchId=body.match_id;
    if(typeof matchId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(matchId))return json({error:'invalid_match'},400);
    // The user-scoped SELECT must authorize participation before using the admin client.
    const {data:match,error}=await caller.from('tetris_matches').select('id,status,resolve_after').eq('id',matchId).maybeSingle();
    if(error||!match)return json({error:'forbidden'},403);
    if(match.status!=='resolving'||!match.resolve_after)return json({status:match.status});
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,Math.min(200,Date.parse(match.resolve_after)-Date.now()+15))));
    const admin=createClient(url,secret,{auth:{persistSession:false,autoRefreshToken:false}});
    const result=await admin.rpc('tetris_finalize_match',{p_match_id:matchId});
    if(result.error)return json({error:'finalization_failed'},503);
    return json({status:'resolved'});
  }catch{return json({error:'invalid_request'},400);}
});
