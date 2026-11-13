import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {WebSocketServer,WebSocket} from 'ws';
import {verifyEmergencyLicense} from './services/emergencyLicense.js';
import {EmergencyJournal} from './services/emergencyJournal.js';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const port=Number(process.env.PORT)||5000,control=process.env.SOFTECH_SERVICE_CONTROL_SECRET||'';
const license=verifyEmergencyLicense(root);
if(!license.ok){console.error('EMERGENCY_LICENSE_DENIED: '+license.reason);process.exit(78);}
const journal=new EmergencyJournal(root,control);
if(!journal.valid){console.error('EMERGENCY_JOURNAL_INVALID');process.exit(79);}
const startedAt=Date.now(),modeDeadline=startedAt+12*60*60*1000,clients=new Map(),sockets=new Map();
const local=req=>['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket.remoteAddress);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
const safe=value=>String(value||'').trim().slice(0,80).replace(/[<>]/g,'');
const keyOf=(name,mac)=>crypto.createHash('sha256').update(safe(name).toUpperCase()+'|'+safe(mac).toUpperCase()).digest('hex').slice(0,24);
const activeFor=clientKey=>journal.active().find(item=>item.clientKey===clientKey&&Date.parse(item.endsAt)>Date.now());
const send=(socket,type,payload)=>socket?.readyState===WebSocket.OPEN&&socket.send(JSON.stringify({type,event:type,...payload,payload,timestamp:Date.now()}));
const body=req=>new Promise((resolve,reject)=>{let raw='';req.on('data',chunk=>{raw+=chunk;if(raw.length>16384)reject(Error('So‘rov juda katta.'));});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(Error('JSON xato.'));}});req.on('error',reject);});
const state=()=>({mode:'EMERGENCY',startedAt:new Date(startedAt).toISOString(),availableUntil:new Date(modeDeadline).toISOString(),clubName:license.payload.clubName||'Klub',journalSequence:journal.sequence,clients:[...clients.values()].map(c=>({clientKey:c.clientKey,name:c.name,connected:c.socket.readyState===WebSocket.OPEN,activeSession:activeFor(c.clientKey)||null}))});
function endSession(session,reason){journal.append({type:'SESSION_ENDED',sessionId:session.sessionId,clientKey:session.clientKey,pcName:session.pcName,reason});const client=clients.get(session.clientKey);send(client?.socket,'STOP_SESSION',{sessionId:session.sessionId,reason});send(client?.socket,'LOCK_SCREEN',{reason});}
const page=fs.readFileSync(path.join(root,'public','emergency.html'));
const server=http.createServer(async(req,res)=>{
  const url=new URL(req.url||'/',`http://${req.headers.host||'localhost'}`);
  if(url.pathname==='/api/health')return json(res,200,{status:'ok',app:'NetCafeEmergency',mode:'EMERGENCY',processId:process.pid,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,uptime:process.uptime(),updatePending:false});
  if(url.pathname==='/api/internal/service-stop'&&req.method==='POST'){
    if(req.headers['x-softech-service-key']!==control)return json(res,403,{error:'FORBIDDEN'});
    json(res,202,{success:true});return setTimeout(()=>server.close(()=>process.exit(0)),100);
  }
  if(!local(req))return json(res,403,{error:'Favqulodda kassa faqat server kompyuterida ochiladi.'});
  if(url.pathname==='/'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});return res.end(page);}
  if(url.pathname==='/api/emergency/state'&&req.method==='GET')return json(res,200,state());
  if(req.method==='POST'&&req.headers['x-softech-emergency']!=='1')return json(res,403,{error:'Noto‘g‘ri so‘rov.'});
  try{
    if(url.pathname==='/api/emergency/start'&&req.method==='POST'){
      if(Date.now()>modeDeadline)throw Error('12 soatlik favqulodda rejim tugadi. Serverni tiklash shart.');
      const input=await body(req),minutes=Number(input.minutes),client=clients.get(String(input.clientKey));
      if(safe(input.operator).length<2)throw Error('Kassir ismini kiriting.');
      if(!Number.isInteger(minutes)||minutes<5||minutes>720)throw Error('Vaqt 5–720 daqiqa oralig‘ida bo‘lsin.');
      if(!client||client.socket.readyState!==WebSocket.OPEN)throw Error('Client kompyuter ulanmagan.');
      if(activeFor(client.clientKey))throw Error('Bu kompyuterda favqulodda seans ochiq.');
      const sessionId='emg-'+crypto.randomUUID(),start=Date.now(),ends=start+minutes*60000;
      const event=journal.append({type:'SESSION_STARTED',sessionId,clientKey:client.clientKey,pcName:client.name,minutes,startedAt:new Date(start).toISOString(),endsAt:new Date(ends).toISOString(),operator:safe(input.operator)||'Kassir',note:safe(input.note)});
      send(client.socket,'START_SESSION',{sessionId,durationMinutes:minutes,remainingSeconds:minutes*60,startedAt:start,endsAt:ends,endTime:event.endsAt,tariffName:'Favqulodda vaqtli seans',customerName:'Mehmon',canSelfClose:false,emergencyMode:true});
      return json(res,201,{success:true,session:event});
    }
    if(url.pathname==='/api/emergency/stop'&&req.method==='POST'){
      const input=await body(req),session=journal.active().find(item=>item.sessionId===input.sessionId);
      if(!session)throw Error('Faol favqulodda seans topilmadi.');endSession(session,'Kassir favqulodda seansni yopdi.');return json(res,200,{success:true});
    }
    if(url.pathname==='/api/emergency/retry-main'&&req.method==='POST'){
      const running=journal.active().filter(item=>Date.parse(item.endsAt)>Date.now());
      if(running.length)throw Error('Avval barcha favqulodda seanslarni yoping. Keyin asosiy serverni qayta sinang.');
      const operator=safe((await body(req)).operator);if(operator.length<2)throw Error('Kassir ismini kiriting.');
      journal.append({type:'MAIN_RETRY_REQUESTED',operator});json(res,202,{success:true});return setTimeout(()=>process.exit(75),100);
    }
    return json(res,404,{error:'Topilmadi.'});
  }catch(error){return json(res,400,{error:error.message});}
});
const wss=new WebSocketServer({server,path:'/ws'});
wss.on('connection',(socket,req)=>{
  socket.on('message',raw=>{try{
    const message=JSON.parse(raw),type=String(message.type||message.event||'').toUpperCase(),payload=message.payload||message;
    if(type==='CLIENT_HELLO'||type==='CLIENT_HANDSHAKE'){
      if(sockets.has(socket))return;
      const name=safe(message.pcNumber||payload.pcNumber),mac=safe(payload.macAddress||payload.mac),clientKey=keyOf(name,mac);
      if(!name||(!clients.has(clientKey)&&clients.size>=license.maxPcs))return socket.close(1008,'PC_LIMIT');
      const previous=clients.get(clientKey);if(previous&&previous.socket!==socket)previous.socket.close(1000,'REPLACED');
      const client={clientKey,name,mac,ip:req.socket.remoteAddress,socket,lastSeen:Date.now()};clients.set(clientKey,client);sockets.set(socket,clientKey);
      const session=activeFor(clientKey),remaining=session?Math.max(0,Math.ceil((Date.parse(session.endsAt)-Date.now())/1000)):0;
      send(socket,'HANDSHAKE_ACK',{pcNumber:name,zoneName:'FAVQULODDA',pricePerHour:0,rateFormatted:'Narx hisoblanmaydi',activeSession:session?{sessionId:session.sessionId,remainingSeconds:remaining,tariffName:'Favqulodda vaqtli seans',customerName:'Mehmon'}:null,emergencyMode:true});
    }else if(type.includes('HEARTBEAT')){const key=sockets.get(socket);if(key&&clients.has(key))clients.get(key).lastSeen=Date.now();}
  }catch{}});
  socket.on('close',()=>{const key=sockets.get(socket);sockets.delete(socket);if(key&&clients.get(key)?.socket===socket)clients.delete(key);});
});
setInterval(()=>{for(const session of journal.active())if(Date.parse(session.endsAt)<=Date.now())try{endSession(session,'Favqulodda vaqt tugadi.');}catch(error){console.error('EMERGENCY_END_FAILED: '+error.message);}},1000).unref();
setInterval(()=>{const current=verifyEmergencyLicense(root);if(!current.ok){for(const client of clients.values())send(client.socket,'EMERGENCY_LOCKDOWN',{reason:'LICENSE_INACTIVE',message:current.reason});setTimeout(()=>process.exit(78),100);}},5000).unref();
server.listen(port,'0.0.0.0',()=>console.log(`EMERGENCY_READY:${port}`));
