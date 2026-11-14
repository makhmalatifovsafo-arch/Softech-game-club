// Values come from the club server; the phone never reprices a running session.
export function checkoutView(bill,{esc,money}) {
 const amount=value=>Number.isFinite(Number(value))&&Number(value)>=0;
 if(!bill||!amount(bill.gameBill)||!amount(bill.barBill)||!amount(bill.amountToCollect))throw Error('Server hisob-kitobi to‘liq emas. Qayta tekshiring.');
 if(!bill.isPostpaid&&!bill.isMember&&(!amount(bill.prepaidCredit)||!amount(bill.refundAmount)))
  throw Error('Qaytimni to‘g‘ri hisoblash uchun klub serverini yangi versiyaga yangilang.');
 const due=Number(bill.amountToCollect),refund=Number(bill.refundAmount||0);
 const row=(label,value)=>`<p>${label}: <b>${esc(money(value))}</b></p>`;
 return row('Ishlatilgan o‘yin vaqti',bill.gameBill)+row('To‘lanmagan bar mahsulotlari',bill.barBill)
  +(bill.barBill>0?`<p>${esc(bill.barSummaryText||'')}</p>`:'')
  +(!bill.isPostpaid&&!bill.isMember?row('Oldindan to‘langan',Number(bill.gameBill)+Number(bill.prepaidCredit))+row('Ishlatilmagan vaqt puli',bill.prepaidCredit):'')
  +(bill.isMember?row('Mijoz balansiga qaytadi',bill.member?.refundAmount||0):'')
  +`<section class="card" aria-live="polite"><p>${refund>0?'Mijozga qaytim':due>0?'Mijozdan olinadi':'Hisob-kitob teng'}</p><h2>${esc(money(refund>0?refund:due))}</h2></section>`;
}
