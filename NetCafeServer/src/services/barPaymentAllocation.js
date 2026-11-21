// Called inside the checkout transaction. Preserve the actual funding channel
// of prepaid credit as well as any newly collected money.
export function markBarOrdersPaid(db,clubId,orderIds,parts) {
  const amounts=new Map();
  for(const p of parts)if(p.amount>0){
    const method=['CARD','CLICK','PAYME'].includes(p.method)?'CARD':'CASH';
    amounts.set(method,(amounts.get(method)||0)+p.amount);
  }
  const sources=[...amounts].map(([method,remaining])=>({method,remaining}));
  for(const id of orderIds){
    const order=db.prepare("SELECT total_amount FROM bar_orders WHERE id=? AND club_id=? AND payment_status='PENDING_AT_CHECKOUT' AND approval_status='CONFIRMED'").get(id,clubId);
    if(!order)throw Error('Bar buyurtmasi o‘zgargan. Hisobni yangilang.');
    let remaining=Number(order.total_amount),first=null;
    for(const source of sources){
      const amount=Math.min(remaining,source.remaining);
      if(amount<=0)continue;
      first??=source.method;remaining-=amount;source.remaining-=amount;
      db.prepare('INSERT INTO bar_order_payments(order_id,club_id,payment_method,amount) VALUES(?,?,?,?)').run(id,clubId,source.method,amount);
    }
    if(Math.abs(remaining)>0.000001)throw Error('Bar to‘lovi buyurtma summasiga mos emas.');
    db.prepare("UPDATE bar_orders SET payment_status='PAID',payment_method=?,paid_at=CURRENT_TIMESTAMP WHERE id=? AND club_id=?")
      .run(first||'CASH',id,clubId);
  }
  if(sources.some(p=>Math.abs(p.remaining)>0.000001))throw Error('Bar to‘lovi buyurtma summasiga mos emas.');
}
