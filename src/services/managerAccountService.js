import crypto from 'node:crypto';
const TYPE='RESET_ADMIN_PASSWORD', ACTION='PROVISION_MANAGER';
const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const parse=value=>typeof value==='string'?JSON.parse(value):value;
const key=()=>crypto.createHash('sha256').update(process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').digest();
function seal(hash,clubId){const iv=crypto.randomBytes(12),cipher=crypto.createCipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(String(clubId)));const data=Buffer.concat([cipher.update(hash,'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),data].map(b=>b.toString('hex')).join(':');}
function unseal(value,clubId){const [iv,tag,data]=value.split(':').map(s=>Buffer.from(s,'hex'));const cipher=crypto.createDecipheriv('aes-256-gcm',key(),iv);cipher.setAAD(Buffer.from(String(clubId)));cipher.setAuthTag(tag);return Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8');}
function recordSignature(clubId,id,p){return crypto.createHmac('sha256',key()).update('manager-record:'+clubId+':'+id+':'+JSON.stringify({action:p.action,username:p.username,credential:p.credential})).digest('hex');}
function checked(row,clubId){if(!row)return null;const p=parse(row.payload);const expected=recordSignature(clubId,row.id,p);if(!/^[a-f0-9]{64}$/.test(p.authorization || '')||!crypto.timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(p.authorization,'hex')))throw fail('Akkaunt sozlamasining imzosi yaroqsiz.',503);return {...row,payload:p};}
export function validateManagerInput(input) {
  const username=String(input.username || '').trim(), password=String(input.password || '');
  if(!/^[a-zA-Z0-9_.-]{3,40}$/.test(username))throw fail('Login 3–40 ta harf, raqam, nuqta yoki pastki chiziqdan iborat bo‘lsin.');
  if(password.length<4 || password.length>128)throw fail('Parol 4–128 ta belgidan iborat bo‘lsin.');
  return {username,password};
}
export class ManagerAccountService {
  constructor(storage){
    this.db=storage.db;this.client=storage.client;
    this.role=storage.role || 'manager';
    if(!['manager','administrator'].includes(this.role))throw fail('Akkaunt turi yaroqsiz.');
    this.action=this.role==='manager'?ACTION:'PROVISION_ADMINISTRATOR';
  }
  async latest(clubId){
    if(this.db){
      const row=this.db.prepare("SELECT * FROM remote_commands WHERE club_id=? AND command_type=? AND json_extract(payload,'$.action')=? ORDER BY id DESC LIMIT 1").get(clubId,TYPE,this.action);
      return checked(row,clubId);
    }
    if(!this.client)throw fail('Bulut bazasi sozlanmagan.',503);
    const {data,error}=await this.client.from('remote_commands').select('id,club_id,payload,status,executed_at').eq('club_id',clubId).eq('command_type',TYPE).contains('payload',{action:this.action}).order('id',{ascending:false}).limit(1);
    if(error)throw fail('Akkaunt sozlamasini o‘qib bo‘lmadi.',503);
    return checked(data?.[0],clubId);
  }
  async summary(clubId){const row=await this.latest(clubId);return row?{configured:true,username:row.payload.username,revision:Number(row.id),applied:row.status==='EXECUTED'}:{configured:false,applied:false};}
  async save(clubId,input){
    if(!Number.isSafeInteger(clubId)||clubId<1)throw fail('Klub ID noto‘g‘ri.');
    const {username,password}=validateManagerInput(input);
    let exists;
    if(this.db)exists=this.db.prepare('SELECT id FROM clubs WHERE id=?').get(clubId);
    else {if(!this.client)throw fail('Bulut bazasi sozlanmagan.',503);const r=await this.client.from('clubs').select('id').eq('id',clubId).maybeSingle();if(r.error)throw fail('Klubni o‘qib bo‘lmadi.',503);exists=r.data;}
    if(!exists)throw fail('Klub topilmadi.',404);
    const other=new ManagerAccountService({db:this.db,client:this.client,role:this.role==='manager'?'administrator':'manager'});
    const otherAccount=await other.latest(clubId);
    if(otherAccount){
      if(otherAccount.payload.username===username)throw fail('Menejer va administrator loginlari alohida bo‘lishi kerak.');
      const [otherSalt,otherHash]=unseal(otherAccount.payload.credential,clubId).split(':');
      const candidate=crypto.pbkdf2Sync(password,otherSalt,100000,64,'sha512');
      if(crypto.timingSafeEqual(candidate,Buffer.from(otherHash,'hex')))throw fail('Menejer va administrator parollari alohida bo‘lishi kerak.');
    }
    const salt=crypto.randomBytes(16).toString('hex');
    const passwordHash=salt+':'+crypto.pbkdf2Sync(password,salt,100000,64,'sha512').toString('hex');
    const payload={action:this.action+'_DRAFT',username,credential:seal(passwordHash,clubId)};let row;
    if(this.db){const r=this.db.prepare("INSERT INTO remote_commands (club_id,command_type,payload,status) VALUES (?,?,?,'PENDING')").run(clubId,TYPE,JSON.stringify(payload));row={id:Number(r.lastInsertRowid)};}
    else {const r=await this.client.from('remote_commands').insert({club_id:clubId,command_type:TYPE,command:TYPE,payload,status:'PENDING'}).select('id').single();if(r.error)throw fail('Akkaunt sozlamasi saqlanmadi.',503);row=r.data;}
    payload.action=this.action;payload.authorization=recordSignature(clubId,row.id,payload);
    if(this.db)this.db.prepare('UPDATE remote_commands SET payload=? WHERE id=? AND club_id=?').run(JSON.stringify(payload),row.id,clubId);
    else {const r=await this.client.from('remote_commands').update({payload}).eq('id',row.id).eq('club_id',clubId);if(r.error)throw fail('Akkaunt sozlamasi tasdiqlanmadi.',503);}
    return {configured:true,username,revision:Number(row.id),applied:false};
  }
  async delivery(club,ack){
    const row=await this.latest(Number(club.id));if(!row || !club.hardware_fingerprint)return null;
    if(Number(ack)===Number(row.id)&&row.status!=='EXECUTED'){
      if(this.db)this.db.prepare("UPDATE remote_commands SET status='EXECUTED',executed_at=CURRENT_TIMESTAMP WHERE id=? AND club_id=?").run(row.id,club.id);
      else {const r=await this.client.from('remote_commands').update({status:'EXECUTED',executed_at:new Date().toISOString()}).eq('id',row.id).eq('club_id',club.id);if(r.error)throw fail('Tasdiq saqlanmadi.',503);}
    }
    const payload={kind:this.action,clubId:Number(club.id),hardwareFingerprint:club.hardware_fingerprint,revision:Number(row.id),username:row.payload.username,passwordHash:unseal(row.payload.credential,club.id)};
    const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('manager-account:'+JSON.stringify(payload)).digest('hex');
    return {payload,signature};
  }
}
