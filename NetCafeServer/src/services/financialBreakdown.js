import {getRetainedPayments,paymentMethod as method} from './netSessionReceipts.js';
// Receipts and balance spending are separate ledgers: never add them together.
export function getFinancialBreakdown(db, from, to, clubId = null) {
  const scoped = (alias) => clubId === null ? '' : ` AND ${alias}.club_id = ?`;
  const params = clubId === null ? [from, to] : [from, to, clubId];
  const transactions = getRetainedPayments(db,from,to,clubId);
  const sessionInfo=db.prepare('SELECT s.customer_name,c.name AS computer_name FROM sessions s LEFT JOIN computers c ON c.id=s.computer_id WHERE s.id=?');
  const receipts = { GAME:{CASH:0,CARD:0}, BAR:{CASH:0,CARD:0}, TOPUP:{CASH:0,CARD:0}, OTHER:{CASH:0,CARD:0} };
  const rows = [];
  for (const t of transactions) {
    const {category,paymentMethod}=t;
    const info=t.session_id?sessionInfo.get(t.session_id):null;
    if (!['CASH','CARD'].includes(paymentMethod)) continue;
    receipts[category][paymentMethod] += Number(t.amount);
    // Bar detail comes from order lines, not a second copy of the cash transaction.
    if (category !== 'BAR') rows.push({id:'tx:'+t.id, sessionId:t.session_id, category, paymentMethod,
      createdAt:t.created_at, customerName:info?.customer_name || '', computerName:info?.computer_name || '',
      description: category === 'TOPUP' ? (t.notes || '').replace(/^CLIENT_TOPUP:/,'') : t.notes || 'O‘yin seansi',
      quantity:1, unitPrice:Number(t.amount), amount:Number(t.amount)});
  }
  const balance = getRetainedPayments(db,from,to,clubId,{balance:true});
  const userInfo=db.prepare('SELECT username FROM users WHERE id=?');
  for (const t of balance) rows.push({id:'balance:'+t.id, sessionId:t.session_id, category:'GAME', paymentMethod:'BALANCE',
    createdAt:t.created_at, customerName:userInfo.get(t.user_id)?.username || '', computerName:'',
    description:'Mijoz balansidan o‘yin', quantity:1, unitPrice:t.amount, amount:t.amount});
  const items = db.prepare(`
    SELECT i.*, o.payment_method, COALESCE(o.paid_at,o.created_at) AS paid_date,
      o.order_number, u.username, c.name AS computer_name
    FROM bar_order_items i JOIN bar_orders o ON o.id=i.order_id
    LEFT JOIN users u ON u.id=o.user_id LEFT JOIN computers c ON c.id=o.computer_id
    WHERE o.payment_status='PAID' AND o.approval_status='CONFIRMED'
      AND date(COALESCE(o.paid_at,o.created_at),'localtime') BETWEEN ? AND ?${scoped('o')}
    ORDER BY paid_date DESC, i.id DESC
  `).all(...params);
  for (const i of items) rows.push({id:'bar:'+i.id, category:'BAR', paymentMethod:method(i.payment_method),
    createdAt:i.paid_date, customerName:i.username || '', computerName:i.computer_name || '',
    description:i.item_name, orderNumber:i.order_number, quantity:Number(i.quantity),
    unitPrice:Number(i.unit_price), amount:Number(i.total_price)});
  const pendingItems=db.prepare(`
    SELECT i.*,o.order_number,o.created_at,o.id AS pending_order_id,c.name AS computer_name,u.username
    FROM bar_order_items i JOIN bar_orders o ON o.id=i.order_id
    LEFT JOIN users u ON u.id=o.user_id LEFT JOIN computers c ON c.club_id=o.club_id AND c.pc_number=o.computer_id
    WHERE o.approval_status='CONFIRMED' AND o.payment_status='PENDING_AT_CHECKOUT'
      AND date(o.created_at,'localtime') BETWEEN ? AND ?${scoped('o')}
  `).all(...params);
  for(const i of pendingItems)rows.push({id:'pending:'+i.id,orderId:i.pending_order_id,category:'BAR_PENDING',paymentMethod:'PENDING',
    createdAt:i.created_at,customerName:i.username||'',computerName:i.computer_name||'',description:i.item_name,
    orderNumber:i.order_number,quantity:Number(i.quantity),unitPrice:Number(i.unit_price),amount:Number(i.total_price)});
  rows.sort((a,b)=>String(b.createdAt).localeCompare(String(a.createdAt)));
  const cash = Object.values(receipts).reduce((sum,x)=>sum+x.CASH,0);
  const card = Object.values(receipts).reduce((sum,x)=>sum+x.CARD,0);
  return { receipts, cash, card, total:cash+card,
    gameReceipts:receipts.GAME.CASH+receipts.GAME.CARD,
    topupReceipts:receipts.TOPUP.CASH+receipts.TOPUP.CARD,
    gameBalance:balance.reduce((sum,t)=>sum+t.amount,0),
    barBalance:rows.filter(r=>r.category==='BAR' && r.paymentMethod==='BALANCE').reduce((sum,r)=>sum+r.amount,0),
    rows };
}
