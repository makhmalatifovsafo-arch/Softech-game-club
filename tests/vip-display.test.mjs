import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
test('cashier scripts parse after live VIP display changes',()=>{
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (match[1].trim()) new vm.Script(match[1]);
  }
});
test('cashier refreshes server-calculated bills without rebuilding cards or overwriting another session',async()=>{
  const source=html.slice(html.indexOf('    function sessionBillLabel'),html.indexOf('    // Jonli taymerlar'));
  const el={dataset:{sessionBill:'pc-1'},textContent:'',title:''};
  const original={sessionId:'vip-1',isPostpaid:true,totalAmount:0};
  let response={id:'pc-1',activeSession:{sessionId:'vip-1',isPostpaid:true,totalAmount:5000,billingError:null}};
  let calls=0;
  const context=vm.createContext({authToken:'test',isMainLayoutEdit:false,computersData:[{id:'pc-1',activeSession:original}],
    setInterval(){},AbortSignal,console,document:{querySelectorAll:()=>[el]},
    fetch:async(url)=>{assert.equal(url,'/api/computers');calls++;return {ok:true,json:async()=>[response]};}});
  vm.runInContext(source,context);
  await vm.runInContext('refreshActiveSessionBills()',context);
  assert.equal(original.totalAmount,5000);assert.match(el.textContent,/5.*000 UZS/);
  response={id:'pc-1',activeSession:{sessionId:'vip-1',isPostpaid:true,totalAmount:null,billingError:'Missing tariff'}};
  await vm.runInContext('refreshActiveSessionBills()',context);
  assert.equal(el.textContent,'Hisobni tekshiring');assert.equal(el.title,'Missing tariff');
  response={id:'pc-1',activeSession:{sessionId:'other-session',totalAmount:90000}};
  await vm.runInContext('refreshActiveSessionBills()',context);
  assert.equal(original.totalAmount,null,'Response for another session must not overwrite the visible session');
  assert.equal(vm.runInContext('sessionBillLabel({totalAmount:0})',context),'0 UZS');
  context.authToken=null;await vm.runInContext('refreshActiveSessionBills()',context);assert.equal(calls,3);
});
