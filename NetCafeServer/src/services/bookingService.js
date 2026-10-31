const fail=(message,statusCode=400)=>Object.assign(new Error(message),{statusCode});
const active=['PENDING','CONFIRMED','ACTIVE'];
function checkOverlap(db,clubId,computerId,start,end,exclude=0){
 const row=db.prepare("SELECT id FROM bookings WHERE club_id=? AND computer_id=? AND id<>? AND status IN ('PENDING','CONFIRMED','ACTIVE') AND julianday(end_time)>julianday(?) AND julianday(start_time)<julianday(?) LIMIT 1").get(clubId,computerId,exclude,start,end);
 if(row)throw fail('Ushbu kompyuter tanlangan vaqtda band qilingan.',409);
}
export function createBooking(db,clubId,userId,input){
 const raw=String(input.computerId??input.computer_id??'');
 const number=/^(?:PC-)?\d+$/i.test(raw)?Number(raw.match(/\d+$/)?.[0]):-1;
 const pc=db.prepare('SELECT id,pc_number FROM computers WHERE club_id=? AND (id=? OR name=? OR pc_number=?) ORDER BY CASE WHEN id=? THEN 0 ELSE 1 END LIMIT 1').get(clubId,raw,raw,number||-1,raw);
 if(!pc)throw fail('Kompyuter topilmadi.',404);
 const name=String(input.customerName??input.customer_name??'').trim();
 const startMs=Date.parse(input.startTime??input.start_time),endMs=Date.parse(input.endTime??input.end_time);
 if(!name||name.length>160||!Number.isFinite(startMs)||!Number.isFinite(endMs)||endMs<=startMs)throw fail('Mijoz ismi va to‘g‘ri boshlanish/tugash vaqtini kiriting.');
 const status=input.status??'CONFIRMED';if(!['PENDING','CONFIRMED','CANCELLED','COMPLETED'].includes(status))throw fail('Bron holati yaroqsiz.');
 const start=new Date(startMs).toISOString(),end=new Date(endMs).toISOString();
 const phone=String(input.customerPhone??input.customer_phone??'').slice(0,60),note=String(input.note??'').slice(0,2000);
 if(active.includes(status))checkOverlap(db,clubId,pc.pc_number,start,end);
 const result=db.prepare('INSERT INTO bookings (club_id,computer_id,customer_name,customer_phone,start_time,end_time,note,status,created_by) VALUES (?,?,?,?,?,?,?,?,?)').run(clubId,pc.pc_number,name,phone,start,end,note,status,String(userId));
 return {id:Number(result.lastInsertRowid),clubId,computerId:pc.pc_number,customerName:name,customerPhone:phone,startTime:start,endTime:end,note,status};
}
export function updateBookingStatus(db,clubId,id,status){
 if(!['PENDING','CONFIRMED','ACTIVE','CANCELLED','COMPLETED'].includes(status))throw fail('Bron holati yaroqsiz.');
 const row=clubId===null?db.prepare('SELECT * FROM bookings WHERE id=?').get(id):db.prepare('SELECT * FROM bookings WHERE id=? AND club_id=?').get(id,clubId);
 if(!row)throw fail('Bron topilmadi.',404);
 if(active.includes(status))checkOverlap(db,row.club_id,row.computer_id,row.start_time,row.end_time,id);
 db.prepare('UPDATE bookings SET status=? WHERE id=?').run(status,id);
 return {id,status};
}
