// Recovery for the confirmed all-NUL config only. Never modify license or DB.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

function object(bytes) {
  const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
  if(!value||typeof value!=='object'||Array.isArray(value))throw Error();
  return value;
}
function durableNewFile(file,bytes) {
  const fd=fs.openSync(file,'wx');
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
}
function cloudUrl(value) {
  const url=new URL(value);
  if(!['http:','https:'].includes(url.protocol)||url.username||url.password||url.search||url.hash)throw Error();
  return url.toString().replace(/\/+$/,'');
}

export function restoreEmptyConfig(directory, {confirmedClubId} = {}) {
  const file=path.join(directory,'config.json');
  const original=fs.readFileSync(file);
  if(!original.length||!original.every(byte=>byte===0))
    throw Error('Bu vosita faqat butunlay bosh belgilar bilan buzilgan config uchun. Fayl ozgartirilmadi.');
  let license;
  try {
    license=object(fs.readFileSync(path.join(directory,'data/softech_license.sig')));
    const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026')
      .update(JSON.stringify(license.payload)).digest('hex');
    if(signature!==license.signature||!Number.isSafeInteger(Number(license.payload.clubId))||Number(license.payload.clubId)<=0)throw Error();
  }catch{
    license=null;
    if(confirmedClubId!==10)throw Error('Mavjud litsenziyadan klub raqamini ishonchli aniqlab bolmadi. Hech narsa almashtirilmadi.');
  }
  // Club 10 was explicitly confirmed by the owner in the super admin panel.
  // This only restores config; cloud signature/HWID/ban checks still apply.
  if(confirmedClubId!==undefined&&confirmedClubId!==10)throw Error('Faqat tasdiqlangan 10-klub uchun.');
  if(license&&confirmedClubId!==undefined&&Number(license.payload.clubId)!==confirmedClubId)
    throw Error('Mavjud litsenziya boshqa klubga tegishli. Fayllar ozgartirilmadi.');
  const clubId=license?Number(license.payload.clubId):confirmedClubId;
  let config,source;
  const saved=path.join(directory,'config.json.last-good');
  if(fs.existsSync(saved)) {
    try {
      config=object(fs.readFileSync(saved));
      if(Number(config.clubId)!==clubId)throw Error();
      cloudUrl(config.cloudUrl);
      source='saved-settings';
    }catch{throw Error('Sozlamalar zaxirasi ushbu klubga mos emas yoki buzilgan. Fayllar saqlandi.');}
  } else {
    // This recovery bundle targets the Softech service used in this incident.
    config={cloudUrl:cloudUrl(process.env.SOFTECH_CLOUD_URL||'https://softech-game-club.vercel.app'),clubId,updateIdleSeconds:10};
    source='existing-license-and-softech-defaults';
  }
  const bytes=Buffer.from(JSON.stringify(config,null,2)+'\n');
  const id=crypto.randomUUID();
  const backup=file+'.before-null-recovery-'+id+'.bak';
  const temporary=file+'.recovery-'+id+'.tmp';
  durableNewFile(backup,original);
  try {
    durableNewFile(temporary,bytes);
    if(!fs.readFileSync(file).equals(original))throw Error('Sozlamalar boshqa jarayonda ozgardi. Softech oynasini yopib qayta urining.');
    fs.renameSync(temporary,file);
    if(!fs.readFileSync(file).equals(bytes))throw Error('Yangi fayl qayta tekshiruvdan otmadi. Zaxira saqlangan.');
  } finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
  return {source,clubId,backup};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  try {
    const result=restoreEmptyConfig(path.resolve(process.argv[2]||'C:\\SoftechServer'));
    console.log('TIKLANDI: server sozlamalari mavjud klub litsenziyasi asosida tiklandi.');
    console.log(result.source==='saved-settings'?'Saqlangan sozlamalar zaxirasi ishlatildi.':'Softech bulut manzili va litsenziyadagi klub raqami ishlatildi.');
    console.log('Baza, savdolar, litsenziya va bloklash fayllari ozgartirilmadi.');
    console.log('Endi Softech Serverni oching.');
  } catch(error) {
    console.log('TIKLANMADI: '+(error.code?'Faylga kirish xatosi ('+error.code+').':error.message));
    process.exitCode=1;
  }
}
