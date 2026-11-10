import { checkMobileFlow } from './mobile-flow.mjs';
import { DatabaseSync } from 'node:sqlite';
import { checkClubOperations } from './club-operations.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { WebSocket } from 'ws';

async function freePort() {
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}
async function waitFor(url, child, logs) {
  for (let attempt = 0; attempt < 150; attempt++) {
    if (child.exitCode !== null) throw new Error('Server exited: ' + logs());
    try { const response = await fetch(url, { signal: AbortSignal.timeout(1000) }); if (response.ok) return response; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Startup timeout: ' + logs());
}
for (const cloudSource of ['.', 'SoftechCloudAdmin']) {
test(cloudSource + ': isolated cloud and club server start and accept a client handshake', { timeout: 120000 }, async () => {
  mkdirSync('.test-output', { recursive: true });
  const fixture = mkdtempSync(path.resolve('.test-output/startup-'));
  const cloud = path.join(fixture, 'cloud');
  const club = path.join(fixture, 'club');
  for (const [source, target] of [[cloudSource, cloud], ['NetCafeServer', club]]) {
    mkdirSync(target);
    for (const file of ['src', 'public', 'package.json']) cpSync(path.join(source, file), path.join(target, file), { recursive: true });
  }
  cpSync('NetCafeServer/schema.sql', path.join(club, 'schema.sql'));
  writeFileSync(path.join(cloud, 'config.json'), JSON.stringify({ telegram: { botToken: 'MOCK_TEST', adminChatId: '' } }));
  writeFileSync(path.join(club, 'config.json'), JSON.stringify({ supabaseUrl: 'https://xyzcompany.supabase.co', supabaseAnonKey: 'mock_key', clubId: 1 }));
  const cloudPort = await freePort();
  const clubPort = await freePort();
  const env = { ...process.env, NODE_ENV: 'test', VERCEL: '', AWS_LAMBDA_FUNCTION_NAME: '',
    SOFTECH_CLOUD_DATA_DIR: path.join(cloud, 'data'),
    SUPERADMIN_INITIAL_PASSWORD: 'isolated-startup-password', SUPERADMIN_INITIAL_PIN: '2468',
    SUPERADMIN_JWT_SECRET: 'isolated-test-secret-at-least-32-bytes', REFRESH_SECRET: 'isolated-test-refresh-secret-at-least-32-bytes',
    TELEGRAM_BOT_TOKEN: 'MOCK_TEST', TELEGRAM_ADMIN_CHAT_ID: '', SUPABASE_URL: '', SUPABASE_ANON_KEY: '', SUPABASE_SERVICE_ROLE_KEY: '',
    SOFTECH_CLOUD_URL: 'http://127.0.0.1:' + cloudPort,
    UPDATE_MANIFEST_URL: 'http://127.0.0.1:' + cloudPort + '/test-no-update' };
  const children = [];
  let socket;
  function start(dir, port) {
    const entry = dir === cloud ? 'src/local-server.js' : 'src/server.js';
    const child = spawn(process.execPath, [entry], { cwd: dir, env: { ...env, PORT: String(port) }, windowsHide: true, stdio: ['ignore','pipe','pipe'] });
    let logs = '';
    child.stdout.on('data', chunk => { logs += chunk; });
    child.stderr.on('data', chunk => { logs += chunk; });
    children.push(child);
    return { child, logs: () => logs };
  }
  try {
    let c = start(cloud, cloudPort);
    const loginPage = await waitFor(env.SOFTECH_CLOUD_URL + '/login', c.child, c.logs);
    const expectedVersion = JSON.parse(await (await import('node:fs/promises')).readFile('package.json', 'utf8')).version;
    assert.equal((await (await fetch(env.SOFTECH_CLOUD_URL + '/api/version')).json()).version, expectedVersion);
    assert.match(await loginPage.text(), /html/i);
    const login = await fetch(env.SOFTECH_CLOUD_URL + '/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'admin', password: env.SUPERADMIN_INITIAL_PASSWORD }) });
    assert.equal(login.status, 200);
    const accessToken = (await login.json()).accessToken;
    assert.ok(accessToken);
    let s = start(club, clubPort);
    const health = await waitFor('http://127.0.0.1:' + clubPort + '/api/health', s.child, s.logs);
    const healthData = await health.json();
    assert.equal(healthData.status, 'ok');
    assert.equal(healthData.version, expectedVersion);
    const localUrl = 'http://127.0.0.1:' + clubPort;
    const jsonHeaders = { 'Content-Type': 'application/json' };
    const adminHeaders = { ...jsonHeaders, Authorization: 'Bearer ' + accessToken };
    const request = await fetch(localUrl + '/api/license/request-activation', { method: 'POST', headers: jsonHeaders, body: JSON.stringify({ clubName: "O'yin Club" }) });
    const requested = await request.json();
    assert.equal(requested.success, true, JSON.stringify(requested) + c.logs());
    assert.equal(requested.notification.success, false);
    const approval = await fetch(env.SOFTECH_CLOUD_URL + '/api/telemetry/activation-requests/' + requested.requestId + '/approve', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ days: 90, maxPcs: 24 })
    });
    const approved = await approval.json();
    assert.equal(approval.status, 200, JSON.stringify(approved));
    let report;
    for (let attempt = 0; attempt < 80; attempt++) {
      report = await (await fetch(localUrl + '/api/license/status')).json();
      if (report.isOperational) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(report.isOperational, true, JSON.stringify(report) + s.logs());
    const registered = await fetch(env.SOFTECH_CLOUD_URL + '/api/telemetry/clubs', {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ name: 'Key Club', ownerName: 'Test Owner', ownerPhone: '+998901234567', licenseDays: 365, totalWorkstations: 30 })
    });
    const registeredBody = await registered.json();
    assert.equal(registered.status, 201, JSON.stringify(registeredBody));
    // A key already assigned to another club cannot steal this server's HWID.
    const denied = await fetch(localUrl + '/api/license/activate-with-key', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ licenseKey: registeredBody.club.api_secret_token })
    });
    assert.equal(denied.status, 400);
    assert.equal((await (await fetch(localUrl + '/api/license/status')).json()).isOperational, true);
    const byKey = await fetch(localUrl + '/api/license/activate-with-key', {
      method: 'POST', headers: jsonHeaders, body: JSON.stringify({ licenseKey: approved.club.api_secret_token })
    });
    assert.equal(byKey.status, 200, await byKey.text());
    const stopped = once(s.child, 'exit');
    s.child.kill(); await stopped;
    s = start(club, clubPort);
    await waitFor(localUrl + '/api/health', s.child, s.logs);
    assert.equal((await (await fetch(localUrl + '/api/license/status')).json()).isOperational, true, s.logs());


    socket = new WebSocket('ws://127.0.0.1:' + clubPort + '/ws');
    await once(socket, 'open');
    const message = once(socket, 'message');
    socket.send(JSON.stringify({ type: 'CLIENT_HELLO', payload: { pcNumber: 'PC-01', macAddress: '02:00:00:00:00:01', ipAddress: '127.0.0.1' } }));
    const [raw] = await Promise.race([message, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('No handshake response: ' + s.logs())), 5000); timer.unref(); })]);
    assert.ok(JSON.parse(raw.toString()).type);
    // Malformed packets and repeated handshakes must not crash or disconnect a kiosk.
    socket.send('null');socket.send('[]');socket.send('{');
    socket.send(JSON.stringify({type:'CLIENT_HELLO',payload:{pcNumber:'PC-01',macAddress:'02:00:00:00:00:01'}}));
    await new Promise(r=>setTimeout(r,100));assert.equal(socket.readyState,WebSocket.OPEN);
    assert.equal((await fetch(localUrl+'/api/health')).status,200);

    try { await checkClubOperations({ databasePath: path.join(club, "netcafe.db"), localUrl, cloudUrl: env.SOFTECH_CLOUD_URL, cloudToken: accessToken, cloudClubId: approved.club.id, socket }); }
    catch (error) { throw new Error(error.message + '\nSERVER LOG:\n' + s.logs() + '\nCLOUD LOG:\n' + c.logs(), { cause:error }); }
    const inspection = new DatabaseSync(path.join(club, 'netcafe.db'));
    assert.equal(inspection.prepare("SELECT count(*) AS n FROM sessions WHERE status='ACTIVE'").get().n, 0, 'Ban must end every active session');
    inspection.close();
    socket.terminate();
    let exit = once(c.child, 'exit'); c.child.kill(); await exit;
    exit = once(s.child, 'exit'); s.child.kill(); await exit;
    s = start(club, clubPort);
    await waitFor(localUrl + '/api/health', s.child, s.logs);
    assert.equal((await (await fetch(localUrl + '/api/license/status')).json()).isOperational, false, 'Restart offline must preserve ban');
    c = start(cloud, cloudPort);
    await waitFor(env.SOFTECH_CLOUD_URL + '/login', c.child, c.logs);
    const unban = await fetch(env.SOFTECH_CLOUD_URL + '/api/telemetry/kill-switch/' + approved.club.id, {
      method: 'POST', headers: adminHeaders, body: JSON.stringify({ action: 'UNLOCK', days: 90 })
    });
    assert.equal(unban.status, 200, await unban.text());
    let restored = false;
    for (let i = 0; i < 100; i++) {
      restored = (await (await fetch(localUrl + '/api/license/status')).json()).isOperational;
      if (restored) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(restored, true, 'Unban must restore verified license');
    const managerUrl=env.SOFTECH_CLOUD_URL+'/api/clubs/'+approved.club.id+'/manager';
    const deniedManager=await fetch(managerUrl,{method:'PUT',headers:jsonHeaders,body:JSON.stringify({username:'manager',password:'central-owner-password'})});
    assert.equal(deniedManager.status,401);
    const configured=await fetch(managerUrl,{method:'PUT',headers:adminHeaders,body:JSON.stringify({username:'manager',password:'central-owner-password'})});
    assert.equal(configured.status,200,await configured.text());
    let stop=once(s.child,'exit');s.child.kill();await stop;s=start(club,clubPort);
    await waitFor(localUrl+'/api/health',s.child,s.logs);
    let managerReady=false;
    for(let i=0;i<100;i++){
      const login=await fetch(localUrl+'/api/auth/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'manager',password:'central-owner-password'})});
      managerReady=login.status===200;if(managerReady)break;await new Promise(r=>setTimeout(r,100));
    }
    assert.equal(managerReady,true,s.logs()+c.logs());
    const oldLogin=await fetch(localUrl+'/api/auth/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'manager',password:'Softech006'})});assert.equal(oldLogin.status,401);
    stop=once(s.child,'exit');s.child.kill();await stop;s=start(club,clubPort);await waitFor(localUrl+'/api/health',s.child,s.logs);
    let applied=false;for(let i=0;i<40;i++){applied=(await(await fetch(managerUrl,{headers:adminHeaders})).json()).manager.applied;if(applied)break;await new Promise(r=>setTimeout(r,100));}
    assert.equal(applied,true,'Super admin sees applied only after club acknowledgement');
    const administratorUrl=env.SOFTECH_CLOUD_URL+'/api/clubs/'+approved.club.id+'/administrator';
    const assigned=await fetch(administratorUrl,{method:'PUT',headers:adminHeaders,body:JSON.stringify({username:'shift_admin',password:'cashier-operating-password'})});
    const assignment=await assigned.json();assert.equal(assigned.status,200,JSON.stringify(assignment));assert.equal(assignment.administrator.username,'shift_admin');assert.equal(assignment.administrator.applied,false);
    // Login immediately after cloud assignment: no server restart or heartbeat wait.
    const immediateLogin=await fetch(localUrl+'/api/auth/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:' shift_admin ',password:'cashier-operating-password'})});
    assert.equal(immediateLogin.status,200,s.logs());
    const cashier=await immediateLogin.json();
    assert.ok(cashier,s.logs());assert.equal(cashier.user.role,'administrator');
    const cashierHeaders={...jsonHeaders,Authorization:'Bearer '+cashier.token};
    const cashierApi=async(route,method='GET',body)=>{const r=await fetch(localUrl+route,{method,headers:cashierHeaders,...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};};
    const users=await cashierApi('/api/admin/users');assert.equal(users.status,200);assert.ok(!JSON.stringify(users.body).includes('password'));
    const owner=users.body.find(u=>u.role==='club_owner');assert.ok(owner);
    assert.equal((await cashierApi('/api/admin/users','POST',{username:'intruder',password:'bad-password',role:'club_owner'})).status,403);
    assert.equal((await cashierApi('/api/admin/users/'+owner.id+'/permissions','PUT',{permissions:['*']})).status,403);
    assert.equal((await cashierApi('/api/admin/users/'+owner.id,'DELETE')).status,403);
    assert.equal((await cashierApi('/api/admin/tariffs','PUT',{})).status,403);
    const shift=await cashierApi('/api/shifts/current');assert.equal(shift.status,200);
    if(!shift.body.shift)assert.equal((await cashierApi('/api/shifts/current','POST',{action:'OPEN',startCash:0})).status,201);
    const pcs=await cashierApi('/api/computers');assert.equal(pcs.status,200);
    const pc=(Array.isArray(pcs.body)?pcs.body:pcs.body.computers)[0];
    const session=await cashierApi('/api/sessions/start','POST',{computerId:pc.id,mode:'hours',durationMinutes:30,paymentType:'CASH'});assert.equal(session.status,201,JSON.stringify(session.body));
    assert.equal((await cashierApi('/api/sessions/stop','POST',{sessionId:session.body.sessionId})).status,200);
    const item=await cashierApi('/api/bar/items','POST',{name:'Cashier test drink',buyPrice:2000,sellPrice:4000,stockQuantity:3});assert.equal(item.status,201,JSON.stringify(item.body));
    const sale=await cashierApi('/api/bar/orders','POST',{items:[{barItemId:item.body.item.id,quantity:1}],paymentMethod:'CASH'});assert.equal(sale.status,201,JSON.stringify(sale.body));
    const stock=await cashierApi('/api/bar/items');const items=Array.isArray(stock.body)?stock.body:stock.body.items;
    const sold=items.find(i=>i.id===item.body.item.id);assert.equal(sold.stockQuantity??sold.stock_quantity,2);
    const ownerStillWorks=await fetch(localUrl+'/api/auth/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'manager',password:'central-owner-password'})});assert.equal(ownerStillWorks.status,200);
    const cloudDenied=await fetch(administratorUrl,{method:'PUT',headers:cashierHeaders,body:JSON.stringify({username:'stolen',password:'stolen-manager-password'})});assert.equal(cloudDenied.status,401);
    for(const raw of ['null','[]','{']){const bad=await fetch(localUrl+'/api/auth/login',{method:'POST',headers:jsonHeaders,body:raw});assert.equal(bad.status,400);}
    const large=await fetch(localUrl+'/api/auth/login',{method:'POST',headers:jsonHeaders,body:JSON.stringify({username:'x'.repeat(1024*1024),password:'x'})});assert.equal(large.status,413);
    assert.equal((await fetch(localUrl+'/api/missing-route')).status,404);
    assert.equal((await fetch(localUrl+'/vendor/')).status,404);
    const badBooking=await cashierApi('/api/bookings','POST',{computerId:pc.id,customerName:'Audit',startTime:'bad',endTime:'bad'});assert.equal(badBooking.status,400);
    const bookingStart=new Date(Date.now()+86400000).toISOString(),end=new Date(Date.now()+90000000).toISOString();
    const booking=await cashierApi('/api/bookings','POST',{computerId:pc.id,customerName:'Audit',startTime:bookingStart,endTime:end});assert.equal(booking.status,201,JSON.stringify(booking.body));
    assert.equal((await cashierApi('/api/bookings','POST',{computerId:pc.id,customerName:'Duplicate',startTime:bookingStart,endTime:end})).status,409);
    assert.equal((await cashierApi('/api/bookings/'+booking.body.booking.id+'/status','PUT',{status:'CANCELLED'})).status,200);
    const ownerLogin=await ownerStillWorks.json();const ownerHeaders={...jsonHeaders,Authorization:'Bearer '+ownerLogin.token};
    socket=new WebSocket('ws://127.0.0.1:'+clubPort+'/ws');await once(socket,'open');socket.send(JSON.stringify({type:'CLIENT_HELLO',payload:{pcNumber:'PC-01',macAddress:'02:00:00:00:00:01',ipAddress:'127.0.0.1'}}));
    await checkMobileFlow({cloudUrl:env.SOFTECH_CLOUD_URL,localUrl,clubId:approved.club.id,ownerToken:ownerLogin.token,reconnect:async()=>{
      socket.terminate();socket=new WebSocket('ws://127.0.0.1:'+clubPort+'/ws');let restored;socket.on('message',raw=>{const m=JSON.parse(raw);if(m.type==='START_SESSION')restored=m.payload||m;});await once(socket,'open');socket.send(JSON.stringify({type:'CLIENT_HELLO',payload:{pcNumber:'PC-01',macAddress:'02:00:00:00:00:01'}}));for(let i=0;i<60&&!restored;i++)await new Promise(r=>setTimeout(r,50));assert.ok(restored);return restored;
    }});
    const fixture=new DatabaseSync(path.join(club,'netcafe.db'));
    fixture.prepare("INSERT INTO clubs(id,name,owner_name,phone,expires_at,is_active) VALUES(99,'Other club','Owner','123','2099-01-01',1)").run();
    const other=fixture.prepare("INSERT INTO users(club_id,username,password_hash,role,permissions) VALUES(99,'other-manager','invalid','club_owner','[]')").run();
    const foreign=await fetch(localUrl+'/api/admin/users/'+other.lastInsertRowid+'/permissions',{method:'PUT',headers:ownerHeaders,body:JSON.stringify({permissions:['*']})});assert.equal(foreign.status,404);
    assert.equal(fixture.prepare('SELECT permissions FROM users WHERE id=?').get(other.lastInsertRowid).permissions,'[]');fixture.close();
    const cloudInspection=new DatabaseSync(path.join(cloud,'data/softech_cloud.db'));
    assert.equal(cloudInspection.prepare('SELECT total_workstations FROM clubs WHERE id=?').get(approved.club.id).total_workstations,24,'Heartbeat must not shrink the licensed PC count');cloudInspection.close();
    assert.equal((await fetch(localUrl+'/api/health')).status,200);




  } finally {
    socket?.terminate();
    for (const child of children.reverse()) {
      if (child.exitCode === null && child.signalCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; }
    }
  }
});
}
