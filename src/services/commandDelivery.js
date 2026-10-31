import crypto from 'node:crypto';
export async function deliverCommands(storage,club,results=[]){
 const {db,client}=storage;
 for(const result of Array.isArray(results)?results.slice(0,100):[]){
  if(!Number.isSafeInteger(result.id)||!['EXECUTED','FAILED'].includes(result.status))continue;
  if(db)db.prepare("UPDATE remote_commands SET status=?,executed_at=CURRENT_TIMESTAMP WHERE id=? AND club_id=? AND command_type IN ('RESTART_SERVER','BROADCAST_ANNOUNCEMENT')").run(result.status,result.id,club.id);
  else {const r=await client.from('remote_commands').update({status:result.status,executed_at:new Date().toISOString()}).eq('id',result.id).eq('club_id',club.id).in('command_type',['RESTART_SERVER','BROADCAST_ANNOUNCEMENT']);if(r.error)throw Error('Buyruq tasdig‘i saqlanmadi.');}
 }
 let rows;
 if(db)rows=db.prepare("SELECT * FROM remote_commands WHERE club_id=? AND status='PENDING' AND command_type IN ('RESTART_SERVER','BROADCAST_ANNOUNCEMENT') ORDER BY id LIMIT 50").all(club.id);
 else {const r=await client.from('remote_commands').select('*').eq('club_id',club.id).eq('status','PENDING').in('command_type',['RESTART_SERVER','BROADCAST_ANNOUNCEMENT']).order('id',{ascending:true}).limit(50);if(r.error)throw Error('Buyruqlar o‘qilmadi.');rows=r.data||[];}
 return rows.map(row=>{
  const payload={id:Number(row.id),clubId:Number(club.id),hardwareFingerprint:club.hardware_fingerprint,action:row.command_type,options:typeof row.payload==='string'?JSON.parse(row.payload):row.payload};
  const signature=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update('remote-command:'+JSON.stringify(payload)).digest('hex');return {payload,signature};
 });
}
