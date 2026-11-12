export const isPostpaidSession = session => /^(BATCH_)?(POSTPAID|VIP)(?:$| \| TRANSFER:)/i.test(session?.notes || '');
