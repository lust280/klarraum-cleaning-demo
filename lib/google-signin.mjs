import {createHmac,timingSafeEqual} from 'node:crypto';
import {googleConfigured} from './google-calendar.mjs';

const SCOPE='openid email profile';
const TOKEN_URL='https://oauth2.googleapis.com/token';
export const signupPlans=['solo','starter','team','growth','business','plus'];
const signupOrigins={
  'klarraumapp.com':'https://klarraumapp.com',
  'www.klarraumapp.com':'https://klarraumapp.com',
  'platform.klarraumapp.com':'https://platform.klarraumapp.com',
};

function hostName(value){return String(value||'').trim().toLowerCase().replace(/:\d+$/,'').split(',')[0].trim();}

export function signinRedirectUri(env,origin,hosts=''){
  for(const value of String(hosts||'').split(',')){
    const known=signupOrigins[hostName(value)];
    if(known)return new URL('/api/google/signup/callback',known).href;
  }
  const configured=String(env.GOOGLE_SIGNIN_REDIRECT_URI||'').trim();
  if(configured)return configured;
  return new URL('/api/google/signup/callback',origin).href;
}

function mac(secret,message){return createHmac('sha256',secret).update(message).digest('base64url');}
function same(left,right){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}

export function signSignupState(secret,{plan,exp}){
  if(!signupPlans.includes(plan))throw Object.assign(new Error('Choose a public plan.'),{status:400});
  const payload=Buffer.from(JSON.stringify({plan,exp})).toString('base64url');
  return `${payload}.${mac(secret,payload)}`;
}

export function readSignupState(secret,state,now){
  const parts=String(state||'').split('.');
  if(parts.length!==2||!same(parts[1],mac(secret,parts[0])))throw Object.assign(new Error('Google sign-in returned an invalid state.'),{status:400});
  let body;try{body=JSON.parse(Buffer.from(parts[0],'base64url').toString('utf8'));}catch{throw Object.assign(new Error('Google sign-in returned an invalid state.'),{status:400});}
  if(!signupPlans.includes(body?.plan)||!(body.exp>now))throw Object.assign(new Error('Google sign-in expired. Choose the plan again.'),{status:400});
  return {plan:body.plan};
}

export function googleSigninUrl({clientId,redirectUri,state}){
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',clientId);
  url.searchParams.set('redirect_uri',redirectUri);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',SCOPE);
  url.searchParams.set('prompt','select_account');
  url.searchParams.set('state',state);
  return url.toString();
}

export async function exchangeSigninCode({clientId,clientSecret,code,redirectUri,fetchImpl}){
  const response=await fetchImpl(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'})});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||!data.access_token)throw Object.assign(new Error('Google did not confirm this sign-in.'),{status:502});
  return data.access_token;
}

export async function googleProfile(accessToken,fetchImpl){
  const response=await fetchImpl('https://openidconnect.googleapis.com/v1/userinfo',{headers:{authorization:`Bearer ${accessToken}`}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok||typeof data.sub!=='string'||typeof data.email!=='string'||!data.email_verified)throw Object.assign(new Error('Google did not share a verified email.'),{status:502});
  const name=String(data.name||data.email.split('@')[0]||'Owner').replace(/[\x00-\x1f\x7f]/g,'').trim().slice(0,80);
  return {sub:data.sub,email:data.email.toLowerCase(),name:name||'Owner'};
}

export {googleConfigured};
