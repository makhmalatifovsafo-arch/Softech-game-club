import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('statistics shows capture time and stale/error state, preserves charts on failure, and refreshes only while visible',async()=>{
  const source=fs.readFileSync('NetCafeServer/public/app.js','utf8');
  const code=source.slice(source.indexOf('let analyticsLoading='),source.indexOf('function initAnalyticsCharts('));
  const freshness={textContent:''}, listeners={};let timer,hidden=false,draws=0,calls=0,failure=false;
  const data={analytics:{generatedAt:'2026-11-17T10:00:00Z',refreshing:true},kpis:{},dailyRevenue:[]};
  const document={hidden:false,addEventListener:(name,fn)=>listeners[name]=fn,getElementById:id=>id==='statsFreshness'?freshness:id==='view-stats'?{classList:{contains:()=>hidden}}:null};
  const context=vm.createContext({document,authToken:'fixture',console:{error(){}},setTimeout:fn=>{timer=fn;return 1;},clearTimeout(){},
    fetch:async()=>{calls++;return {ok:!failure,json:async()=>data};},initAnalyticsCharts:()=>draws++});
  vm.runInContext(code,context);
  await context.loadAnalyticsData();assert.equal(draws,1);assert.match(freshness.textContent,/Oxirgi hisob:.*hisoblanmoqda/);
  data.analytics.refreshing=false;data.analytics.stale=true;
  timer();await new Promise(resolve=>setImmediate(resolve));assert.match(freshness.textContent,/Yangilanish kutilmoqda/);
  failure=true;await context.loadAnalyticsData();assert.equal(draws,2);assert.match(freshness.textContent,/Oxirgi ko‘rsatilgan ma’lumot saqlandi/);
  hidden=true;const before=calls;timer();assert.equal(calls,before);
  hidden=false;failure=false;listeners.visibilitychange();await new Promise(resolve=>setImmediate(resolve));assert.equal(draws,3);
});
