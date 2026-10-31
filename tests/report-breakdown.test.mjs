import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import fs from 'node:fs';
import vm from 'node:vm';
import {getFinancialBreakdown} from '../NetCafeServer/src/services/financialBreakdown.js';

test('receipt classification, balance isolation, historical payment date and tenant scope',()=>{
  const db=new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE transactions(id,club_id,session_id,created_at,payment_type,payment_method,transaction_type,notes,amount);
    CREATE TABLE sessions(id,customer_name,computer_id);
    CREATE TABLE computers(id,name,club_id,pc_number);
    CREATE TABLE users(id,username);
    CREATE TABLE client_transactions(id,club_id,user_id,created_at,type,category,amount);
    CREATE TABLE bar_orders(id,club_id,user_id,computer_id,payment_status,approval_status,payment_method,paid_at,created_at,order_number);
    CREATE TABLE bar_order_items(id,order_id,item_name,quantity,unit_price,total_price);
    INSERT INTO transactions VALUES
      (1,1,NULL,'2026-10-10 12:00:00','CASH','CASH','PREPAID',NULL,10000),
      (2,1,NULL,'2026-10-10 12:00:00','CARD','CASH','PREPAID','CLIENT_TOPUP:member',20000),
      (3,1,NULL,'2026-10-10 12:00:00','CARD','CASH','BAR_SALE','BAR_SALE',5000),
      (4,1,NULL,'2026-10-10 12:00:00','CASH','CASH','REFUND','REFUND',-1000),
      (5,2,NULL,'2026-10-10 12:00:00','CASH','CASH','PREPAID',NULL,999999);
    INSERT INTO client_transactions VALUES
      (1,1,1,'2026-10-10 12:00:00','SESSION_DEDUCT','GAME',3000),
      (2,1,1,'2026-10-10 12:00:00','SESSION_DEDUCT','BAR',5000),
      (3,1,1,'2026-10-10 12:00:00','REFUND','GAME',1000);
    INSERT INTO bar_orders VALUES
      (1,1,1,NULL,'PAID','CONFIRMED','CLIENT_BALANCE','2026-10-10 12:00:00','2026-10-09 12:00:00','A'),
      (2,1,NULL,NULL,'PAID','CONFIRMED','CARD','2026-10-10 12:00:00','2026-10-09 12:00:00','B'),
      (3,1,NULL,NULL,'PENDING_AT_CHECKOUT','PENDING','CASH',NULL,'2026-10-10 12:00:00','C');
    INSERT INTO bar_order_items VALUES(1,1,'Cola',1,5000,5000),(2,2,'Cola',1,5000,5000),(3,3,'Cola',1,5000,5000);
  `);
  try {
    const b=getFinancialBreakdown(db,'2026-10-10','2026-10-10',1);
    assert.equal(b.cash,9000);assert.equal(b.card,25000);assert.equal(b.total,34000);
    assert.equal(b.sessionsAndTopups,30000);
    assert.equal(b.gameBalance,2000);assert.equal(b.barBalance,5000);
    assert.equal(b.rows.filter(r=>r.category==='BAR').length,2);
    assert.equal(b.rows.filter(r=>r.category==='BAR'&&r.paymentMethod!=='BALANCE').reduce((s,r)=>s+r.amount,0),5000);
    assert.equal(getFinancialBreakdown(db,'2026-10-09','2026-10-09',1).rows.length,0);
  } finally {db.close();}
});

test('report menus render separate totals and escape customer/product text',()=>{
  const nodes=new Map();
  const node=()=>({innerHTML:'',textContent:'',children:[],replaceChildren(){this.children=[];},appendChild(x){this.children.push(x);}});
  const context={document:{getElementById(id){if(!nodes.has(id))nodes.set(id,node());return nodes.get(id);},createElement:node},
    formatUzs:n=>String(n),reportDataCache:{breakdown:{receipts:{GAME:{CASH:100,CARD:0},BAR:{CASH:0,CARD:50},TOPUP:{CASH:200,CARD:0},OTHER:{CASH:0,CARD:0}},
      cash:300,card:50,total:350,sessionsAndTopups:300,rows:[
        {category:'BAR',paymentMethod:'BALANCE',description:'<img onerror=evil()>',quantity:1,unitPrice:70,amount:70},
        {category:'BAR',paymentMethod:'CARD',description:'Cola',quantity:1,unitPrice:50,amount:50},
        {category:'GAME',paymentMethod:'CASH',description:'Seans',quantity:1,unitPrice:100,amount:100},
        {category:'TOPUP',paymentMethod:'CASH',description:'Member',quantity:1,unitPrice:200,amount:200}
      ]}}};
  vm.createContext(context);
  const source=fs.readFileSync('NetCafeServer/public/app.js','utf8');
  new vm.Script(source); // Entire browser bundle must parse.
  vm.runInContext(source.slice(source.indexOf('const paymentSections =')),context);
  vm.runInContext("renderPaymentDetails('BAR_PAID')",context);
  assert.match(nodes.get('reportPaymentTotal').textContent,/50/);
  assert.doesNotMatch(nodes.get('reportPaymentRows').innerHTML,/evil/);
  vm.runInContext("renderPaymentDetails('BAR_BALANCE')",context);
  assert.match(nodes.get('reportPaymentTotal').textContent,/70/);
  assert.match(nodes.get('reportPaymentRows').innerHTML,/&lt;img/);
  assert.doesNotMatch(nodes.get('reportPaymentRows').innerHTML,/<img/);
  vm.runInContext("renderPaymentDetails('GAME_TOPUP')",context);
  assert.match(nodes.get('reportPaymentTotal').textContent,/300/);
  assert.equal(nodes.get('reportPaymentFilters').children.length,10);
});
