import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { DatabaseSync } from 'node:sqlite';
import { initializeMoneyOperations, runMoneyOperation } from '../NetCafeServer/src/services/moneyOperations.js';

test('money and receipt commit together; restart/retry never credits twice and a later new payment still works', () => {
  fs.mkdirSync('.test-output', { recursive: true });
  const file = path.join(fs.mkdtempSync(path.resolve('.test-output/money-receipt-')), 'test.db');
  let db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE account(balance); INSERT INTO account VALUES(0); CREATE TABLE ledger(amount);');
  initializeMoneyOperations(db);
  const request = { clubId:1, actorId:'cashier', operation:'TOPUP', requestId:'payment-first', payload:{ userId:1, amount:10000 } };
  const credit = () => {
    db.exec('UPDATE account SET balance=balance+10000; INSERT INTO ledger VALUES(10000);');
    return { status:200, body:{ newBalance:db.prepare('SELECT balance FROM account').get().balance } };
  };
  try {
    const first = runMoneyOperation(db, request, credit);
    assert.equal(first.body.newBalance, 10000);
    db.close(); db = new DatabaseSync(file); initializeMoneyOperations(db);
    for (let i = 0; i < 10; i++) {
      const retry = runMoneyOperation(db, request, () => assert.fail('Retry must not perform the payment'));
      assert.deepEqual(retry.body, first.body); assert.equal(retry.replayed, true);
    }
    db.exec('UPDATE account SET balance=0'); // The customer has spent the original credit.
    runMoneyOperation(db, request, credit);
    assert.equal(db.prepare('SELECT balance FROM account').get().balance, 0);
    const next = runMoneyOperation(db, { ...request, requestId:'payment-next' }, credit);
    assert.equal(next.body.newBalance, 10000);
    assert.equal(db.prepare('SELECT count(*) n FROM ledger').get().n, 2);
    for (const change of [{ actorId:'other-cashier' }, { payload:{ userId:1, amount:20000 } }])
      assert.throws(() => runMoneyOperation(db, { ...request, ...change }, credit), error => error.statusCode === 409);
    // The same client-side ID cannot leak a receipt from another club or action.
    assert.equal(runMoneyOperation(db, { ...request, clubId:2 }, () => ({ status:201, body:{ other:true } })).replayed, false);
    assert.equal(runMoneyOperation(db, { ...request, operation:'BAR_SALE' }, () => ({ status:201, body:{ sale:true } })).replayed, false);
    db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON money_operation_receipts BEGIN SELECT RAISE(ABORT,'disk failure'); END;");
    assert.throws(() => runMoneyOperation(db, { ...request, requestId:'payment-failed' }, credit), /disk failure/);
    assert.equal(db.prepare('SELECT balance FROM account').get().balance, 10000);
    assert.equal(db.prepare('SELECT count(*) n FROM ledger').get().n, 2);
    db.exec('DROP TRIGGER fail_receipt');
    assert.equal(runMoneyOperation(db, { ...request, requestId:'payment-failed' }, credit).body.newBalance, 20000);
    db.exec("UPDATE money_operation_receipts SET response_json='damaged' WHERE request_id='payment-next'");
    assert.throws(() => runMoneyOperation(db, { ...request, requestId:'payment-next' }, credit), error => !error.operationNotApplied);
    assert.equal(db.prepare('SELECT balance FROM account').get().balance,20000);
  } finally { db.close(); }
});

function browserFixture() {
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync('NetCafeServer/public/money-requests.js', 'utf8'), context);
  const saved = new Map();
  const storage = { getItem:key => saved.get(key) ?? null, setItem:(key,value) => saved.set(key,value), removeItem:key => saved.delete(key) };
  let sequence = 0;
  return { create:context.SoftechMoneyRequests.create, storage, uuid:() => 'request-' + (++sequence), saved };
}

