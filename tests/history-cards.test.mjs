import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../NetCafeServer/public/app.js',import.meta.url),'utf8');
function get(name,next){return source.slice(source.indexOf('function '+name+'('),source.indexOf('function '+next+'('));}
function fixture(){
 const elements=new Map();
 const context=vm.createContext({document:{getElementById(id){if(!elements.has(id))elements.set(id,{textContent:'',value:'',scrollIntoView(){}});return elements.get(id);},querySelectorAll(){return [];}},auditLogsData:[],historyActiveFilter:'ALL',historySearchQuery:'',historyViewMode:'timeline',formatAuditLogEvent:log=>({targetPc:'PC-01',narrative:log.eventType||log.actionType,badgeText:''}),renderHistoryTimeline:rows=>context.visible=rows,renderHistoryTable(){}});
 vm.runInContext(get('updateHistoryCounters','renderHistoryView')+get('renderHistoryView','renderHistoryTimeline')+get('historyMatchesCategory','handleHistorySearch')+get('handleLiveAuditLog','historyMatchesCategory'),context);
 return {context,elements};
}
test('history card counts match each filtered list and refund excludes bar sales',()=>{
 const {context:c,elements}=fixture();
 c.auditLogsData=Array.from({length:125},(_,i)=>({id:i+1,eventType:['SESSION_START','SESSION_EXTEND','BAR_SALE','REFUND','POWER_ACTION'][i%5]}));
 c.updateHistoryCounters();
 for(const [group,id,count] of [['ALL','historyStatTotal',125],['SESSIONS','historyStatSessions',50],['BAR','historyStatBar',25],['FINANCE','historyStatRefunds',25]]){
  c.historySearchQuery='no match';c.selectHistoryCard(group);
  assert.equal(c.visible.length,count);assert.equal(elements.get(id).textContent,String(count));assert.equal(c.historySearchQuery,'');
 }
 assert.equal(elements.get('filterCountFinance').textContent,'25');
 c.handleLiveAuditLog({id:126,actionType:'BAR_SALE'});assert.equal(c.visible.length,25);assert.equal(elements.get('historyStatBar').textContent,'26');
 c.handleLiveAuditLog({id:127,actionType:'REFUND'});assert.equal(c.visible.length,26);
 c.handleLiveAuditLog({id:127,actionType:'REFUND'});assert.equal(c.visible.length,26);
});
test('empty history renders once without fetching recursively',()=>{
 const {context:c,elements}=fixture();c.updateHistoryCounters();c.renderHistoryView();assert.equal(c.visible.length,0);assert.equal(elements.get('historyStatTotal').textContent,'0');
});
test('all four summary cards are native buttons wired to the matching categories',()=>{
 const html=fs.readFileSync(new URL('../NetCafeServer/public/index.html',import.meta.url),'utf8');
 for(const group of ['ALL','SESSIONS','BAR','FINANCE'])assert.match(html,new RegExp('<button type="button" data-history-category="'+group+'"[^>]*onclick="selectHistoryCard'));
});

test('history API pages beyond 100 records with correct action names and tenant scope', async()=>{
 const {DatabaseSync}=await import('node:sqlite');const db=new DatabaseSync(':memory:');
 try {
  db.exec('CREATE TABLE audit_logs(id INTEGER PRIMARY KEY,club_id INTEGER,shift_id INTEGER,action_type TEXT,details TEXT,created_at TEXT)');
  const insert=db.prepare('INSERT INTO audit_logs VALUES(?,?,NULL,?,?,?)');
  for(let i=1;i<=125;i++)insert.run(i,1,'REFUND','{}','2026-11-13 12:00:00');
  insert.run(126,2,'BAR_SALE','{}','2026-11-13 12:00:00');
  const server=fs.readFileSync(new URL('../NetCafeServer/src/server.js',import.meta.url),'utf8');
  const start=server.indexOf("  if (url.pathname === '/api/audit-logs'");
  const block=server.slice(start,server.indexOf('  // ==========================================================================',start));
  const c=vm.createContext({db,req:{method:'GET'},res:{},authenticate:()=>true,getTenantClubId:()=>1,getOpenShift:()=>null,sendJson:(res,status,data)=>c.result={status,...data}});
  vm.runInContext('function route(){'+block+'}',c);
  const seen=[];let cursor=null;
  do {c.url=new URL('http://fixture/api/audit-logs?limit=50'+(cursor?'&beforeId='+cursor:''));c.route();assert.equal(c.result.status,200);seen.push(...c.result.logs);cursor=c.result.nextCursor;}while(cursor);
  assert.equal(seen.length,125);assert.equal(new Set(seen.map(l=>l.id)).size,125);assert.ok(seen.every(l=>l.clubId===1&&l.eventType==='REFUND'));
 }finally{db.close();}
});
