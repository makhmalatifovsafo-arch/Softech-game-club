import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {HwidService} from './hwidService.js';

const MASTER=process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026';
const LEASE=72*60*60*1000;
export function verifyEmergencyLicense(root,now=Date.now()) {
  try {
    if(fs.existsSync(path.join(root,'data','license_lock.json')))return {ok:false,reason:'Litsenziya bloklangan.'};
    const signed=JSON.parse(fs.readFileSync(path.join(root,'data','softech_license.sig'),'utf8'));
    const payload=signed?.payload;
    if(!payload||typeof signed.signature!=='string')throw Error('Litsenziya topilmadi.');
    const expected=crypto.createHmac('sha256',MASTER).update(JSON.stringify(payload)).digest('hex');
    const a=Buffer.from(signed.signature),b=Buffer.from(expected);
    if(a.length!==b.length||!crypto.timingSafeEqual(a,b))throw Error('Litsenziya imzosi yaroqsiz.');
    if(payload.hardwareFingerprint!==HwidService.getHardwareFingerprint())throw Error('Litsenziya ushbu serverga tegishli emas.');
    if(payload.status!=='ACTIVE'||!Number.isFinite(Date.parse(payload.expiresAt))||Date.parse(payload.expiresAt)<=now)throw Error('Litsenziya faol emas yoki muddati tugagan.');
    const verified=Date.parse(payload.verifiedAt);
    if(!Number.isFinite(verified)||now-verified>LEASE||now<verified-300000)throw Error('Litsenziyani bulut orqali tekshirish kerak.');
    const clock=path.join(root,'data','clock_guard.sec');
    if(fs.existsSync(clock)){
      const [stamp,mac]=fs.readFileSync(clock,'utf8').split(':');
      const expectedClock=crypto.createHmac('sha256',MASTER).update(stamp).digest('hex').slice(0,16);
      if(mac!==expectedClock||now<Number(stamp)-300000)throw Error('Tizim vaqti tekshiruvi muvaffaqiyatsiz.');
    }
    return {ok:true,payload,maxPcs:Math.max(1,Math.min(1000,Number(payload.maxPcs)||1))};
  }catch(error){return {ok:false,reason:error.message||'Litsenziya tekshirilmadi.'};}
}
