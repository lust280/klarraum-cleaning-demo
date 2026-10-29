import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApplication } from './lib/application.mjs';
import { createDirector } from './director.mjs';
import { loadConfig } from './lib/config.mjs';

export function createServerApp(config = loadConfig(), options = {}) {
  // The public root is a US-facing fictional demo. Tenant installations carry
  // their own selected locale in their path-scoped configuration.
  if (config.demoMode && !config.basePath) {
    config.timeZone='America/New_York';
    config.currency='USD';
    config.business={...config.business,postcodes:[]};
  }
  let director;
  const activeRequests=new Set();
  const app = createApplication(config, {...options,isMaintenance:()=>Boolean(director?.maintenance)});
  async function quiesce(exclude){const until=Date.now()+15000;while([...activeRequests].some(item=>item!==exclude)){if(Date.now()>until)throw new Error('Active requests did not finish.');await new Promise(r=>setTimeout(r,25));}await app.drain();}
  const directorPaths=new Set(['/director.html','/director.js','/director.css','/director-applications.js','/director-finance.js','/director-i18n.js','/director-backup.js','/for-companies.html','/pricing.html','/platform-privacy.html','/platform-terms.html','/cookies.html','/platform-impressum.html','/trial-activate.html','/platform.css','/sales.css','/platform.js','/showcase.js','/plans.mjs','/trial-activate.js','/api/google/calendar/callback','/api/google/signup/status','/api/google/signup/start','/api/google/signup/callback']);
  const root = fileURLToPath(new URL('./public/', import.meta.url));
  const types = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.svg':'image/svg+xml'};
  const server = createServer(async (req, res) => {
    const headers = {
      'X-Content-Type-Options':'nosniff', 'Referrer-Policy':'strict-origin-when-cross-origin',
      'X-Frame-Options':'DENY', 'Permissions-Policy':'camera=(), microphone=(), geolocation=()',
      'Cross-Origin-Opener-Policy':'same-origin', 'Cross-Origin-Resource-Policy':'same-origin',
      'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'; form-action 'self'",
      'Cache-Control':'no-store',
    };
    if (config.secureCookie) headers['Strict-Transport-Security'] = 'max-age=31536000';
    for (const [name,value] of Object.entries(headers)) res.setHeader(name,value);
    try {
      const url = new URL(req.url, config.origin);
      if(director?.maintenance&&url.pathname!=='/healthz'){res.writeHead(503,{'Content-Type':'application/json'});return res.end(JSON.stringify({error:'Backup maintenance in progress. Retry shortly.'}));}
      activeRequests.add(res);res.once('finish',()=>activeRequests.delete(res));res.once('close',()=>activeRequests.delete(res));
      // The custom production domain represents the platform. Keep the
      // fictional cleaning-company page available inside tenant workspaces,
      // but never use it as the public landing page or search result.
      if(config.demoMode&&!config.basePath&&url.origin==='https://klarraumapp.com'&&url.pathname==='/'&&['GET','HEAD'].includes(req.method)){
        res.writeHead(308,{Location:'/for-companies.html','Cache-Control':'no-store'});return res.end();
      }
      if(config.demoMode&&!config.directorDisabled&&!config.basePath&&config.passwordHash&&(directorPaths.has(url.pathname)||url.pathname.startsWith('/api/director/')||url.pathname.startsWith('/api/platform/')||url.pathname.startsWith('/companies/'))){
        director ||= createDirector({origin:config.origin,domain:'companies.localhost',passwordHash:config.passwordHash,dataDir:config.directorDataDir||resolve(config.dbPath,'..','director'),maxRunning:5,mountedDemo:true,quiesce,legacyDataDir:resolve(config.dbPath,'..'),legacyRuntime:{...config,dbPath:undefined,directorDataDir:undefined}});
        if(url.pathname==='/director.html')req.url='/';
        return director.server.emit('request',req,res);
      }
      if (url.pathname.startsWith('/api/') || url.pathname === '/healthz') return await app.handle(req,res,url);
      if (url.pathname.startsWith('/media/')) return await app.serveMedia(req,res,url);
      if (url.pathname.startsWith('/private/jobs/')) return await app.serveJobPhoto(req,res,url);
      if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405, {Allow:'GET, HEAD'}); return res.end(); }
      const pathname = decodeURIComponent(url.pathname);
      const clientPages = new Set(['/contacts','/pay','/sent','/confirmed','/paid','/pay-failed','/paused','/pay-blocked','/plans','/check-email','/cancel','/cancelled','/link-expired']);
      const file = resolve(root, '.' + (pathname === '/' || clientPages.has(pathname) ? '/index.html' : pathname));
      if (!file.startsWith(root.endsWith(sep) ? root : root + sep) || !types[extname(file)]) {
        res.writeHead(404); return res.end('Not found');
      }
      const body = await readFile(file);
      res.writeHead(200, {'Content-Type':types[extname(file)], 'Cache-Control':'no-cache'});
      res.end(req.method === 'HEAD' ? undefined : body);
    } catch (error) {
      if (res.headersSent) return res.end();
      if(error.status){res.writeHead(error.status,{'Content-Type':'text/plain; charset=utf-8'});return res.end(error.message);}
      res.writeHead(error.code === 'ENOENT' || error.code === 'EISDIR' ? 404 : 500);
      res.end(error.code === 'ENOENT' || error.code === 'EISDIR' ? 'Not found' : 'Request failed');
    }
  });
  server.headersTimeout = 15000;
  server.requestTimeout = 20000;
  server.on('close', () => {app.close();if(director)director.close().catch(()=>{});});
  return {server, app, get director(){return director;}};
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const hosted = createServerApp(), {server} = hosted;
  server.listen(Number(process.env.PORT || 3000), '0.0.0.0', () => {console.log('Klarraum server started.');process.send?.({port:server.address().port});});
  for (const signal of ['SIGINT','SIGTERM']) process.once(signal, () => {
    server.close(async () => {if(hosted.director)await hosted.director.close();process.exit(0);});
    setTimeout(() => process.exit(1), 15000).unref();
  });
}
