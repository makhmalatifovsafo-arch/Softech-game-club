import {mergeFinancialReports,cloudFinancialReports,platformAnalytics} from './financialTelemetry.js';
import { formatClubInspector } from './clubInspector.js';
﻿const failure=(message,statusCode=503)=>Object.assign(new Error(message),{statusCode});
export function monthlyFee(club){
 const type=['FIXED','FIXED_MONTHLY'].includes(club.tariff_type)?'FIXED':'PER_PC';
 const price=Number(club.tariff_price_per_pc??20000),fixed=Number(club.tariff_fixed_price??500000),count=Number(club.total_workstations??0);
 return {tariffType:type,monthlyFee:type==='FIXED'?fixed:count*price,description:type==='FIXED'?`${fixed} UZS / oy`:`${count} PC × ${price} UZS`,pricePerPc:price,totalPcs:count};
}
export function licenseStatus(club){
 const days=Math.ceil((Date.parse(club.license_expires_at)-Date.now())/86400000);
 const blocked=['BLOCKED','SUSPENDED','SUSPENDED_PAYMENT','PENDING'].includes(club.status);
 const code=blocked||!Number.isFinite(days)||days<=0?'RED':days<=3?'YELLOW':'GREEN';
 return {code,daysLeft:Number.isFinite(days)?days:0,label:blocked?'Bloklangan':code==='RED'?'Muddati tugagan':`${days} kun qoldi`,badgeClass:code==='RED'?'text-rose-400':code==='YELLOW'?'text-amber-400':'text-emerald-400'};
}
export function validatePayment(input){
 const amount=Number(input.amount),months=Number(input.monthsAdded??1),clubId=Number(input.clubId),method=String(input.paymentMethod??'CLICK').toUpperCase();
 if(!Number.isSafeInteger(clubId)||clubId<1||!Number.isFinite(amount)||amount<=0||amount>1e12||!Number.isInteger(months)||months<1||months>36||!['CASH','CLICK','PAYME','BANK_TRANSFER'].includes(method))throw failure('Klub, summa, to‘lov turi yoki oylar soni noto‘g‘ri.',400);
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(input.requestId??''))throw failure('Takror to‘lovdan himoya uchun requestId talab qilinadi.',400);
 return {clubId,amount:Math.round(amount*100)/100,months,method,requestId:input.requestId,notes:String(input.notes??'').slice(0,2000)};
}
export class CloudDashboardService {
 constructor(client){if(!client)throw failure('Supabase service role sozlanmagan.');this.client=client;}
 async rows(table,filter){
  const rows=[];for(let from=0;;from+=1000){let query=this.client.from(table).select('*').order('id',{ascending:true}).range(from,from+999);if(filter)query=filter(query);const r=await query;if(r.error)throw failure(table+' ma’lumotlarini o‘qib bo‘lmadi.');rows.push(...(r.data||[]));if(!r.data||r.data.length<1000)return rows;}
 }
 async billing(){
  const [clubs,payments]=await Promise.all([this.rows('clubs'),this.rows('subscription_payments')]);
  const month=new Date().toISOString().slice(0,7),current=payments.filter(p=>p.created_at?.startsWith(month));
  const list=clubs.map(c=>{const fee=monthlyFee(c),last=payments.filter(p=>Number(p.club_id)===Number(c.id)).at(-1);return {id:c.id,name:c.name,slug:c.slug,ownerName:c.owner_name,ownerPhone:c.owner_phone,city:c.city,status:c.status,totalWorkstations:c.total_workstations,licenseExpiresAt:c.license_expires_at,tariff:{type:fee.tariffType,pricePerPc:Number(c.tariff_price_per_pc??20000),fixedPrice:Number(c.tariff_fixed_price??500000),monthlyFee:fee.monthlyFee,description:fee.description},licenseStatus:licenseStatus(c),lastPayment:last?{amount:Number(last.amount),method:last.payment_method,date:last.created_at}:null};});
  const summary={totalClubs:clubs.length,mrr:list.reduce((n,c)=>n+c.tariff.monthlyFee,0),currentMonthCollected:current.reduce((n,p)=>n+Number(p.amount),0),currentMonthPaymentsCount:current.length,statusCounts:{green:0,yellow:0,red:0},recentPayments:payments.slice(-10).reverse().map(p=>({...p,club_name:clubs.find(c=>Number(c.id)===Number(p.club_id))?.name??'Klub'}))};
  for(const c of list)summary.statusCounts[c.licenseStatus.code.toLowerCase()]++;
  return {summary,clubs:list};
 }
 async tariff(id,input){
  const type=String(input.tariffType).toUpperCase(),price=Number(input.pricePerPc),fixed=Number(input.fixedPrice);
  if(!['PER_PC','FIXED','FIXED_MONTHLY'].includes(type)||![price,fixed].every(v=>Number.isFinite(v)&&v>=0&&v<=1e12))throw failure('Tarif va narxlarni to‘g‘ri kiriting.',400);
  const r=await this.client.from('clubs').update({tariff_type:type==='PER_PC'?'PER_PC':'FIXED_MONTHLY',tariff_price_per_pc:price,tariff_fixed_price:fixed,updated_at:new Date().toISOString()}).eq('id',id).select('id').maybeSingle();
  if(r.error)throw failure('Tarif saqlanmadi.');if(!r.data)throw failure('Klub topilmadi.',404);
  return {success:true,clubId:id,tariffType:type,pricePerPc:price,fixedPrice:fixed};
 }
 async payment(input,username){
  const p=validatePayment(input);
  const r=await this.client.rpc('softech_record_subscription_payment',{p_club_id:p.clubId,p_amount:p.amount,p_method:p.method,p_months:p.months,p_notes:p.notes,p_recorded_by:username,p_request_id:p.requestId});
  if(r.error)throw failure(r.error.code==='PGRST202'?'Obuna to‘lovlari uchun 20261031_cloud_audit.sql migratsiyasini bajaring.':'To‘lov saqlanmadi: '+r.error.message,r.error.code==='22023'?400:503);
  return r.data;
 }
 async inspector(id){
  const clubs=await this.rows('clubs',q=>q.eq('id',id));if(!clubs[0])throw failure('Klub topilmadi.',404);
  const date=new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
  const [metrics,pcs]=await Promise.all([this.rows('club_metrics',q=>q.eq('club_id',id).eq('record_date',date)),this.rows('club_workstations_cache',q=>q.eq('club_id',id))]);
  const reports=await cloudFinancialReports(this.client,date,date,id);
  return {success:true,...formatClubInspector(clubs[0],mergeFinancialReports(metrics,reports)[0]||{},pcs)};
 }
 async dailyMetrics(date){
  const [metrics,reports]=await Promise.all([this.rows('club_metrics',q=>q.eq('record_date',date)),cloudFinancialReports(this.client,date,date)]);
  return mergeFinancialReports(metrics,reports);
 }
 async analytics(days=30){
  days=Math.max(1,Math.min(365,Number.parseInt(days,10)||30));const start=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
  const [clubs,metrics]=await Promise.all([this.rows('clubs'),this.rows('club_metrics',q=>q.gte('record_date',start))]);
  return platformAnalytics(clubs,mergeFinancialReports(metrics,await cloudFinancialReports(this.client,start)),days);
 }
}
