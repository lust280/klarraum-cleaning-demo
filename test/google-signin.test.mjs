import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request as httpRequest} from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDirector,directorConfig} from '../director.mjs';
import {hashPassword} from '../lib/security.mjs';
import {googleSigninUrl,readSignupState,signinRedirectUri,signSignupState} from '../lib/google-signin.mjs';
import {googleAuthorizationUrl} from '../lib/google-calendar.mjs';

test('google sign-in state is separate from the calendar scope',()=>{
 const now=Date.now();
 const state=signSignupState('director-secret',{plan:'plus',exp:now+1000});
 assert.deepEqual(readSignupState('director-secret',state,now),{plan:'plus'});
 assert.throws(()=>readSignupState('other-secret',state,now),/invalid state/);
 assert.throws(()=>readSignupState('director-secret',state,now+5000),/expired/);
 assert.throws(()=>signSignupState('director-secret',{plan:'custom',exp:now+1000}),/public plan/);
 const url=googleSigninUrl({clientId:'client-id',redirectUri:'https://platform.klarraumapp.com/api/google/signup/callback',state});
 assert.match(url,/openid%20email%20profile|openid\+email\+profile/);
 assert.equal(url.includes('calendar.events'),false);
 assert.equal(url.includes('client-secret'),false);
 assert.match(url,/accounts\.google\.com/);
 const calendar=googleAuthorizationUrl({clientId:'client-id',redirectUri:'https://platform.klarraumapp.com/api/google/calendar/callback',state:'local.payload.sig'});
 assert.match(calendar,/calendar\.events/);
 assert.equal(signinRedirectUri({GOOGLE_SIGNIN_REDIRECT_URI:' https://klarraumapp.com/api/google/signup/callback '},'https://platform.klarraumapp.com'),'https://klarraumapp.com/api/google/signup/callback');
 assert.equal(signinRedirectUri({},'https://platform.klarraumapp.com'),'https://platform.klarraumapp.com/api/google/signup/callback');
 assert.equal(signinRedirectUri({GOOGLE_SIGNIN_REDIRECT_URI:'https://platform.klarraumapp.com/api/google/signup/callback'},'https://example.onrender.com','klarraumapp.com'),'https://klarraumapp.com/api/google/signup/callback');
 assert.equal(signinRedirectUri({GOOGLE_SIGNIN_REDIRECT_URI:'https://klarraumapp.com/api/google/signup/callback'},'https://example.onrender.com','platform.klarraumapp.com'),'https://platform.klarraumapp.com/api/google/signup/callback');
 assert.equal(signinRedirectUri({},'https://example.onrender.com','example.onrender.com, klarraumapp.com'),'https://klarraumapp.com/api/google/signup/callback');
});

test('director console groups the six plans and hides company creation',async()=>{
 const html=await readFile(new URL('../director-public/index.html',import.meta.url),'utf8');
 const script=await readFile(new URL('../director-public/director.js',import.meta.url),'utf8');
 assert.equal(html.includes('Create company'),false);
 assert.equal(html.includes('id="create-form"'),false);
 assert.equal(html.includes('Create empty installation'),false);
 for(const name of ['Solo','Starter','Team','Business','Scale','Plus'])assert.match(script,new RegExp(`'${name}'`));
 assert.match(script,/plan-count/);
 assert.match(script,/cataloguePlans/);
});