test('cashier keeps the same operation through a lost response, reload and retry; confirmed new top-up gets a new ID', async () => {
  const f = browserFixture(), seen = [], receipts = new Map(); let balance=0, drop=true;
  const execute = async (_path, body) => {
    seen.push(body.requestId);
    if (!receipts.has(body.requestId)) { balance+=body.amount; receipts.set(body.requestId, { requestId:body.requestId, newBalance:balance }); }
    if (drop) { drop=false; throw Error('Response lost after commit'); }
    return { status:200, body:receipts.get(body.requestId) };
  };
  let ui = f.create({ ...f, execute });
  const payload = { userId:1, amount:10000, paymentMethod:'CASH' };
  await assert.rejects(ui.post('cashier','/api/clients/topup',payload), /Javob olinmadi/);
  assert.equal(balance,10000); assert.equal(f.saved.size,1);
  ui = f.create({ ...f, execute }); // Reload: durable browser draft, no in-memory request ID.
  await ui.post('cashier','/api/clients/topup',payload);
  assert.equal(balance,10000); assert.equal(seen[0],seen[1]); assert.equal(f.saved.size,0);
  balance=0;
  await ui.post('cashier','/api/clients/topup',payload);
  assert.equal(balance,10000); assert.notEqual(seen[1],seen[2]);
});

test('unknown sale cannot silently become a changed sale; definite rollback allows editing, old servers are not retried', async () => {
  const f=browserFixture(), calls=[]; let lose=true, confirm=false;
  const execute=async (_path,body) => {
    calls.push(body);
    if (lose) { lose=false; throw Error('Lost'); }
    return { status:201, body:{ requestId:body.requestId } };
  };
  const ui=f.create({ ...f,execute,confirmPending:() => confirm });
  const first={ items:[{ barItemId:1, quantity:1 }] }, next={ items:[{ barItemId:1, quantity:2 }] };
  await assert.rejects(ui.post('cashier','/api/bar/orders',first), /Javob olinmadi/);
  await assert.rejects(ui.post('cashier','/api/bar/orders',next), /Avval oldingi/);
  assert.equal(calls.length,1);
  confirm=true;
  await assert.rejects(ui.post('cashier','/api/bar/orders',next), /Oldingi amal tasdiqlandi/);
  assert.equal(calls[1].requestId,calls[0].requestId); assert.equal(calls[1].items[0].quantity,1);
  await ui.post('cashier','/api/bar/orders',next);
  assert.equal(calls[2].items[0].quantity,2); assert.notEqual(calls[2].requestId,calls[1].requestId);
  const rejected=f.create({ ...f,execute:async(_p,b)=>({status:400,body:{error:'No stock',requestId:b.requestId,operationNotApplied:true}}) });
  await assert.rejects(rejected.post('cashier','/api/bar/orders',first), /No stock/); assert.equal(f.saved.size,0);
  let legacyCalls=0;
  const legacy=f.create({ ...f,execute:async()=>{legacyCalls++;return {status:201,body:{success:true}};} });
  await assert.rejects(legacy.post('cashier','/api/bar/orders',first), /raqamini tasdiqlamadi/);
  await assert.rejects(legacy.post('cashier','/api/bar/orders',first), /takroriy yuborish to‘xtatildi/);
  assert.equal(legacyCalls,1);
});

test('double submit is blocked while waiting; unavailable browser storage sends no payment', async () => {
  const f=browserFixture(); let release, calls=0;
  const ui=f.create({ ...f,execute:(_p,b)=>{calls++;return new Promise(resolve=>release=()=>resolve({status:200,body:{requestId:b.requestId}}));} });
  const pending=ui.post('cashier','/api/clients/topup',{amount:10000});
  await assert.rejects(ui.post('cashier','/api/clients/topup',{amount:10000}), /tasdig‘i kutilmoqda/);
  release(); await pending; assert.equal(calls,1);
  const broken=f.create({ ...f,storage:{getItem:()=>null,setItem:()=>{throw Error('full');}},execute:()=>assert.fail('Must not send without durable ID') });
  await assert.rejects(broken.post('cashier','/api/clients/topup',{amount:10000}), /Amal yuborilmadi/);
});
