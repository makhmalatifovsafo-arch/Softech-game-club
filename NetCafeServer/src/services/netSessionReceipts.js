// A report is a view of retained payments. Original ledger/audit rows are immutable.
export const paymentMethod = value => ['CARD','CLICK','PAYME'].includes(value) ? 'CARD'
  : ['BALANCE','CLIENT_BALANCE','FROM_MEMBER_BALANCE'].includes(value) ? 'BALANCE' : value || 'CASH';
export const receiptCategory = t => /^CLIENT_TOPUP/.test(t.notes || '') ? 'TOPUP'
  : t.transaction_type === 'BAR_SALE' || /^BAR_SALE/.test(t.notes || '') ? 'BAR'
  : t.session_id && (Number(t.amount) < 0 || /REFUND/.test(t.transaction_type + ' ' + (t.notes || ''))) ? 'GAME'
  : /REFUND/.test(t.notes || '') || !['PREPAID','POSTPAID_SETTLEMENT'].includes(t.transaction_type) ? 'OTHER' : 'GAME';

export function retainedSessionPayments(rows) {
  const result=rows.map(row=>({...row,amount:Number(row.amount)}));
  const groups=new Map();
  for(const row of result){
    if(!row.session_id || row.category!=='GAME')continue;
    const key=JSON.stringify([row.club_id,row.session_id]);
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(row);
  }
  for(const group of groups.values()){
    const payments=group.filter(r=>r.amount>0).sort((a,b)=>String(b.created_at).localeCompare(String(a.created_at)) || Number(b.ledger_order)-Number(a.ledger_order));
    for(const refund of group.filter(r=>r.amount<0)){
      let remaining=-refund.amount;
      // Prefer the original payment channel. Mixed-payment sessions remain net.
      const ordered=[...payments.filter(p=>p.paymentMethod===refund.paymentMethod),...payments.filter(p=>p.paymentMethod!==refund.paymentMethod)];
      for(const payment of ordered){const applied=Math.min(payment.amount,remaining);payment.amount-=applied;remaining-=applied;if(remaining<=0)break;}
      // Preserve unmatched historic adjustments instead of silently losing money.
      refund.amount=-remaining;
    }
  }
  return result.filter(r=>r.in_range && r.amount!==0);
}

export function getRetainedPayments(db,from,to,clubId=null,{balance=false}={}) {
  const table=balance?'client_transactions':'transactions';
  const filter=balance?" AND t.type IN ('SESSION_DEDUCT','REFUND') AND t.category='GAME'":'';
  const scope=clubId===null?'':' AND t.club_id=?';
  const query=`WITH selected AS (
    SELECT t.rowid AS ledger_order,t.*,date(t.created_at,'localtime') BETWEEN ? AND ? AS in_range
    FROM ${table} t WHERE 1=1${scope}${filter}
  ), affected AS (SELECT DISTINCT club_id,session_id FROM selected WHERE in_range AND session_id IS NOT NULL)
  SELECT s.* FROM selected s WHERE s.in_range OR EXISTS (
    SELECT 1 FROM affected a WHERE a.club_id=s.club_id AND a.session_id=s.session_id
  ) ORDER BY s.created_at,s.ledger_order`;
  const rows=db.prepare(query).all(...(clubId===null?[from,to]:[from,to,clubId]));
  return retainedSessionPayments(rows.map(t=>({...t,
    category:balance?'GAME':receiptCategory(t),paymentMethod:balance?'BALANCE':paymentMethod(t.payment_type||t.payment_method),
    amount:balance&&t.type==='REFUND'?-Number(t.amount):Number(t.amount)})));
}
