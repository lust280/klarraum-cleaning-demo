import {createHmac,timingSafeEqual} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';

const SCOPE='https://www.googleapis.com/auth/calendar.events';
const TOKEN_URL='https://oauth2.googleapis.com/token';

export function googleConfigured(env={}){
  return Boolean(String(env.GOOGLE_CLIENT_ID||'').trim()&&String(env.GOOGLE_CLIENT_SECRET||'').trim());
}

export function googleRedirectUri(env,origin){
  const configured=String(env.GOOGLE_CALENDAR_REDIRECT_URI||env.redirectUri||'').trim();
  if(configured)return configured;
  return new URL('/api/google/calendar/callback',origin).href;
}

function sign(secret,message){return createHmac('sha256',secret).update(message).digest('base64url');}
function same(left,right){const a=Buffer.from(left),b=Buffer.from(right);return a.length===b.length&&timingSafeEqual(a,b);}

export function signGoogleState(secret,{companyId,returnTo,now}){
  if(!secret||!companyId||!returnTo)throw Object.assign(new Error('Google Calendar state is incomplete.'),{status:500});
  const payload=Buffer.from(JSON.stringify({returnTo,exp:now+10*60*1000})).toString('base64url');
  return `${companyId}.${payload}.${sign(secret,`${companyId}.${payload}`)}`;
}

export function readGoogleState(secret,state,now){
  const parts=String(state||'').split('.');
  if(parts.length!==3)throw Object.assign(new Error('Google Calendar returned an invalid state.'),{status:400});
  const [companyId,payload,signature]=parts;
  if(!same(signature,sign(secret,`${companyId}.${payload}`)))throw Object.assign(new Error('Google Calendar returned an invalid state.'),{status:400});
  let body;try{body=JSON.parse(Buffer.from(payload,'base64url').toString('utf8'));}catch{throw Object.assign(new Error('Google Calendar returned an invalid state.'),{status:400});}
  if(!body||body.exp<now||typeof body.returnTo!=='string')throw Object.assign(new Error('Google Calendar connection expired. Start it again.'),{status:400});
  return {companyId,returnTo:body.returnTo};
}

export function googleAuthorizationUrl({clientId,redirectUri,state}){
  const url=new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id',clientId);
  url.searchParams.set('redirect_uri',redirectUri);
  url.searchParams.set('response_type','code');
  url.searchParams.set('scope',SCOPE);
  url.searchParams.set('access_type','offline');
  url.searchParams.set('prompt','consent');
  url.searchParams.set('state',state);
  return url.toString();
}

async function postForm(fetchImpl,body){
  const response=await fetchImpl(TOKEN_URL,{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
  const data=await response.json().catch(()=>({}));
  if(!response.ok)throw Object.assign(new Error(data.error_description||'Google rejected the calendar connection.'),{status:502});
  return data;
}

export async function exchangeGoogleCode({clientId,clientSecret,code,redirectUri,fetchImpl}){
  const data=await postForm(fetchImpl,new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,redirect_uri:redirectUri,grant_type:'authorization_code'}));
  if(!data.refresh_token)throw Object.assign(new Error('Google did not return a refresh token. Remove KlarraumApp from the Google account and connect again.'),{status:502});
  return data;
}

export async function refreshGoogleAccess({clientId,clientSecret,refreshToken,fetchImpl}){
  const data=await postForm(fetchImpl,new URLSearchParams({client_id:clientId,client_secret:clientSecret,refresh_token:refreshToken,grant_type:'refresh_token'}));
  if(!data.access_token)throw Object.assign(new Error('Google did not refresh the calendar connection.'),{status:502});
  return data.access_token;
}

export function ensureGoogleTables(db){
  db.exec(`CREATE TABLE IF NOT EXISTS google_calendar(id INTEGER PRIMARY KEY CHECK(id=1),refresh_token TEXT NOT NULL,email TEXT NOT NULL DEFAULT '',connected_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS google_event_links(job_id TEXT PRIMARY KEY,event_id TEXT NOT NULL);`);
}

export function googleConnection(db){
  ensureGoogleTables(db);
  const row=db.prepare('SELECT email,connected_at FROM google_calendar WHERE id=1').get();
  return row?{connected:true,email:row.email,connectedAt:row.connected_at}:{connected:false,email:'',connectedAt:null};
}

export function saveGoogleConnection(db,{refreshToken,now}){
  ensureGoogleTables(db);
  db.prepare('INSERT INTO google_calendar(id,refresh_token,email,connected_at) VALUES(1,?,?,?) ON CONFLICT(id) DO UPDATE SET refresh_token=excluded.refresh_token,connected_at=excluded.connected_at').run(refreshToken,'',now);
}

export function clearGoogleConnection(db){
  ensureGoogleTables(db);
  db.prepare('DELETE FROM google_calendar').run();
  db.prepare('DELETE FROM google_event_links').run();
}

export function calendarEventBody({title,workerName,address,date,time,minutes,timeZone}){
  const [hour,minute]=time.split(':').map(Number);
  const total=hour*60+minute+Math.max(15,minutes||60);
  const shift=Math.floor(total/1440);
  const endMinutes=((total%1440)+1440)%1440;
  const endTime=`${String(Math.floor(endMinutes/60)).padStart(2,'0')}:${String(endMinutes%60).padStart(2,'0')}:00`;
  const endDate=new Date(`${date}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate()+shift);
  return {
    summary:title,
    location:address,
    description:workerName?`Worker: ${workerName}`:'',
    start:{dateTime:`${date}T${time}:00`,timeZone},
    end:{dateTime:`${endDate.toISOString().slice(0,10)}T${endTime}`,timeZone},
  };
}

export async function syncGoogleJobs({db,clientId,clientSecret,timeZone,fetchImpl,now=Date.now()}){
  ensureGoogleTables(db);
  const account=db.prepare('SELECT refresh_token FROM google_calendar WHERE id=1').get();
  if(!account)throw Object.assign(new Error('Connect Google Calendar before syncing jobs.'),{status:409});
  const access=await refreshGoogleAccess({clientId,clientSecret,refreshToken:account.refresh_token,fetchImpl});
  const jobs=db.prepare(`SELECT jobs.id,jobs.title,jobs.address,jobs.scheduled_date,jobs.scheduled_time,jobs.planned_minutes,jobs.state,employees.name AS worker_name
    FROM jobs JOIN employees ON employees.id=jobs.employee_id
    WHERE jobs.state IN ('assigned','working','paused') AND jobs.scheduled_time GLOB '[0-9][0-9]:[0-9][0-9]' LIMIT 100`).all();
  let copied=0;
  for(const job of jobs){
    const body=calendarEventBody({title:job.title,workerName:job.worker_name,address:job.address,date:job.scheduled_date,time:job.scheduled_time,minutes:job.planned_minutes,timeZone});
    const link=db.prepare('SELECT event_id FROM google_event_links WHERE job_id=?').get(job.id);
    const url=link?`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(link.event_id)}`:'https://www.googleapis.com/calendar/v3/calendars/primary/events';
    const response=await fetchImpl(url,{method:link?'PUT':'POST',headers:{authorization:`Bearer ${access}`,'content-type':'application/json'},body:JSON.stringify(body)});
    const data=await response.json().catch(()=>({}));
    if(!response.ok||!data.id)throw Object.assign(new Error('Google Calendar did not accept a job.'),{status:502});
    db.prepare('INSERT INTO google_event_links(job_id,event_id) VALUES(?,?) ON CONFLICT(job_id) DO UPDATE SET event_id=excluded.event_id').run(job.id,data.id);
    copied+=1;
  }
  return {copied,connectedAt:now};
}
