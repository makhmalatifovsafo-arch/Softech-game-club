import crypto from 'node:crypto';
import { db } from '../db.js';
export function createClientBarOrder(pcId, payload) {
  const pc = db.prepare('SELECT * FROM computers WHERE id = ?').get(pcId);
  const session = pc && db.prepare("SELECT * FROM sessions WHERE id = ? AND status='ACTIVE'").get(pc.current_session_id);
  if (!session) throw new Error('Buyurtma uchun faol seans kerak.');
  const requestId=payload.requestId || null;
  if(requestId && !/^[a-zA-Z0-9-]{8,100}$/.test(requestId)) throw new Error('Buyurtma ID noto‘g‘ri.');
  if(requestId) {
    const prior=db.prepare('SELECT * FROM bar_orders WHERE club_id=? AND request_id=? AND session_id=?').get(pc.club_id,requestId,session.id);
    if(prior)return {id:prior.id,orderId:prior.id,totalAmount:prior.total_amount,requestId,replayed:true};
  }
  if (!Array.isArray(payload.items) || !payload.items.length || payload.items.length > 100) throw new Error('Mahsulotlar tanlanmagan.');
  const lines = payload.items.map(it => {
    const item = db.prepare('SELECT * FROM bar_items WHERE id = ? AND club_id = ? AND is_active = 1').get(Number(it.id ?? it.barItemId),pc.club_id);
    const quantity = Number(it.quantity);
    if (!item || !Number.isInteger(quantity) || quantity < 1 || quantity > item.stock_quantity) throw new Error('Mahsulot yoki miqdor notogri.');
    return { ...item, quantity };
  });
  const method = ({FROM_MEMBER_BALANCE:'CLIENT_BALANCE',CASH_TO_ADMIN:'CASH'})[payload.paymentMethod] || payload.paymentMethod || 'ON_PC_SESSION';
  if (!['CASH','CLIENT_BALANCE','ON_PC_SESSION'].includes(method)) throw new Error('Tolov usuli notogri.');
  if (method === 'CLIENT_BALANCE' && !session.user_id) throw new Error('Mijoz akkaunti kerak.');
  const total = lines.reduce((sum,it)=>sum+it.sell_price*it.quantity,0);
  db.exec('BEGIN');
  try {
    const result=db.prepare("INSERT INTO bar_orders (club_id,order_number,computer_id,session_id,total_amount,payment_status,payment_method,approval_status,user_id) VALUES (?,?,?,?,?,'PENDING_AT_CHECKOUT',?,'PENDING',?)").run(pc.club_id,'ORD-'+crypto.randomUUID(),pc.pc_number,session.id,total,method,session.user_id??null);
    const id=Number(result.lastInsertRowid);
    if(requestId)db.prepare("UPDATE bar_orders SET request_id=? WHERE id=?").run(requestId,id);
    for(const it of lines) db.prepare('INSERT INTO bar_order_items (order_id,bar_item_id,item_name,quantity,unit_price,total_price,buy_price) VALUES (?,?,?,?,?,?,?)').run(id,it.id,it.name,it.quantity,it.sell_price,it.sell_price*it.quantity,it.buy_price);
    db.exec('COMMIT'); return { id,orderId:id,requestId,orderNumber:db.prepare('SELECT order_number FROM bar_orders WHERE id=?').get(id).order_number,
      pcNumber:pc.name || 'PC-'+pc.pc_number,paymentOption:method==='CLIENT_BALANCE'?'FROM_MEMBER_BALANCE':method,
      items:lines.map(it=>({name:it.name,quantity:it.quantity,price:it.sell_price})),
      totalAmount:total, computerId:pc.id, sessionId:session.id };
  } catch(e) {db.exec('ROLLBACK');throw e;}
}
export function confirmClientBarOrder(order, clubId, cashierUserId) {
  if (order.approval_status !== 'PENDING' || order.payment_status === 'CANCELLED') throw new Error('Buyurtma avval korib chiqilgan.');
  const session=db.prepare("SELECT id FROM sessions WHERE id=? AND club_id=? AND status='ACTIVE'").get(order.session_id,clubId);
  if (!session) throw new Error('Buyurtma seansi tugagan.');
  db.exec('BEGIN');
  try {
    const lines=db.prepare('SELECT * FROM bar_order_items WHERE order_id=?').all(order.id);
    for(const it of lines) {
      const changed=db.prepare('UPDATE bar_items SET stock_quantity=stock_quantity-? WHERE id=? AND club_id=? AND stock_quantity>=?').run(it.quantity,it.bar_item_id,clubId,it.quantity);
      if(changed.changes!==1)throw new Error('Omborda yetarli mahsulot yoq.');
    }
    const result=db.prepare("UPDATE bar_orders SET approval_status='CONFIRMED' WHERE id=? AND approval_status='PENDING'").run(order.id);
    if(result.changes!==1)throw new Error('Buyurtma avval tasdiqlangan.');
    if(order.payment_method === 'CLIENT_BALANCE') {
      const debit=db.prepare('UPDATE users SET balance=balance-? WHERE id=? AND club_id=? AND balance>=?').run(order.total_amount,order.user_id,clubId,order.total_amount);
      if(debit.changes!==1)throw new Error('Mijoz balansi yetarli emas.');
      db.prepare("INSERT INTO client_transactions (club_id,user_id,amount,type,payment_method,category) VALUES (?,?,?,'SESSION_DEDUCT','BALANCE','BAR')").run(clubId,order.user_id,order.total_amount);
    }
    if(order.payment_method === 'CASH') {
      db.prepare("INSERT INTO transactions (id,club_id,session_id,amount,payment_type,payment_method,transaction_type,created_by,notes) VALUES (?,?,?,?,'CASH','CASH','BAR_SALE',?,?)").run('tx_'+crypto.randomUUID(),clubId,order.session_id,order.total_amount,String(cashierUserId),'BAR_SALE:'+order.order_number);
    }
    if(order.payment_method !== 'ON_PC_SESSION') db.prepare("UPDATE bar_orders SET payment_status='PAID',paid_at=CURRENT_TIMESTAMP WHERE id=?").run(order.id);
    db.exec('COMMIT');
  }catch(e){db.exec('ROLLBACK');throw e;}
}

export function payPendingBarOrder(orderId,clubId,method,cashierId) {
  if(!['CASH','CARD'].includes(method))throw new Error('Naqd yoki kartani tanlang.');
  db.exec('BEGIN IMMEDIATE');
  try {
    const order=db.prepare("SELECT * FROM bar_orders WHERE id=? AND club_id=? AND payment_status='PENDING_AT_CHECKOUT' AND approval_status='CONFIRMED'").get(orderId,clubId);
    if(!order)throw new Error('To‘lanmagan tasdiqlangan buyurtma topilmadi.');
    db.prepare("INSERT INTO transactions (id,club_id,session_id,amount,payment_type,payment_method,transaction_type,created_by,notes) VALUES (?,?,?,?,?,?,'BAR_SALE',?,?)")
      .run('tx_'+crypto.randomUUID(),clubId,order.session_id,order.total_amount,method,method,String(cashierId),'BAR_SALE_DEBT:'+order.order_number);
    db.prepare("UPDATE bar_orders SET payment_status='PAID',payment_method=?,paid_at=CURRENT_TIMESTAMP WHERE id=?").run(method,order.id);
    db.exec('COMMIT');return {success:true,amountCollected:order.total_amount};
  }catch(error){db.exec('ROLLBACK');throw error;}
}
