import test from 'node:test';
import assert from 'node:assert/strict';
process.env.VERCEL='1';process.env.SUPERADMIN_JWT_SECRET='test-only-manager-api-secret-at-least-32-bytes';
process.env.SUPABASE_URL='';process.env.SUPABASE_SERVICE_ROLE_KEY='';
function storage(){
 const tables={clubs:[{id:7,hardware_fingerprint:'test-hwid'}],remote_commands:[]};
 const client={tables,failure:false,from(table){
  assert.ok(tables[table]);let op='select',values,single=false,filters=[],limit=Infinity,descending=false;
  const q={select(){return q;},eq(k,v){filters.push(r=>String(r[k])===String(v));return q;},contains(k,v){filters.push(r=>Object.entries(v).every(([key,val])=>r[k]?.[key]===val));return q;},order(){descending=true;return q;},limit(n){limit=n;return q;},maybeSingle(){single=true;return q;},single(){single=true;return q;},insert(v){op='insert';values=structuredClone(v);return q;},update(v){op='update';values=structuredClone(v);return q;},then(resolve,reject){
   try{
    if(client.failure)return Promise.resolve({data:null,error:{message:'unavailable'}}).then(resolve,reject);
    let rows=tables[table].filter(r=>filters.every(f=>f(r)));
    if(op==='insert'){const row={id:tables[table].length+1,...values};tables[table].push(row);rows=[row];}
    if(op==='update')rows.forEach(r=>Object.assign(r,values));
    if(descending)rows.sort((a,b)=>b.id-a.id);rows=rows.slice(0,limit);
    return Promise.resolve({data:structuredClone(single?(rows[0]||null):rows),error:null}).then(resolve,reject);
   }catch(error){return Promise.reject(error).then(resolve,reject);}
  }};return q;
 }};return client;
}
for(const prefix of ['','SoftechCloudAdmin/'])test(prefix+'Vercel manager API: authority, storage, delivery and acknowledgement',async()=>{
 const {default:handler}=await import('../'+prefix+'api/index.js');
 const {SupabaseCloudService:cloud}=await import('../'+prefix+'src/services/supabaseClient.js');
 const {ManagerAccountService}=await import('../'+prefix+'src/services/managerAccountService.js');
 const {signAccessToken}=await import('../'+prefix+'src/utils/jwt.js');
 const client=storage();cloud.client=client;
 async function api(method,body,role='superadmin',id=7,account='manager'){let result;await handler({url:'/api/clubs/'+id+'/'+account,method,body,headers:{host:'localhost',...(role?{authorization:'Bearer '+signAccessToken({id:1,sub:1,role,username:'test'})}:{})}},{setHeader(){},end(body){result={status:this.statusCode,body:JSON.parse(body)};}});return result;}
 const credentials={username:'club_owner',password:'1234'};
 assert.equal((await api('PUT',credentials,null)).status,401);
 assert.equal((await api('GET',{},'manager')).status,401);
 assert.equal((await api('GET')).body.manager.configured,false);
 assert.equal((await api('PUT',{...credentials,password:'123'})).status,400);
 assert.equal((await api('PUT',credentials,'superadmin',8)).status,404);
 const saved=await api('PUT',credentials);assert.equal(saved.status,200,JSON.stringify(saved.body));assert.equal(saved.body.manager.applied,false);
 assert.equal(client.tables.remote_commands[0].command,'RESET_ADMIN_PASSWORD');
 const summary=await api('GET');assert.equal(summary.body.manager.username,'club_owner');assert.ok(!JSON.stringify(summary).includes('password'));
 const service=new ManagerAccountService({client});const packet=await service.delivery(client.tables.clubs[0],0);assert.equal(packet.payload.username,'club_owner');assert.ok(packet.signature);
 await service.delivery(client.tables.clubs[0],packet.payload.revision);assert.equal((await api('GET')).body.manager.applied,true);
 const next=await api('PUT',{username:'changed_owner',password:'another-long-password'});assert.ok(next.body.manager.revision>packet.payload.revision);assert.equal((await api('GET')).body.manager.applied,false);
 const staffCredentials={username:'cashier_one',password:'5678'};
 assert.equal((await api('PUT',staffCredentials,null,7,'administrator')).status,401);
 assert.equal((await api('PUT',staffCredentials,'administrator',7,'administrator')).status,401);
 const staff=await api('PUT',staffCredentials,'superadmin',7,'administrator');assert.equal(staff.status,200,JSON.stringify(staff));
 assert.equal(staff.body.administrator.applied,false);
 assert.equal((await api('PUT',{...staffCredentials,username:'changed_owner'},'superadmin',7,'administrator')).status,400);
 assert.equal((await api('PUT',{...staffCredentials,password:'another-long-password'},'superadmin',7,'administrator')).status,400);
 const staffService=new ManagerAccountService({client,role:'administrator'});
 const staffPacket=await staffService.delivery(client.tables.clubs[0],0);assert.equal(staffPacket.payload.kind,'PROVISION_ADMINISTRATOR');
 await staffService.delivery(client.tables.clubs[0],staffPacket.payload.revision);
 assert.equal((await api('GET',{},'superadmin',7,'administrator')).body.administrator.applied,true);
 assert.equal((await api('GET')).body.manager.applied,false,'Cashier acknowledgement cannot acknowledge manager');
 client.failure=true;assert.equal((await api('PUT',credentials)).status,503);assert.equal((await api('GET')).status,503);
});
