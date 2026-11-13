// The first segment is the billing mode. Bar order/transfer audit segments
// must never turn an unpaid VIP session into a zero-priced prepaid session.
export const isPostpaidSession = session => /^(BATCH_)?(POSTPAID|VIP)$/i.test(String(session?.notes || '').split('|',1)[0].trim());
export const canClientCloseSession = session => Number(session?.client_self_service) === 1 &&
  /^CLIENT_BALANCE_(PREPAID|LIVE):/.test(session?.notes || '') && !isPostpaidSession(session);
