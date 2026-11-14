import test from 'node:test';
import assert from 'node:assert/strict';
import {checkoutView} from '../public/mobile/checkout-view.js';
const helpers={esc:s=>String(s).replaceAll('<','&lt;'),money:n=>String(n)+' som'};
test('mobile checkout displays server net collection, cash refunds and balance refunds separately',()=>{
 const base={gameBill:5000,barBill:5000,prepaidCredit:5000,refundAmount:0,amountToCollect:0,barSummaryText:'Cola'};
 assert.match(checkoutView(base,helpers),/Hisob-kitob teng.*0 som/s);
 assert.match(checkoutView({...base,gameBill:8333,prepaidCredit:1667,amountToCollect:3333},helpers),/Mijozdan olinadi.*3333 som/s);
 assert.match(checkoutView({...base,barBill:0,refundAmount:5000},helpers),/Mijozga qaytim.*5000 som/s);
 assert.match(checkoutView({...base,isPostpaid:true,gameBill:8333,amountToCollect:13333},helpers),/Mijozdan olinadi.*13333 som/s);
 const member=checkoutView({...base,isMember:true,prepaidCredit:0,member:{refundAmount:5000},amountToCollect:5000},helpers);
 assert.match(member,/Mijoz balansiga qaytadi/);assert.doesNotMatch(member,/Mijozga qaytim/);
 assert.throws(()=>checkoutView({gameBill:10000,barBill:5000,amountToCollect:5000},helpers),/yangilang/);
 assert.doesNotMatch(checkoutView({...base,barSummaryText:'<img>'},helpers),/<img>/);
});
