import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileRoleAllows,mobileStaffView} from '../NetCafeServer/src/services/mobileRolePolicy.js';
import {allowedMobileRequest} from '../NetCafeServer/src/services/mobileAgent.js';
import {managerSettingRequest} from '../public/mobile/manager-tools.js';
test('mobile manager can observe but cannot operate through legacy or cloud sessions',()=>{
 for(const role of ['manager','club_owner']){
  for(const [path,method] of [['/api/bar/orders','POST'],['/api/bar/items','GET'],['/api/sessions/start','POST'],['/api/computers/pc_1/power','POST'],['/api/shifts/current','POST'],['/api/bookings/1/status','PUT'],['/api/clients/topup','POST']])assert.equal(mobileRoleAllows(role,path,method),false,path);
  assert.equal(mobileRoleAllows(role,'/api/reports/financial?from=2026-11-10','GET'),true);
  assert.equal(mobileRoleAllows(role,'/api/shifts/current','GET'),true);
 }
});
test('cashier operations are allowlisted but financial reports and staff management are excluded',()=>{
 assert.equal(mobileRoleAllows('administrator','/api/reports/financial','GET'),false);
 for(const [path,method] of [['/api/bookings/1/status','PUT'],['/api/bar/orders/1/pay','POST'],['/api/bar/orders/confirm','POST'],['/api/clients/topup','POST'],['/api/sessions/transfer','POST']]){
  assert.equal(allowedMobileRequest({path,method}),true,path);assert.equal(mobileRoleAllows('administrator',path,method),true);
 }
 for(const [path,method] of [['/api/admin/users','POST'],['/api/admin/users/1/permissions','PUT'],['/api/admin/users/1','DELETE'],['/api/admin/tariffs','PUT'],['/api/admin/settings','PUT'],['/api/admin/tariff-schedules','POST'],['/api/admin/tariff-schedules/1','DELETE']]){
  assert.equal(allowedMobileRequest({path,method}),true);
  assert.equal(managerSettingRequest(path,method),true);
  assert.equal(mobileRoleAllows('club_owner',path,method),true);
  assert.equal(mobileRoleAllows('administrator',path,method),false);
 }
});
test('cashier shift and customer responses do not leak financial totals or staff accounts',()=>{
 assert.deepEqual(mobileStaffView('administrator','/api/shifts/current',{shift:{id:1,openedAt:'today',systemCash:99999,systemCard:88888,expectedCash:99999}}),{success:true,hasOpenShift:true,shift:{id:1,openedAt:'today'}});
 assert.deepEqual(mobileStaffView('administrator','/api/admin/users',[{id:1,role:'club_owner'},{id:2,role:'client'}]),[{id:2,role:'client'}]);
});