test('choosing Plus and continuing with Google opens the owner cabinet',async t=>{
 const saved={id:process.env.GOOGLE_CLIENT_ID,secret:process.env.GOOGLE_CLIENT_SECRET};
 t.after(()=>{
  if(saved.id===undefined)delete process.env.GOOGLE_CLIENT_ID;else process.env.GOOGLE_CLIENT_ID=saved.id;
  if(saved.secret===undefined)delete process.env.GOOGLE_CLIENT_SECRET;else process.env.GOOGLE_CLIENT_SECRET=saved.secret;
 });
 delete process.env.GOOGLE_CLIENT_ID;delete process.env.GOOGLE_CLIENT_SECRET;
 const directory=await mkdtemp(join(tmpdir(),'klarraum-google-signup-'));
 const passwordHash=await hashPassword('director-test-password-only');
 const fetcher=async url=>{
  const target=String(url);
  if(target.includes('oauth2.googleapis.com/token'))return {ok:true,json:async()=>({access_token:'access-token'})};
  if(target.includes('userinfo'))return {ok:true,json:async()=>({sub:'google-sub-plus',email:'owner@example.test',email_verified:true,name:'Plus Owner'})};
  return {ok:false,status:500,json:async()=>({})};
 };
 const config={...directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:directory}),fetcher};
 const director=createDirector(config);
 await new Promise(resolve=>director.server.listen(0,'127.0.0.1',resolve));
 const port=director.server.address().port;
 t.after(async()=>{await director.close();await rm(directory,{recursive:true,force:true});});
 function request(path,{host='director.localhost:3100',method='GET',body}={}){
  return new Promise((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port,path,method,headers:{Host:host,Origin:'http://'+host,'Content-Type':'application/json'}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
     const text=Buffer.concat(chunks).toString();
     resolve({status:res.statusCode,location:res.headers.location||'',cookie:res.headers['set-cookie']?.[0]?.split(';')[0]||'',data:res.headers['content-type']?.includes('json')?JSON.parse(text):text});
    });
   });
   req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
 }
 const hidden=await request('/api/google/signup/status');
 assert.equal(hidden.status,200);assert.equal(hidden.data.enabled,false);
 const blocked=await request('/api/google/signup/start?plan=plus');
 assert.equal(blocked.status,404);assert.match(blocked.data.error,/not configured/);
 process.env.GOOGLE_CLIENT_ID='client-id';process.env.GOOGLE_CLIENT_SECRET='client-secret';
 assert.equal((await request('/api/google/signup/status')).data.enabled,true);
 assert.equal((await request('/api/google/signup/start?plan=custom')).status,400);
 const start=await request('/api/google/signup/start?plan=plus');
 assert.equal(start.status,302);
 assert.match(start.location,/accounts\.google\.com/);
 assert.equal(start.location.includes('client-secret'),false);
 assert.match(start.location,/openid/);
 const state=new URL(start.location).searchParams.get('state');
 const callback=await request('/api/google/signup/callback?code=auth-code&state='+encodeURIComponent(state));
 assert.equal(callback.status,302);
 assert.match(callback.location,/\/admin\.html#google=/);
 const companyUrl=new URL(callback.location);
 const token=new URLSearchParams(companyUrl.hash.slice(1)).get('google');
 assert.match(token,/^[\w-]{43}$/);
 const login=await director.store.list();
 assert.equal(login.length,1);
 assert.equal(login[0].plan_key,'plus');
 assert.equal(login[0].base_cents,25900);
 assert.equal(login[0].included,25);
 assert.equal(login[0].seat_cents,800);
 assert.equal(login[0].payment,'trial');
 assert.ok(login[0].password_hash);
 assert.equal(login[0].google_sub,'google-sub-plus');
 const host=companyUrl.host;
 const bad=await request('/api/admin/google-session',{host,method:'POST',body:{token:'a'.repeat(43)}});
 assert.equal(bad.status,400);
 const session=await request('/api/admin/google-session',{host,method:'POST',body:{token}});
 assert.equal(session.status,200);
 assert.match(session.cookie,/klarraum_session=/);
 assert.ok(session.data.csrf);
 const again=await request('/api/google/signup/start?plan=solo');
 const againState=new URL(again.location).searchParams.get('state');
 const returning=await request('/api/google/signup/callback?code=auth-code&state='+encodeURIComponent(againState));
 assert.equal(returning.status,302);
 assert.equal(director.store.list().length,1);
 assert.equal(director.store.company(login[0].id).plan_key,'plus');
 const previewDir=await mkdtemp(join(tmpdir(),'klarraum-google-preview-'));
 const preview=createDirector({...directorConfig({DIRECTOR_PASSWORD_HASH:passwordHash,DIRECTOR_DATA_DIR:previewDir,PLATFORM_PATH_PREVIEW:'true'}),fetcher:async url=>{
  const target=String(url);
  if(target.includes('oauth2.googleapis.com/token'))return {ok:true,json:async()=>({access_token:'access-token'})};
  if(target.includes('userinfo'))return {ok:true,json:async()=>({sub:'google-sub-preview',email:'preview@example.test',email_verified:true,name:'Preview Owner'})};
  return {ok:false,status:500,json:async()=>({})};
 }});
 await new Promise(resolve=>preview.server.listen(0,'127.0.0.1',resolve));
 const previewPort=preview.server.address().port;
 t.after(async()=>{await preview.close();await rm(previewDir,{recursive:true,force:true});});
 function previewRequest(path,{method='GET',body,cookie,csrf}={}){
  return new Promise((resolve,reject)=>{
   const req=httpRequest({hostname:'127.0.0.1',port:previewPort,path,method,headers:{Host:'director.localhost:3100',Origin:'http://director.localhost:3100','Content-Type':'application/json',...(cookie?{Cookie:cookie}:{}),...(csrf?{'X-CSRF-Token':csrf}:{})}},res=>{
    const chunks=[];res.on('data',chunk=>chunks.push(chunk));res.on('end',()=>{
     const text=Buffer.concat(chunks).toString();
     resolve({status:res.statusCode,location:res.headers.location||'',cookie:res.headers['set-cookie']?.[0]||'',data:res.headers['content-type']?.includes('json')?JSON.parse(text):text});
    });
   });
   req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));
  });
 }
 const previewStart=await previewRequest('/api/google/signup/start?plan=plus');
 const previewState=new URL(previewStart.location).searchParams.get('state');
 const previewBack=await previewRequest('/api/google/signup/callback?code=auth-code&state='+encodeURIComponent(previewState));
 assert.equal(previewBack.status,302);
 assert.match(previewBack.location,/\/companies\/[a-f0-9-]+\/admin\.html#google=/);
 const previewUrl=new URL(previewBack.location),previewToken=new URLSearchParams(previewUrl.hash.slice(1)).get('google'),companyId=previewUrl.pathname.split('/')[2];
 const signed=await previewRequest(`/companies/${companyId}/api/admin/google-session`,{method:'POST',body:{token:previewToken}});
 assert.equal(signed.status,200);
 assert.match(signed.cookie,new RegExp('klarraum_company_'+companyId+'_session='));
 const ownerCookie=signed.cookie.split(';')[0];
 const cabinet=await previewRequest(`/companies/${companyId}/api/admin/session`,{cookie:ownerCookie});
 assert.equal(cabinet.status,200);
 const support=await previewRequest(`/companies/${companyId}/api/platform-support`,{cookie:ownerCookie});
 assert.equal(support.status,200);
 const planCard=await previewRequest(`/companies/${companyId}/api/platform-plan`,{cookie:ownerCookie});
 assert.equal(planCard.status,200);
 assert.equal(planCard.data.planKey,'plus');
 const page=await readFile(new URL('../director-public/platform.html',import.meta.url),'utf8');
 const script=await readFile(new URL('../director-public/showcase.js',import.meta.url),'utf8');
 assert.match(page,/data-choose-plan="plus"/);
 assert.match(script,/\/api\/google\/signup\/status/);
 assert.equal(page.includes('Sign in with Google'),false);
});
