// Run behind an HTTPS reverse proxy. No business data or commands are accepted here.
import http from 'node:http';
import crypto from 'node:crypto';
import {WebSocketServer} from 'ws';
const secret=process.env.SOFTECH_LIVE_SECRET;
if(!secret||secret.length<32)throw Error('SOFTECH_LIVE_SECRET must contain at least 32 characters.');
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&crypto.timingSafeEqual(x,y);};
const sockets=new Set();
const server=http.createServer(async(req,res)=>{
 if(req.url==='/health'){res.writeHead(200);return res.end('OK');}
 if(req.url!=='/notify'||req.method!=='POST'||!equal(String(req.headers.authorization||''),'Bearer '+secret)){res.writeHead(403);return res.end();}
 try{let raw='';for await(const chunk of req){raw+=chunk;if(raw.length>1024){res.writeHead(413);res.end();return;}}
 const {clubId,event}=JSON.parse(raw);
 if(!Number.isSafeInteger(clubId)||clubId<1||!['jobs','data','result'].includes(event))throw Error();
 for(const ws of sockets)if(ws.auth?.clubId===clubId&&ws.auth.expiresAt>Date.now()&&ws.readyState===1&&ws.bufferedAmount<65536&&((event==='jobs')===(ws.auth.role==='server')))ws.send(JSON.stringify({event}));
 res.writeHead(204);res.end();
 }catch{res.writeHead(400);res.end();}
});
const wss=new WebSocketServer({server,path:'/live',maxPayload:2048,perMessageDeflate:false});
wss.on('connection',ws=>{
 sockets.add(ws);const timer=setTimeout(()=>ws.close(1008,'Authenticate'),5000);timer.unref();
 ws.on('message',raw=>{try{
  if(ws.auth)throw Error();const {ticket}=JSON.parse(raw.toString());const [body,sig,...rest]=String(ticket).split('.');
  if(rest.length||!equal(sig||'',crypto.createHmac('sha256',secret).update(body).digest('base64url')))throw Error();
  const auth=JSON.parse(Buffer.from(body,'base64url').toString());
  if(!Number.isSafeInteger(auth.clubId)||auth.clubId<1||!['server','mobile'].includes(auth.role)||auth.expiresAt<=Date.now()||auth.expiresAt>Date.now()+65000)throw Error();
  ws.auth=auth;clearTimeout(timer);ws.send(JSON.stringify({event:'connected'}));
 }catch{ws.close(1008,'Invalid ticket');}});
 ws.on('close',()=>{clearTimeout(timer);sockets.delete(ws);});ws.on('error',()=>{});
});
const sweep=setInterval(()=>{for(const ws of sockets)if(ws.auth?.expiresAt<=Date.now())ws.close(1008,'Renew ticket');},1000);sweep.unref();
server.listen(process.env.PORT===undefined?8090:Number(process.env.PORT),'0.0.0.0',()=>console.log(server.address().port));
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>{for(const ws of sockets)ws.terminate();wss.close();server.close();});
