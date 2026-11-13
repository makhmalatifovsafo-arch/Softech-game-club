import { randomUUID } from 'node:crypto';
const pending = new Map();
export function acknowledgeScreenMessage(socket, payload) {
  const item = pending.get(payload?.messageId);
  if (item?.socket === socket) item.finish(true);
}
export function deliverScreenMessage(socket, {title, message}, timeoutMs = 8000) {
  if (!socket || socket.readyState !== 1) return Promise.resolve('offline');
  const messageId = randomUUID();
  return new Promise(resolve => {
    const finish = value => { clearTimeout(timer); pending.delete(messageId); resolve(value === true ? 'displayed' : value); };
    const timer = setTimeout(() => finish('unconfirmed'), timeoutMs);
    pending.set(messageId, {socket, finish});
    try { socket.send(JSON.stringify({type:'SEND_MESSAGE',payload:{messageId,title,message,displayDurationSeconds:30}}), error => {if(error)finish('offline');}); }
    catch { finish('offline'); }
  });
}
