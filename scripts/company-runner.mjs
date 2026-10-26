// Private child process. Receives configuration through IPC, never command-line arguments.
import {createServerApp} from '../server.mjs';
let current;
process.once('message',config=>{
  current=createServerApp(config);
  current.server.listen(0,'127.0.0.1',()=>process.send?.({port:current.server.address().port}));
});
async function stop(){if(current){await current.app.drain();current.server.close(()=>process.exit(0));}else process.exit(0);setTimeout(()=>process.exit(1),5000).unref();}
process.once('SIGTERM',stop);
process.once('disconnect',stop);
