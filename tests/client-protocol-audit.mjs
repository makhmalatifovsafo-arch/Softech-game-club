import {WebSocketServer} from 'ws';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';import path from 'node:path';
import http from 'node:http';import crypto from 'node:crypto';
const badArchive=Buffer.alloc(256*1024,0x61);
const assets=http.createServer((req,res)=>{
 if(req.url==='/asset'){res.end(badArchive);return;}
 res.setHeader('Content-Type','application/json');
 res.end(JSON.stringify({version:'99.0.0',client:{downloadUrl:'http://127.0.0.1:'+assets.address().port+'/asset',
  sha256:req.url==='/bad-hash'?'0'.repeat(64):crypto.createHash('sha256').update(badArchive).digest('hex')}}));
});
assets.listen(0,'127.0.0.1');await once(assets,'listening');
const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');let connections=0,hellos=0;let failure;let messageAcks=0;
server.on('connection',socket=>{const index=++connections;socket.on('message',raw=>{const m=JSON.parse(raw);
 if(m.type==='MESSAGE_DISPLAYED'){if(m.payload.messageId!=='notice-'+index)failure='Wrong message receipt';messageAcks++;return;}
 if(m.type==='CLIENT_MEMBER_LOGOUT'){
  if(m.payload.sessionId!=='paid-session')failure='Logout must identify the active session';
  const send=(type,payload)=>socket.send(JSON.stringify({type,payload}));
  send('STOP_SESSION',{sessionId:'paid-session',reason:'test-end',memberSummary:{sessionId:'paid-session',username:'member-test',accountId:42,playedMinutes:30,gameAmount:3500,refundAmount:3500,balance:46500,barDebt:10000},barNotice:{sessionId:'paid-session',message:'Siz 1 ta Cola olgansiz.',barDebt:10000}});send('LOCK_SCREEN',{});send('POWER_COMMAND',{command:'REBOOT'});
  if(index===1)setTimeout(()=>socket.close(),150);else send('EMERGENCY_LOCKDOWN',{reason:'audit-ban',message:'Test only'});
  return;
 }
 if(m.type!=='CLIENT_HELLO')return;hellos++;if(m.pcNumber!=='PC-07')failure='Wrong PC identity';
 const send=(type,payload)=>socket.send(JSON.stringify({type,payload}));
 send('SEND_MESSAGE',{messageId:'notice-'+index,title:'Admin',message:'Hello <b>literal</b>\nSecond line'});
 send('CONFIG_UPDATE',{zoneName:'VIP',pricePerHour:12000});
 const now=Date.now();
 const info={sessionId:'cash-session',startedAt:now-3600000,asOf:now,gameAmount:14000,isPostpaid:false,canSelfClose:false};
 send('START_SESSION',{sessionId:'cash-session',remainingSeconds:1800,canSelfClose:false,sessionInfo:info});
 send('SESSION_INFO',{sessionInfo:{...info,sessionId:'stale-session'}});
 const start=JSON.stringify({type:'START_SESSION',payload:{sessionId:'paid-session',remainingSeconds:1800,clientBalance:0,canSelfClose:true,authoritativeAt:now+100}});socket.send(start.slice(0,20),{fin:false});socket.send(start.slice(20),{fin:true});
 send('UPDATE_TIME',{sessionId:'cash-session',remainingSeconds:1200,authoritativeAt:now+50});
 send('STOP_SESSION',{sessionId:'cash-session',reason:'stale-stop'});
 send('UPDATE_TIME',{sessionId:'paid-session',remainingSeconds:600,authoritativeAt:now+110});
 });});
const child=spawn(process.env.DOTNET_EXE || path.resolve('.tools/dotnet/dotnet.exe'),['tests/ClientProtocol/bin/Debug/net8.0-windows/ClientProtocol.dll','ws://127.0.0.1:'+server.address().port,'http://127.0.0.1:'+assets.address().port],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>child.kill(),35000);
try{const [code]=await once(child,'exit');assert.equal(code,0,output);assert.equal(failure,undefined);assert.ok(hellos>=2);assert.ok(messageAcks>=2);console.log(output.trim());}finally{clearTimeout(timer);for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));assets.closeAllConnections();await new Promise(r=>assets.close(r));}
