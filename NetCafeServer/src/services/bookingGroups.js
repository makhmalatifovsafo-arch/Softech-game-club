import crypto from 'node:crypto';
import {bookingError} from './bookingAvailability.js';
import {runMoneyOperation} from './moneyOperations.js';
import {prepareCashierSession,cashierSessionQuote,writeCashierSession} from './cashierSessionStart.js';
import {BarLedgerService} from './barLedgerService.js';

function groupRows(db,actor,id){
  if(!actor||actor.id==null||!Number.isInteger(actor.clubId)||actor.clubId<=0||!['administrator','club_owner','superadmin'].includes(actor.role)||
    (actor.role==='administrator'&&!actor.permissions?.some(p=>['*','session:manage','sessions:manage'].includes(p))))throw bookingError('Seans boshqarish ruxsati kerak.',403);
  if(typeof id!=='string'||!/^[a-f0-9-]{36}$/.test(id))throw bookingError('Bron guruhi noto‘g‘ri.');
  const rows=db.prepare('SELECT * FROM bookings WHERE club_id=? AND group_id=? ORDER BY id').all(actor.clubId,id);
  if(!rows.length||rows.length>100)throw bookingError('Bron guruhi topilmadi.',404);
  return rows;
}
const hash=value=>crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sum=(rows,key)=>rows.reduce((n,r)=>n+Number(r[key]||0),0);
function settlementTotals(db,clubId,items,method){
  const collected=sum(items,items[0]?.amountCollected===undefined?'amountToCollect':'amountCollected'),returned=sum(items,'refundAmount');
  // Cash refunds can offset cash collection. Do not present a net card charge
  // when the ledger actually records a cash refund and a larger card payment.
  const hasCardRefund=items.some(p=>p.refundAmount>0&&db.prepare(`SELECT 1 FROM transactions WHERE club_id=? AND session_id=?
    AND amount>0 AND transaction_type IN ('PREPAID','POSTPAID_SETTLEMENT')
    AND COALESCE(payment_type,payment_method) IN ('CARD','CLICK','PAYME')`).get(clubId,p.sessionId));
  const separatePayments=collected>0&&returned>0&&(method!=='CASH'||hasCardRefund);
  return {separatePayments,amountToCollect:separatePayments?collected:Math.max(0,collected-returned),refundAmount:separatePayments?returned:Math.max(0,returned-collected)};
}
function checkId(input){if(typeof input.requestId!=='string'||!/^[a-zA-Z0-9_-]{8,100}$/.test(input.requestId))throw bookingError('Amal uchun requestId kerak.');}

export function previewGroupStart(db,actor,id,input,now=Date.now()){
  const rows=groupRows(db,actor,id).filter(b=>['PENDING','CONFIRMED'].includes(b.status)&&!b.session_id);
  if(!rows.length)throw bookingError('Guruhda ochilmagan bron qolmagan.',409);
  const plans=rows.map(b=>prepareCashierSession(db,actor,{...input,computerId:b.computer_ref,
    expectedRevision:input.expectedRevisions?.[b.id]}, {bookingId:b.id,now}));
  const items=plans.map(p=>({...cashierSessionQuote(p),computerName:p.pc.name}));
  const quoteRevision=hash(items.map(p=>[p.bookingId,p.expectedRevision,p.quoteRevision]));
  return {plans,body:{success:true,groupId:id,items,count:items.length,quoteRevision,isPostpaid:items.every(p=>p.isPostpaid),
    price:sum(items,'price'),depositApplied:sum(items,'depositApplied'),additionalPayment:sum(items,'additionalPayment'),
    cashRefundPending:sum(items,'cashRefundPending'),balanceRelease:sum(items,'balanceRelease')}};
}

