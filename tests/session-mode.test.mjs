import test from 'node:test';
import assert from 'node:assert/strict';
import {isPostpaidSession,canClientCloseSession} from '../NetCafeServer/src/services/sessionMode.js';

test('bar orders and transfers never change the original postpaid billing mode',()=>{
 for(const mode of ['POSTPAID','VIP','BATCH_POSTPAID','BATCH_VIP']) {
  for(const suffix of ['', ' | BAR:order-1', ' | BAR:order-1 | BAR:order-2', ' | BAR:order-1 | TRANSFER: PC2->PC3', ' | TRANSFER: PC2->PC3 | BAR:order-1']) {
   const session={notes:mode+suffix,paid_amount:0,client_self_service:1};
   assert.equal(isPostpaidSession(session),true,session.notes);
   assert.equal(canClientCloseSession(session),false,session.notes);
  }
 }
 for(const notes of ['hours | BAR:VIP','price | BAR:POSTPAID','CLIENT_BALANCE_PREPAID:42 | BAR:order-1','CLIENT_BALANCE_LIVE:42','VIPER','POSTPAID_NOT_A_MODE',null])
  assert.equal(isPostpaidSession({notes,paid_amount:0}),false,String(notes));
});
