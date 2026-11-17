import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import path from 'node:path';

export async function checkMoneyOperations(api, clubDirectory, restart) {
  // Only seed this isolated test database; provisioning remains manager-only.
  const fixture=new DatabaseSync(path.join(clubDirectory,'netcafe.db'));
  fixture.exec('PRAGMA busy_timeout=5000');
  let itemId;
  try {
    fixture.prepare("INSERT INTO users(club_id,username,password_hash,role,balance,permissions) VALUES(1,'receipt_customer','test-unused-hash','client',0,'[]')").run();
    itemId=Number(fixture.prepare("INSERT INTO bar_items(club_id,name,buy_price,sell_price,stock_quantity) VALUES(1,'Receipt test Cola',1000,10000,10)").run().lastInsertRowid);
  } finally {fixture.close();}
  const users=await api('/api/admin/users');
  const user=users.body.find(u=>u.username==='receipt_customer');assert.ok(user);
  const topup={userId:user.id,amount:10000,paymentMethod:'CASH',requestId:crypto.randomUUID()};
  const first=await api('/api/clients/topup','POST',topup);
  assert.equal(first.status,200,JSON.stringify(first.body)); assert.equal(first.body.newBalance,10000);
  assert.equal(first.body.requestId,topup.requestId);
  const balanceSale={items:[{barItemId:itemId,quantity:1}],userId:user.id,paymentMethod:'CLIENT_BALANCE',requestId:crypto.randomUUID()};
  const sold=await api('/api/bar/orders','POST',balanceSale);
  assert.equal(sold.status,201,JSON.stringify(sold.body));
  await restart();
  // The server committed, but the cashier had not received/acknowledged its reply.
  const replies=await Promise.all(Array.from({length:4},()=>api('/api/clients/topup','POST',topup)));
  assert.ok(replies.every(r=>r.status===200&&r.body.replayed&&r.body.newBalance===10000));
  const repeatSale=await api('/api/bar/orders','POST',balanceSale);
  assert.equal(repeatSale.status,201,JSON.stringify(repeatSale.body));
  assert.equal(repeatSale.body.order.id,sold.body.order.id); assert.equal(repeatSale.body.replayed,true);
  const inspect=new DatabaseSync(path.join(clubDirectory,'netcafe.db'),{readOnly:true});
  try {
    assert.equal(inspect.prepare('SELECT balance FROM users WHERE id=?').get(user.id).balance,0,'A retry must not restore spent balance');
    assert.equal(inspect.prepare('SELECT stock_quantity FROM bar_items WHERE id=?').get(itemId).stock_quantity,9);
    assert.equal(inspect.prepare('SELECT count(*) n FROM bar_orders WHERE user_id=?').get(user.id).n,1);
    assert.equal(inspect.prepare("SELECT count(*) n FROM client_transactions WHERE user_id=? AND type='TOPUP'").get(user.id).n,1);
    assert.equal(inspect.prepare("SELECT count(*) n FROM audit_logs WHERE action_type='BAR_SALE' AND json_extract(details,'$.orderId')=?").get(sold.body.order.id).n,1);
    assert.equal((await api('/api/clients/topup','POST',{...topup,amount:20000})).status,409);
    assert.equal((await api('/api/bar/orders','POST',{...balanceSale,items:[{barItemId:itemId,quantity:2}]})).status,409);
    const next=await api('/api/clients/topup','POST',{...topup,requestId:crypto.randomUUID()});
    assert.equal(next.status,200);assert.equal(next.body.newBalance,10000,'A genuinely new top-up after spending must work');
    const cash={items:[{barItemId:itemId,quantity:1}],paymentMethod:'CASH',requestId:crypto.randomUUID()};
    const cashSale=await api('/api/bar/orders','POST',cash);assert.equal(cashSale.status,201);
    const retryCash=await api('/api/bar/orders','POST',cash);assert.equal(retryCash.body.order.id,cashSale.body.order.id);
    assert.equal(inspect.prepare('SELECT stock_quantity FROM bar_items WHERE id=?').get(itemId).stock_quantity,8);
    assert.equal(inspect.prepare("SELECT count(*) n FROM transactions WHERE notes=?").get('BAR_SALE:'+cashSale.body.order.orderNumber).n,1);
  } finally {inspect.close();}
  console.log('PASS real cashier top-up and bar retries survive restart, preserve spent balances, stock, audit and new payments');
}