export function startBookingGroup(db,actor,id,input,now=Date.now()){
  groupRows(db,actor,id);checkId(input);let plans=[];
  const result=runMoneyOperation(db,{clubId:actor.clubId,actorId:actor.id,operation:'BOOKING_GROUP_START',requestId:input.requestId,payload:{id,input}},()=>{
    const prepared=previewGroupStart(db,actor,id,input,now);
    if(prepared.body.quoteRevision!==input.quoteRevision)throw bookingError('Guruh hisobini qayta tasdiqlang.',409,'QUOTE_CHANGED');
    plans=prepared.plans;
    const items=plans.map(p=>writeCashierSession(db,p,actor,now));
    return {status:201,body:{...prepared.body,items}};
  });
  return {...result,plans};
}

export function previewGroupCheckout(db,actor,id){
  const rows=groupRows(db,actor,id);
  const items=[];
  for(const b of rows){
    if(!b.session_id)continue;
    const s=db.prepare('SELECT * FROM sessions WHERE club_id=? AND id=?').get(actor.clubId,b.session_id);
    if(!s)throw bookingError('Bron seansi topilmadi. Hisobni tekshiring.',409);
    const pendingFunding=db.prepare('SELECT 1 FROM session_funding_allocations a WHERE a.session_id=? AND NOT EXISTS(SELECT 1 FROM session_funding_settlements x WHERE x.session_id=a.session_id)').get(s.id);
    const pendingBar=db.prepare("SELECT 1 FROM bar_orders WHERE club_id=? AND session_id=? AND payment_status='PENDING_AT_CHECKOUT' AND approval_status='CONFIRMED'").get(actor.clubId,s.id);
    if(s.status!=='ACTIVE'&&!pendingFunding&&!pendingBar)continue;
    items.push(BarLedgerService.getSessionCheckoutPreview(s.id,actor.clubId));
  }
  if(!items.length)throw bookingError('Guruhda yopiladigan seans qolmagan.',409);
  const paymentOptions={CASH:settlementTotals(db,actor.clubId,items,'CASH'),CARD:settlementTotals(db,actor.clubId,items,'CARD')};
  return {success:true,groupId:id,items,count:items.length,sessionIds:items.map(p=>p.sessionId),
    gameBill:sum(items,'gameBill'),barBill:sum(items,'barBill'),paidBefore:sum(items,'paidBefore'),depositApplied:sum(items,'depositApplied'),
    ...paymentOptions.CASH,paymentOptions,balanceRefund:sum(items,'balanceRefund')};
}

export function checkoutBookingGroup(db,actor,id,input){
  groupRows(db,actor,id);checkId(input);const transaction={afterCommit:[]};
  const result=runMoneyOperation(db,{clubId:actor.clubId,actorId:actor.id,operation:'BOOKING_GROUP_CHECKOUT',requestId:input.requestId,payload:{id,input}},()=>{
    if(!['CASH','CARD'].includes(input.paymentMethod))throw bookingError('Naqd yoki karta to‘lovini tanlang.');
    const preview=previewGroupCheckout(db,actor,id);
    if(JSON.stringify(preview.sessionIds)!==JSON.stringify(input.sessionIds))throw bookingError('Guruh seanslari o‘zgargan. Hisobni yangilang.',409);
    const items=preview.items.map(p=>BarLedgerService.executeSessionCheckout({target:p.sessionId,clubId:actor.clubId,cashierUserId:actor.id,paymentMethod:input.paymentMethod,transaction}));
    const body={...preview,items,gameBill:sum(items,'gameBill'),barBill:sum(items,'barBill'),paidBefore:sum(items,'paidBefore'),depositApplied:sum(items,'depositApplied'),...settlementTotals(db,actor.clubId,items,input.paymentMethod),balanceRefund:sum(items,'balanceRefund'),paymentMethod:input.paymentMethod};
    delete body.paymentOptions;
    db.prepare("INSERT INTO audit_logs(club_id,actor_user_id,actor_username,category,action_type,details) VALUES(?,?,?,'SESSION','BOOKING_GROUP_CHECKOUT',?)")
      .run(actor.clubId,actor.id,actor.username||String(actor.id),JSON.stringify({groupId:id,sessionIds:preview.sessionIds,amountToCollect:body.amountToCollect,refundAmount:body.refundAmount}));
    return {status:200,body};
  });
  return {...result,afterCommit:result.replayed?[]:transaction.afterCommit};
}
