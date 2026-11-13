import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {deliverScreenMessage,acknowledgeScreenMessage} from '../NetCafeServer/src/services/screenMessages.js';
test('screen message acknowledgement is bound to the intended socket; offline and timeout never report displayed',async()=>{
 let payload;
 const socket={readyState:1,send(raw){payload=JSON.parse(raw).payload;}};
 const result=deliverScreenMessage(socket,{title:'Softech',message:'Salom'},25);
 acknowledgeScreenMessage({},payload);
 assert.equal(await result,'unconfirmed');
 const confirmed=deliverScreenMessage(socket,{title:'Softech',message:'Salom'},1000);
 acknowledgeScreenMessage(socket,payload);assert.equal(await confirmed,'displayed');
 assert.equal(await deliverScreenMessage(null,{}),'offline');
 assert.equal(await deliverScreenMessage({readyState:1,send(){throw Error('closed');}},{}),'offline');
});
test('message route enforces permission, club ownership, payload limits and delivery result',async()=>{
 const source=fs.readFileSync(new URL('../NetCafeServer/src/server.js',import.meta.url),'utf8');
 const start=source.indexOf("  if (url.pathname === '/api/messages/send'");
 const block=source.slice(start,source.indexOf('  // ==========================================================================',start));
 const pc={id:'pc1',club_id:1},socket={};let permission=true,club=1,body,sent=0,status='displayed',response;
 const context=vm.createContext({url:new URL('http://fixture/api/messages/send'),req:{method:'POST'},res:{},
 authenticate:()=>permission,getTenantClubId:()=>club,db:{prepare:()=>({get:id=>id===pc.id?pc:null})},
 ClientManager:{clients:new Map([['pc1',{pcId:'pc1',socket}]])},
 deliverScreenMessage:async(s,p)=>{assert.equal(s,socket);sent++;return status;},
 sendJson:(r,code,data)=>response={code,...data},readBody:(r,fn)=>context.pending=fn(body)});
 vm.runInContext('function route(){'+block+'}',context);
 async function run(data){body=data;response=null;context.pending=null;context.route();await context.pending;return response;}
 const data={computerId:'pc1',message:'Hello'};
 assert.equal((await run(data)).code,200);assert.equal(sent,1);
 club=2;assert.equal((await run(data)).code,403);assert.equal(sent,1);club=1;
 assert.equal((await run({...data,message:' '.repeat(10)})).code,400);
 assert.equal((await run({...data,message:'a'.repeat(2001)})).code,400);
 assert.equal((await run({...data,computerId:'absent'})).code,404);
 status='offline';assert.equal((await run(data)).code,409);
 status='unconfirmed';assert.equal((await run(data)).code,504);
 permission=false;const before=sent;await run(data);assert.equal(sent,before);
});

test('cashier keeps failed message for retry and clears only a confirmed delivery',async()=>{
 const html=fs.readFileSync(new URL('../NetCafeServer/public/index.html',import.meta.url),'utf8');
 const begin=html.indexOf('    async function handleSendMessage(');
 const code=html.slice(begin,html.indexOf('    function closeModal',begin));
 const button={disabled:false},fields={messagePcId:{value:'pc1'},messageContent:{value:'Hello'}};
 let ok=false,closed=0,alertText='';
 const c=vm.createContext({authToken:'fixture',document:{getElementById:id=>fields[id]},
 fetch:async()=>({ok,json:async()=>ok?{success:true,status:'displayed'}:{error:'Offline'}}),
 closeModal:()=>closed++,alert:text=>alertText=text,showToast(){}});
 vm.runInContext(code,c);
 const event={preventDefault(){},target:{querySelector:()=>button}};
 await c.handleSendMessage(event);assert.equal(fields.messageContent.value,'Hello');assert.equal(closed,0);assert.equal(alertText,'Offline');assert.equal(button.disabled,false);
 ok=true;await c.handleSendMessage(event);assert.equal(closed,1);assert.equal(fields.messageContent.value,'');
});
