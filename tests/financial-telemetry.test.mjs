import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {mergeFinancialReports,platformAnalytics} from '../src/services/financialTelemetry.js';
import {formatClubInspector} from '../src/services/clubInspector.js';

test('Super Admin uses the Manager ledger: deposits, spent balance, refunds, history and tenants',()=>{
 const day='2026-11-11';
 const metrics=[{club_id:1,record_date:day,total_daily_revenue:35000,bar_revenue:5000,total_sessions_count:2},{club_id:2,record_date:day,total_daily_revenue:9000,bar_revenue:0}];
 const report={accountingVersion:2,summary:{gameRevenue:7000,barRevenue:5000,salesRevenue:12000,cashReceipts:29000,topupRevenue:20000}};
 const snapshots=[{club_id:1,data_key:'report:'+day,payload:JSON.stringify(report),captured_at:'2026-11-12T08:00:00Z'}];
 const merged=mergeFinancialReports(metrics,snapshots);
 const result=platformAnalytics([{id:1,name:'Club A',total_workstations:5},{id:2,name:'Club B',total_workstations:5}],merged,30);
 assert.equal(result.summary.totalRevenue,21000);
 assert.equal(result.topClubs.find(c=>c.id===1).totalRevenue,12000);
 const inspector=formatClubInspector({id:1},merged.find(m=>m.club_id===1)).kassa;
 assert.equal(inspector.sessionsRevenue,7000);assert.equal(inspector.barRevenue,5000);
 assert.equal(inspector.totalDailyRevenue,12000);assert.equal(inspector.cashReceipts,29000);assert.equal(inspector.topupRevenue,20000);
 assert.equal(metrics[0].total_daily_revenue,35000,'Reading cannot mutate historical ledger/telemetry');
 assert.equal(mergeFinancialReports(metrics,[{...snapshots[0],payload:{...report,accountingVersion:1}}])[0].total_daily_revenue,35000);
});

test('inspector displays recorded zeroes without inventing refunds or subtracting them twice',()=>{
 const source=fs.readFileSync('public/views/clubDetail.js','utf8');
 const start=source.indexOf('function renderKassaBreakdown('),end=source.indexOf('\n/**',start);
 const context={};vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const html=context.renderKassaBreakdown({totalDailyRevenue:4000,sessionsRevenue:4000,barRevenue:0,cashReceipts:24000,topupRevenue:20000,refundsSum:null});
 assert.match(html,/24[ ,\u00a0]?000/);assert.match(html,/20[ ,\u00a0]?000/);assert.doesNotMatch(html,/3[ ,\u00a0]?940/);
 assert.match(context.renderKassaBreakdown({totalDailyRevenue:0,sessionsRevenue:0,barRevenue:0,cashReceipts:0,topupRevenue:0}),/Bar Savdosi: 0%/);
});
