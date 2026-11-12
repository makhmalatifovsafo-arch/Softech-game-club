export const isPostpaidSession = session => /^(BATCH_)?(POSTPAID|VIP)(?:$| \| TRANSFER:)/i.test(session?.notes || '');
export const canClientCloseSession = session => Number(session?.client_self_service) === 1 &&
  /^CLIENT_BALANCE_(PREPAID|LIVE):/.test(session?.notes || '') && !isPostpaidSession(session);
