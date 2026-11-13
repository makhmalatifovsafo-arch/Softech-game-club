import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const code=fs.readFileSync(new URL('../public/mobile/app.js',import.meta.url),'utf8');
const storage=()=>{const values=new Map();return {getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,v),removeItem:k=>values.delete(k)}};
test('mobile session survives a new browser window and migrates old tab storage without retaining passwords',()=>{
 const localStorage=storage(),sessionStorage=storage();
 const state={clubId:7,token:'mbl_'+'a'.repeat(64),user:{username:'owner',role:'club_owner'},name:'Club',password:'never-store',grant:{secret:'short-lived'}};
 sessionStorage.setItem('softech-mobile',JSON.stringify(state));
 const ctx=vm.createContext({localStorage,sessionStorage,state});
 vm.runInContext(code.slice(code.indexOf('function readSavedSession'),code.indexOf('let saved=readSavedSession')),ctx);
 vm.runInContext(code.slice(code.indexOf('function remember()'),code.indexOf('async function cloud(')),ctx);
 assert.equal(ctx.readSavedSession().token,state.token);ctx.remember();
 assert.equal(sessionStorage.getItem('softech-mobile'),null);
 ctx.sessionStorage=storage();assert.equal(ctx.readSavedSession().token,state.token);
 const saved=JSON.parse(localStorage.getItem('softech-mobile'));assert.equal(saved.password,undefined);assert.equal(saved.grant,undefined);
 localStorage.setItem('softech-mobile','invalid JSON');assert.equal(Object.keys(ctx.readSavedSession()).length,0);
});
test('only cloud dashboard authentication failure expires mobile login, not a local relay refusal',async()=>{
 const ctx=vm.createContext({state:{token:'fixture'},AbortSignal,fetch:async()=>({ok:false,status:401,json:async()=>({error:'Unauthorized'})})});
 vm.runInContext(code.slice(code.indexOf('async function cloud('),code.indexOf('export async function remote')),ctx);
 await assert.rejects(()=>ctx.cloud('dashboard/session'),e=>e.sessionInvalid===true);
 await assert.rejects(()=>ctx.cloud('connection?club=7'),e=>e.sessionInvalid===false);
 await assert.rejects(()=>ctx.cloud('dashboard/login',{}),e=>e.sessionInvalid===false);
});
