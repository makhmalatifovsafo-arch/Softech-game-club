import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source = fs.readFileSync(new URL('../NetCafeServer/src/services/auditService.js', import.meta.url), 'utf8');
// Exercise the production formatter without importing or opening a club database.
const context = vm.createContext({});
vm.runInContext(source.slice(source.indexOf('function resolveCategory'), source.indexOf('export function logAuditEvent')).replaceAll('export function', 'function'), context);
const format = (action, details) => context.formatAuditEntry({action_type:action, details:JSON.stringify(details)});
test('audit uses recorded extension amounts and names, preserves zero and separates game/bar', () => {
 const row=format('SESSION_EXTEND',{additionalMinutes:30,additionalAmount:3500});
 assert.equal(row.impactAmount,3500);assert.match(row.summary,/30/);assert.match(row.summary,/3 500/);
 assert.equal(format('SESSION_EXTEND',{additionalAmount:0,addedAmount:9000}).impactAmount,null);
 assert.match(format('PC_SWAP',{fromName:'VIP-02',toName:'VIP-03'}).summary,/VIP-02.*VIP-03/);
 const end=format('SESSION_STOP',{gameBill:4000,barBill:6000,finalBill:10000,formula:'INTERNAL_FORMULA'});
 assert.match(end.summary,/4 000.*6 000.*10 000/);assert.doesNotMatch(end.summary,/INTERNAL/);
});
test('audit descriptions avoid raw JSON, false cash labels and shutdown labels for wake',()=>{
 assert.doesNotMatch(format('POWER_ACTION',{action:'WAKE'}).summary,/SHUTDOWN|WAKE/);
 assert.notEqual(format('POWER_ACTION',{action:'WAKE'}).title,format('POWER_ACTION',{action:'SHUTDOWN'}).title);
 const bar=format('BAR_SALE',{orderNumber:'A1',totalAmount:6000,paymentStatus:'PENDING_AT_CHECKOUT'});
 assert.doesNotMatch(bar.summary,/CASH|NAQD|undefined/);assert.equal((bar.summary.match(/A1/g)||[]).length,1);
 assert.doesNotMatch(format('UNKNOWN',{secret:'hidden'}).summary,/hidden|secret|\{/);
 assert.doesNotThrow(()=>context.formatAuditEntry({details:'null'}));
});
