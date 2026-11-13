import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html=fs.readFileSync('NetCafeServer/public/index.html','utf8');
test('group amount quotes display different room durations and use one shared start instant',async()=>{
  const source=html.slice(html.indexOf('    function quoteDurationLabel'),html.indexOf('    function setStartQuotePending'));
  const bodies=[];
  const context=vm.createContext({targetSelectedPcIds:['slow','fast'],fetch:async(url,options)=>{
    const body=JSON.parse(options.body);bodies.push(body);
    const seconds=body.computerId==='slow'?5142.857:2571.429;
    return {ok:true,json:async()=>({price:10000,totalSeconds:seconds,durationMinutes:seconds/60})};
  }});
  vm.runInContext(source,context);
  const result=await vm.runInContext('fetchStartQuote({body:JSON.stringify({amount:10000})})',context);
  const quote=await result.json();
  assert.equal(quote.totalPrice,20000);assert.match(quote.perPcLabel,/10.*000 UZS/);
  assert.match(quote.durationLabel,/42 daqiqa 51 soniya/);assert.match(quote.durationLabel,/85 daqiqa 43 soniya/);
  assert.equal(bodies[0].startTime,bodies[1].startTime);
});

test('amount preview uses the returned price and duration instead of the old integer-minute estimate',async()=>{
  const source=html.slice(html.indexOf('    function calcFromPrice'),html.indexOf('    function setPricePreset'));
  const elements=new Map();let callback;
  const document={getElementById:id=>{if(!elements.has(id))elements.set(id,{});return elements.get(id);}};
  const context=vm.createContext({document,authToken:'fixture',priceCalculationRevision:0,targetSelectedPcIds:['a'],currentHourlyRate:12000,
    calcDebounceTimer:null,clearTimeout(){},setTimeout(fn){callback=fn;},setStartQuotePending(){},
    fetchStartQuote:async()=>({ok:true,json:async()=>({currentRate:7000,currentRateName:'Updated schedule',durationMinutes:85.714,totalPrice:10000,perPcLabel:'10 000 UZS',durationLabel:'85 daqiqa 43 soniya'})})});
  vm.runInContext(html.slice(html.indexOf('    function applyStartQuoteRate'),html.indexOf('    function setStartQuotePending')),context);
  vm.runInContext(source,context);vm.runInContext('calcFromPrice(10000)',context);await callback();
  assert.equal(document.getElementById('priceCalculatedTime').textContent,'85 daqiqa 43 soniya');
  assert.equal(document.getElementById('startModalPerPcPrice').textContent,'10 000 UZS');
  assert.match(document.getElementById('startModalPrice').textContent,/10.*000 UZS/);
  assert.equal(context.currentHourlyRate,7000);
  assert.match(document.getElementById('startModalTariffRate').textContent,/7.*000.*Updated schedule/);
});

test('until-time submission keeps the quoted date and never rolls an expired quote into tomorrow',async()=>{
  const source=html.slice(html.indexOf('    async function handleStartSession'),html.indexOf('    let extendSelectedMins'));
  const end=new Date(Date.now()+60000).toISOString();
  const requests=[];let error;
  const context=vm.createContext({authToken:'fixture',currentStartMode:'endtime',targetSelectedPcIds:['pc'],quotedTargetEndTime:end,
    document:{getElementById:id=>id==='btnSubmitStart'?{disabled:false}:{value:'Guest'},querySelector:()=>({value:'CASH'})},
    setStartQuotePending:(pending,message)=>{error=message;},alert(){},
    fetch:async(url,options)=>{requests.push(JSON.parse(options.body));return {ok:false,json:async()=>({error:'Fixture: no real session started'})};}});
  vm.runInContext(source,context);await vm.runInContext('handleStartSession({preventDefault(){}})',context);
  assert.equal(requests[0].targetEndTime,end,'Submit must carry an absolute date, not a clock-only string');
  context.quotedTargetEndTime='2020-01-01T00:00:00.000Z';
  await vm.runInContext('handleStartSession({preventDefault(){}})',context);
  assert.equal(requests.length,1);assert.match(error,/vaqti o‘tgan/);
});
