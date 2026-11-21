import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeBookings} from '../NetCafeServer/src/services/bookingSchema.js';
import {reservationForComputer,sendReservationState} from '../NetCafeServer/src/services/bookingPresentation.js';
import {listBookingRows} from '../NetCafeServer/src/services/bookingList.js';
import {readBookingSettings,saveBookingSettings} from '../NetCafeServer/src/services/bookingFoundation.js';
import {initializeMoneyOperations} from '../NetCafeServer/src/services/moneyOperations.js';
import {clubFields,clubInstant} from '../public/mobile/booking-time.js';
import {mobileRoleAllows} from '../NetCafeServer/src/services/mobileRolePolicy.js';
import {allowedMobileRequest} from '../NetCafeServer/src/services/mobileAgent.js';

function fixture(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(fs.readFileSync('NetCafeServer/schema.sql','utf8'));
 db.exec("INSERT INTO clubs(id,name,owner_name,phone,expires_at) VALUES(1,'Test','T','0','2099-01-01'),(2,'Other','T','0','2099-01-01'); INSERT INTO computers(id,club_id,pc_number,name) VALUES('a',1,1,'PC-01'),('b',2,1,'PC-01')");initializeBookings(db);initializeMoneyOperations(db);return db;}
const now=Date.parse('2030-01-01T10:00:00Z');
function add(db,id,club=1,pc='a'){db.prepare("INSERT INTO bookings(id,club_id,computer_id,computer_ref,start_time,end_time,no_show_at,status,booking_version) VALUES(?,?,1,?,?,?,?,'CONFIRMED',2)").run(id,club,pc,'2030-01-01T14:59:00+05:00','2030-01-01T11:00:00Z','2030-01-01T10:10:00Z');}
test('client reservation follows server interval, cancellation, tenant and active session; sends no personal data',t=>{const db=fixture(t);add(db,1);const pc={id:'a',club_id:1};
 assert.equal(reservationForComputer(db,pc,now-120000),null);assert.equal(reservationForComputer(db,pc,now).id,1);assert.equal(reservationForComputer(db,{id:'b',club_id:2},now),null);
 let packet;sendReservationState(db,{send:(...args)=>packet=args},'a',now);assert.equal(packet[0],'a');assert.equal(packet[1],'BOOKING_STATE');assert.equal(packet[2].reserved,true);assert.equal(packet[2].pcNumber,1);assert.equal(packet[2].customerName,undefined);
 db.exec("INSERT INTO tariffs(id,club_id,name,price_per_hour) VALUES('t',1,'Test',7000); INSERT INTO sessions(id,club_id,computer_id,tariff_id,started_at,ends_at,total_amount,status) VALUES('s',1,'a','t','2030-01-01','2030-01-02',7000,'ACTIVE')");assert.equal(reservationForComputer(db,pc,now),null);
 db.exec("UPDATE sessions SET status='COMPLETED' WHERE id='s'; UPDATE bookings SET status='CANCELLED' WHERE id=1");assert.equal(reservationForComputer(db,pc,now),null);
 db.exec("UPDATE bookings SET status='CONFIRMED' WHERE id=1");assert.equal(reservationForComputer(db,pc,now+600000),null);
});
test('booking listing is tenant-scoped, bounded, paginated and reaches all dates',t=>{const db=fixture(t);for(let i=1;i<=105;i++)add(db,i);add(db,106,2,'b');
 const params=new URLSearchParams({date:'2030-01-01'});let r=listBookingRows(db,1,params);assert.equal(r.page.total,105);assert.equal(r.rows.length,100);assert.equal(r.page.hasMore,true);
 params.set('offset','100');r=listBookingRows(db,1,params);assert.equal(r.rows.length,5);assert.equal(r.page.hasMore,false);
 assert.equal(listBookingRows(db,2,new URLSearchParams({date:'2030-01-01'})).page.total,1);
 assert.equal(listBookingRows(db,1,new URLSearchParams({date:'2030-01-02'})).rows.length,0);
 assert.throws(()=>listBookingRows(db,1,new URLSearchParams({date:'2030-02-31'})));
});
test('phone timezone does not change club booking time; invalid and ambiguous local dates are rejected',()=>{
 assert.equal(clubInstant('2030-01-02','00:30','Asia/Tashkent'),'2030-01-01T19:30:00.000Z');
 assert.equal(clubFields('2030-01-01T19:30:00Z','Asia/Tashkent').time,'00:30');
 assert.throws(()=>clubInstant('2030-02-31','10:00','Asia/Tashkent'));
 assert.throws(()=>clubInstant('2030-03-10','02:30','America/New_York'));
 assert.throws(()=>clubInstant('2030-11-03','01:30','America/New_York'));
});
test('both staff roles can change grace; mobile manager cannot create or start bookings',t=>{const db=fixture(t),a={clubId:1,id:1,username:'Test',role:'administrator',permissions:[]};
 assert.equal(readBookingSettings(db,a).graceMinutes,10);assert.equal(saveBookingSettings(db,a,{requestId:'grace-ui-test',expectedRevision:0,graceMinutes:15}).body.settings.graceMinutes,15);
 assert.throws(()=>saveBookingSettings(db,a,{requestId:'grace-zero-test',expectedRevision:1,graceMinutes:0}),{statusCode:400});
 for(const role of ['administrator','manager','club_owner'])assert.equal(mobileRoleAllows(role,'/api/booking-settings','PUT'),true);
 for(const path of ['/api/bookings','/api/bookings/1/check-in','/api/bookings/1/refund'])assert.equal(mobileRoleAllows('manager',path,'POST'),false);
 for(const path of ['/api/bookings/1/check-in-preview','/api/bookings/1/check-in','/api/bookings/1/refund'])assert.equal(allowedMobileRequest({path,method:'POST'}),true);
 assert.equal(allowedMobileRequest({path:'/api/bookings?date=2030-01-01&offset=100&refunds=0&computer=a',method:'GET'}),true);
 const group='00000000-0000-4000-8000-000000000001';
 assert.equal(allowedMobileRequest({path:'/api/bookings?groupId='+group,method:'GET'}),true);
 for(const path of ['/api/bookings/allocation-preview',...['check-in-preview','check-in','checkout-preview','checkout'].map(a=>'/api/booking-groups/'+group+'/'+a)]){
  assert.equal(allowedMobileRequest({path,method:'POST'}),true);assert.equal(mobileRoleAllows('manager',path,'POST'),false);assert.equal(mobileRoleAllows('administrator',path,'POST'),true);
 }
});
