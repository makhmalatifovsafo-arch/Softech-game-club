import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';

export async function checkPrepaidFlow({localUrl,token,databasePath}) {
  const api=async(route,method='GET',body)=>{
    const response=await fetch(localUrl+route,{method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
    return {status:response.status,body:await response.json()};
  };
  const db=new DatabaseSync(databasePath);db.exec('PRAGMA busy_timeout=5000');
  try {
    const pcs=[],rates=[7000,14000],rooms=[];
    for (let i=0;i<rates.length;i++) {
      const room=await api('/api/zones','POST',{name:'Prepaid regression '+i,tariffs:[{name:'Hourly '+rates[i],price_per_hour:rates[i],start_time:'00:00',end_time:'00:00',days_of_week:[1,2,3,4,5,6,7],is_vip_postpaid_allowed:true}]});
      assert.equal(room.status,201,JSON.stringify(room.body));rooms.push(room.body.zone.id);
      const added=await api('/api/admin/computers','POST',{name:'Prepaid-'+i,pcNumber:973+i});assert.equal(added.status,201);
      pcs.push(added.body.computer.id);db.prepare('UPDATE computers SET zone_id=? WHERE id=?').run(room.body.zone.id,pcs[i]);
    }
    for (const batch of [false,true]) for (const mode of ['hours','price','endtime']) {
      const targetEndTime=new Date(Date.now()+1800000).toISOString();
      const data={mode,durationMinutes:90,amount:mode==='price'?10000:1,targetEndTime,paymentType:'CASH'};
      const quoteBody=mode==='hours'?{durationHours:1.5}:mode==='price'?{amount:10000}:{targetEndTime};
      const quote=await api('/api/tariffs/calculate','POST',{...quoteBody,computerId:pcs[0]});
      assert.equal(quote.status,200,JSON.stringify(quote.body));
      if(mode==='price') {assert.equal(quote.body.price,10000);assert.ok(Math.abs(quote.body.totalSeconds-10000/7000*3600)<0.001);}
      const start=await api(batch?'/api/sessions/batch-start':'/api/sessions/start','POST',{...data,...(batch?{computerIds:pcs}:{computerId:pcs[0]})});
      assert.equal(start.status,201,JSON.stringify(start.body));
      const results=batch?start.body.results:[start.body];
      for (let i=0;i<results.length;i++) {
        const result=results[i],row=db.prepare('SELECT * FROM sessions WHERE id=?').get(result.sessionId);
        const duration=(Date.parse(row.ends_at)-Date.parse(row.started_at))/1000;
        const expected=mode==='hours'?rates[i]*1.5:mode==='price'?10000:Math.round(duration/3600*rates[i]);
        assert.equal(result.amount,expected);assert.equal(row.paid_amount,expected);assert.equal(row.total_amount,expected);
        assert.equal(db.prepare("SELECT amount FROM transactions WHERE session_id=? AND transaction_type='PREPAID'").get(row.id).amount,expected);
        if(mode==='price')assert.ok(Math.abs(duration-10000/rates[i]*3600)<0.001);
        if(mode==='hours')assert.equal(duration,5400);
        if(mode==='endtime')assert.equal(row.ends_at,targetEndTime);
        assert.equal((await api('/api/computers')).body.find(pc=>pc.id===pcs[i]).activeSession.totalAmount,expected);
        assert.equal((await api('/api/sessions/'+row.id+'/checkout','POST',{paymentMethod:'CASH'})).status,200);
      }
      if(batch) assert.equal(start.body.totalAmount,results.reduce((sum,row)=>sum+row.amount,0));
    }
    // Invalid mode-specific values must neither default to an hour nor create a zero-paid session.
    for(const bad of [{mode:'price',amount:0},{mode:'price',amount:''},{mode:'price',amount:-10},
      {mode:'hours',durationMinutes:0},{mode:'hours',durationMinutes:4321},
      {mode:'endtime',targetEndTime:'bad'},{mode:'endtime',targetEndTime:'25:00'},
      {mode:'endtime',targetEndTime:'2020-01-01T00:00:00Z'},{mode:'unknown'}]) {
      const before=db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n;
      for(const batch of [false,true]) {
        const result=await api(batch?'/api/sessions/batch-start':'/api/sessions/start','POST',{...bad,...(batch?{computerIds:pcs}:{computerId:pcs[0]})});
        assert.equal(result.status,400,JSON.stringify({bad,result}));
      }
      assert.equal(db.prepare('SELECT COUNT(*) AS n FROM sessions').get().n,before);
    }
    for(const body of [{amount:0},{amount:''},{amount:'100abc'},{durationHours:0},{targetEndTime:''},{targetEndTime:'not-a-time'}])
      assert.equal((await api('/api/tariffs/calculate','POST',{computerId:pcs[0],...body})).status,400);
    // Group planning validates every PC before writing the first session/payment.
    const before=db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n;
    db.prepare("UPDATE tariffs SET days_of_week='[]' WHERE zone_id=?").run(rooms[1]);
    assert.equal((await api('/api/sessions/batch-start','POST',{computerIds:pcs,mode:'hours',durationMinutes:30})).status,400);
    assert.equal(db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE computer_id IN (?,?) AND status='ACTIVE'").get(...pcs).n,0);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM transactions').get().n,before);
    console.log('PASS prepaid hours/amount/endtime: quotes, single/group room rates, exact budget, saved receipt and atomic invalid-input rejection');
  } finally {db.close();}
}
