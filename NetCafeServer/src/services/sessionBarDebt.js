// Only confirmed, unpaid orders belonging to this session may be collected.
export function getSessionBarDebt(db, session, pcNumber) {
  const orders = db.prepare(`SELECT * FROM bar_orders WHERE club_id=?
    AND payment_status='PENDING_AT_CHECKOUT' AND approval_status='CONFIRMED'
    AND (session_id=? OR (?='ACTIVE' AND session_id IS NULL AND (computer_id=? OR computer_id=?)))
    ORDER BY id`).all(session.club_id, session.id, session.status, session.computer_id, pcNumber);
  const items = orders.flatMap(order => db.prepare('SELECT * FROM bar_order_items WHERE order_id=? ORDER BY id').all(order.id)
    .map(item => ({ orderId: order.id, orderNumber: order.order_number, barItemId: item.bar_item_id,
      itemName: item.item_name, quantity: Number(item.quantity), unitPrice: Number(item.unit_price), totalPrice: Number(item.total_price) })));
  const grouped = new Map();
  for (const item of items) grouped.set(item.itemName, (grouped.get(item.itemName) || 0) + item.quantity);
  return { orders, items, total: orders.reduce((sum, order) => sum + Number(order.total_amount), 0),
    summary: [...grouped].map(([name, quantity]) => `${quantity} ta ${name}`).join(', ') };
}
