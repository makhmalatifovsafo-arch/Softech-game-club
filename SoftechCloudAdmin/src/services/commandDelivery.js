import crypto from 'node:crypto';
export async function deliverCommands(storage,club,results=[]){
 const {db,client}=storage;
 for(const result of Array.isArray(results)?results.slice(0,100):[]){
  if(!Number.isSafeInteger(result.id)||!['PENDING','EXECUTED','FAILED'].includes(result.status))continue;
  const types=['RESTART_SERVER','FORCE_UPDATE','FORCE_CLIENT_UPDATE','BROADCAST_ANNOUNCEMENT'];
  let row;
  if(db)row=db.prepare("SELECT * FROM remote_commands WHERE id=? AND club_id=? AND status='PENDING'").get(result.id,club.id);
  else {const r=await client.from('remote_commands').select('*').eq('id',result.id).eq('club_id',club.id).eq('status','PENDING').maybeSingle();if(r.error)throw Error('Buyruq holati o‘qilmadi.');row=r.data;}
  if(!row||!types.includes(row.command_type))continue;
  const payload=typeof row.payload==='string'?JSON.parse(row.payload):row.payload||{};
  payload.result={message:String(result.message||'').slice(0,500),version:String(result.version||'').slice(0,32),at:new Date().toISOString()};
  const executedAt=result.status==='PENDING'?null:new Date().toISOString();
  if(db)db.prepare("UPDATE remote_commands SET status=?,payload=?,executed_at=? WHERE id=? AND club_id=? AND status='PENDING'").run(result.status,JSON.stringify(payload),executedAt,result.id,club.id);
  else {const r=await client.from('remote_commands').update({status:result.status,payload,executed_at:executedAt}).eq('id',result.id).eq('club_id',club.id).eq('status','PENDING');if(r.error)throw Error('Buyruq tasdig‘i saqlanmadi.');}
 }
 let rows;
 if(db)rows=db.prepare("SELECT * FROM remote_commands WHERE club_id=? AND status='PENDING' AND command_type IN ('RESTART_SERVER','FORCE_UPDATE','FORCE_CLIENT_UPDATE','BROADCAST_ANNOUNCEMENT') ORDER BY id LIMIT 50").all(club.id);
 else {const r=await client.from('remote_commands').select('*').eq('club_id',club.id).eq('status','PENDING').in('command_type',['RESTART_SERVER','FORCE_UPDATE','FORCE_CLIENT_UPDATE','BROADCAST_ANNOUNCEMENT']).order('id',{ascending:true}).limit(50);if(r.error)throw Error('Buyruqlar o‘qilmadi.');rows=r.data||[];}
 return rows.map(row=>{
  const payload={id:Number(row.id),clubId:Number(club.id),hardwareFingerprint:club.hardware_fingerprint,action:row.command_type,options:typeof row.payload==='string'?JSON.parse(row.payload):row.payload};
  const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('remote-command:'+JSON.stringify(payload)).digest('hex');return {payload,signature};
 });
}
