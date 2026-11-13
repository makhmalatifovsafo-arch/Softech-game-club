import { timingSafeEqual } from 'node:crypto';

// This endpoint is available only to the local service, never staff/mobile tokens.
export async function stopService(req, res, updater, secret, {sleep=ms=>new Promise(r=>setTimeout(r,ms)), timeout=15000}={}) {
  const reply=(status,error)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({error}));};
  const supplied=req.headers['x-softech-service-key'];
  if(!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress)||
     typeof secret!=='string'||secret.length<32||typeof supplied!=='string'||
     Buffer.byteLength(supplied)!==Buffer.byteLength(secret)||!timingSafeEqual(Buffer.from(supplied),Buffer.from(secret))) {
    reply(403,'FORBIDDEN');return;
  }
  if(updater.applying||updater.preparing){reply(409,'MAINTENANCE_BUSY');return;}
  updater.applying=true;
  const deadline=Date.now()+timeout;
  while(updater.pendingWrites>0&&Date.now()<deadline)await sleep(50);
  if(updater.pendingWrites>0){updater.applying=false;reply(503,'WRITES_BUSY');return;}
  reply(202,null);
  setTimeout(()=>updater.onShutdown(),100);
}
