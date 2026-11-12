import {WebSocketServer} from 'ws';import {spawn} from 'node:child_process';import {once} from 'node:events';import assert from 'node:assert/strict';import path from 'node:path';
const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');let connections=0,hellos=0;let failure;
server.on('connection',socket=>{const index=++connections;socket.on('message',raw=>{const m=JSON.parse(raw);if(m.type!=='CLIENT_HELLO')return;hellos++;if(m.pcNumber!=='PC-07')failure='Wrong PC identity';
 const send=(type,payload)=>socket.send(JSON.stringify({type,payload}));
 send('CONFIG_UPDATE',{zoneName:'VIP',pricePerHour:12000});
 const start=JSON.stringify({type:'START_SESSION',payload:{sessionId:'paid-session',remainingSeconds:1800,clientBalance:0}});socket.send(start.slice(0,20),{fin:false});socket.send(start.slice(20),{fin:true});
 send('UPDATE_TIME',{remainingSeconds:600});send('STOP_SESSION',{reason:'test-end',barNotice:{sessionId:'paid-session',message:'Siz 1 ta Cola olgansiz.',barDebt:10000}});send('LOCK_SCREEN',{});send('POWER_COMMAND',{command:'REBOOT'});
 if(index===1)setTimeout(()=>socket.close(),150);else send('EMERGENCY_LOCKDOWN',{reason:'audit-ban',message:'Test only'});
 });});
const child=spawn(process.env.DOTNET_EXE || path.resolve('.tools/dotnet/dotnet.exe'),['tests/ClientProtocol/bin/Debug/net8.0-windows/ClientProtocol.dll','ws://127.0.0.1:'+server.address().port],{windowsHide:true,stdio:['ignore','pipe','pipe']});
let output='';child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);const timer=setTimeout(()=>child.kill(),35000);
try{const [code]=await once(child,'exit');assert.equal(code,0,output);assert.equal(failure,undefined);assert.ok(hellos>=2);console.log(output.trim());}finally{clearTimeout(timer);for(const s of server.clients)s.terminate();await new Promise(r=>server.close(r));}
