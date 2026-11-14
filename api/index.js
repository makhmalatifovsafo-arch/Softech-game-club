import { handleMobileRoute } from '../src/services/mobileRelay.js';
import { handleServerDiagnostics } from '../src/services/serverDiagnostics.js';
import { handleMobileDashboard } from '../src/services/mobileDashboard.js';
import { appVersion } from '../src/services/appVersion.js';
import { requireRemoteMaintenance } from '../src/services/maintenanceVersion.js';
import { handleStaffSyncRoute } from '../src/services/staffAccountSync.js';
import { CloudDashboardService } from '../src/services/cloudDashboardService.js';
import {announcementPayload} from '../src/services/announcementPayload.js';
import { ManagerAccountService } from '../src/services/managerAccountService.js';
/**
 * Softech Super Admin — Central Vercel Serverless Function API Entrypoint
 * Location: api/index.js (Repo Root)
 */

import crypto from 'node:crypto';
import { CloudActivationService } from '../src/services/cloudActivationService.js';
import { SupabaseCloudService } from '../src/services/supabaseClient.js';
import { TelegramBotService } from '../src/services/telegramBot.js';

import { signAccessToken, signRefreshToken, verifyAccessToken } from '../src/utils/jwt.js';

function generateJwt(user) {
  return signAccessToken({ id: user.id, sub: user.id, username: user.username, role: 'superadmin' }, 7 * 24 * 3600);
}

function verifyJwt(token) {
  const user = verifyAccessToken(token);
  return user?.role === 'superadmin' && user.sub ? user : null;
}

function getAuthUser(req) {
  const authHeader = req.headers['authorization'] || '';
  if (authHeader.startsWith('Bearer ')) {
    return verifyJwt(authHeader.slice(7).trim());
  }
  return null;
}

function sendJson(res, statusCode, data) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.end(JSON.stringify(data));
}

// Request Body parser
async function getParsedBody(req) {
  let raw=req.body;
  if(raw===undefined){let body='';for await(const chunk of req){body+=chunk;if(body.length>1024*1024)throw Object.assign(Error('So‘rov juda katta.'),{statusCode:413});}raw=body||'{}';}
  try{const value=typeof raw==='string'?JSON.parse(raw):raw;if(!value||typeof value!=='object'||Array.isArray(value))throw Error();return value;}
  catch{throw Object.assign(Error('JSON obyekti talab qilinadi.'),{statusCode:400});}
}

export default async function handler(req, res) {
  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    return res.end();
  }

  // Vercel path normalization (handles rewrites, dynamic routes, query params)
  const rawPath = req.url || req.headers['x-forwarded-uri'] || '/';
  const url = new URL(rawPath, `http://${req.headers.host || 'localhost'}`);
  let pathname = url.pathname;
  const method = req.method;

  const routeParam = url.searchParams.get('route') || url.searchParams.get('path');
  if (routeParam) {
    pathname = routeParam.startsWith('/') ? routeParam : `/${routeParam}`;
    if (!pathname.startsWith('/api')) {
      pathname = `/api${pathname}`;
    }
  } else if (pathname === '/api/index.js' || pathname === '/api/index' || pathname === '/api') {
    if (req.headers['x-matched-path']) {
      pathname = req.headers['x-matched-path'];
    }
  }

  try {
    // Mobile and other routers must see the same resolved path, including query filters.
    req.url = pathname + url.search;
    if(await handleServerDiagnostics(req,res,{client:SupabaseCloudService.getClient()},(request,response)=>{
      if(getAuthUser(request))return true;
      sendJson(response,401,{success:false,error:'Ruxsat berilmagan'});return false;
    }))return;
    if (pathname === '/api/version' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 200, { app: 'Softech Cloud', version: appVersion });
    }
    if(await handleStaffSyncRoute(req,res,{client:SupabaseCloudService.getClient()}))return;
    if(await handleMobileDashboard(req,res,{client:SupabaseCloudService.getClient()}))return;
    if(await handleMobileRoute(req,res,{client:SupabaseCloudService.getClient()}))return;
    const managerPath=pathname.match(/^\/api\/clubs\/(\d+)\/(manager|administrator)$/);
    if(managerPath && ['GET','PUT'].includes(method)){
      if(!getAuthUser(req))return sendJson(res,401,{success:false,error:'Ruxsat berilmagan'});
      const service=new ManagerAccountService({client:SupabaseCloudService.getClient(),role:managerPath[2]});
      const manager=method==='GET'?await service.summary(Number(managerPath[1])):await service.save(Number(managerPath[1]),await getParsedBody(req));
      return sendJson(res,200,{success:true,[managerPath[2]]:manager});
    }
    // ========================================================================
    // 1. AUTENTIFIKATSIYA (AUTH)
    // ========================================================================
    if ((pathname === '/api/auth/pin-login' || pathname === '/api/auth/verify-pin') && method === 'POST') {
      const body = await getParsedBody(req);
      const { pinCode } = body;

      if (!/^\d{4}$/.test(String(pinCode ?? ''))) {
        return sendJson(res, 400, { success: false, error: "4 xonali PIN kod kiritilishi shart." });
      }

      const user = await SupabaseCloudService.verifyPinCode(pinCode);
      if (!user) {
        return sendJson(res, 401, { success: false, error: "Noto'g'ri PIN kod." });
      }

      const token = generateJwt(user);
      const refreshToken = signRefreshToken(
        { id: user.id, sub: user.id, username: user.username, role: 'superadmin' },
        30 * 24 * 3600
      );
      return sendJson(res, 200, { success: true, token, accessToken: token, refreshToken, user });
    }

    if ((pathname.includes('auth/login') || pathname.endsWith('/login')) && !pathname.includes('pin-login') && method === 'POST') {
      const body = await getParsedBody(req);
      const { username, password } = body;

      if (!username || !password) {
        return sendJson(res, 400, { success: false, error: 'Login va parol kiritilishi shart.' });
      }

      // Supabase orqali tekshirish
      const user = await SupabaseCloudService.verifySuperAdminCredentials(username, password);
      if (!user) {
        return sendJson(res, 401, { success: false, error: "Login yoki parol noto'g'ri." });
      }

      const token = generateJwt(user);
      return sendJson(res, 200, { success: true, token, accessToken: token, user });
    }

    if (pathname === '/api/auth/me' && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Avtorizatsiyadan o\'tilmagan' });
      return sendJson(res, 200, { success: true, user: auth });
    }

    // ========================================================================
    // 2. KLUBLAR VA TELEMETRIYA (CLUBS & SUMMARY)
    // ========================================================================
    if (pathname === '/api/telemetry/summary' && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const reportDate = new Date().toLocaleDateString('en-CA',{timeZone:'Asia/Tashkent'});
      const metricsRequest = new CloudDashboardService(SupabaseCloudService.getClient()).dailyMetrics(reportDate);
      const [clubs,metrics] = await Promise.all([SupabaseCloudService.getAllClubs(metricsRequest),metricsRequest]);
      const totalClubs = clubs.length;
      const onlineClubs = clubs.filter(c => c.is_online_now).length;
      const occupiedNow = clubs.reduce((sum, c) => sum + (c.occupied_pcs || 0), 0);
      const totalNetwork = clubs.reduce((sum, c) => sum + Number(c.actual_workstations || 0), 0);
      const todayTotal = metrics.reduce((sum,m)=>sum+Number(m.total_daily_revenue||0),0);
      const sessionsCount = metrics.reduce((sum,m)=>sum+Number(m.total_sessions_count||0),0);
      const barTotal = metrics.reduce((sum,m)=>sum+Number(m.bar_revenue||0),0);

      return sendJson(res, 200, {
        success: true,
        clubs,
        summary: {
          clubs: { total: totalClubs, onlineNow: onlineClubs, offlineNow: totalClubs - onlineClubs },
          workstations: { occupiedNow, availableNow: Math.max(0, clubs.filter(c=>c.is_online_now).reduce((n,c)=>n+Number(c.online_pcs||0),0) - occupiedNow), totalNetwork },
          revenue: { todayTotal, sessionsCount, barTotal }
        }
      });
    }

    if ((pathname === '/api/telemetry/clubs' || pathname === '/api/clubs') && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubs = await SupabaseCloudService.getAllClubs();
      return sendJson(res, 200, { success: true, clubs: clubs || [] });
    }

    // Yangi klub qo'shish (Onboarding)
    if ((pathname === '/api/telemetry/clubs' || pathname === '/api/clubs') && method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const body = await getParsedBody(req);
      if (!body.name || !body.name.trim()) {
        return sendJson(res, 400, { success: false, error: "Klub nomi kiritilishi shart." });
      }

      const newClub = await SupabaseCloudService.registerClub(body);
      return sendJson(res, 201, { success: true, club: newClub });
    }

    // Bitta klub ma'lumotlari
    const clubMatch = pathname.match(/^\/api\/(?:telemetry\/)?clubs\/(\d+)/);
    if (clubMatch && method === 'GET') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubId = parseInt(clubMatch[1], 10);
      const club = await SupabaseCloudService.getClubById(clubId);
      if (!club) return sendJson(res, 404, { success: false, error: 'Klub topilmadi' });
      return sendJson(res, 200, await new CloudDashboardService(SupabaseCloudService.getClient()).inspector(clubId));
    }

    // Klubni o'chirish
    if (clubMatch && method === 'DELETE') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const clubId = parseInt(clubMatch[1], 10);
      await SupabaseCloudService.deleteClub(clubId);
      return sendJson(res, 200, { success: true, message: `Klub #${clubId} muvaffaqiyatli o'chirildi.` });
    }

    // Soxta / Namunaviy barcha klublarni tozalash (Wipe all demo clubs)
    if ((pathname === '/api/admin/clear-demo-data' || pathname === '/api/telemetry/clubs/clear-all' || pathname === '/api/clubs/clear-all') && (method === 'POST' || method === 'DELETE')) {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      await SupabaseCloudService.clearAllDemoClubs();
      return sendJson(res, 200, { success: true, message: "Barcha soxta/namunaviy klublar o'chirildi. Tizim toza holatga keltirildi." });
    }

    // ========================================================================
    // 2.5 YANGI O'RNATISH VA FAOLLASHTIRISH SO'ROVI (ACTIVATION REQUEST)
    // ========================================================================
    if (pathname === '/api/telemetry/activation-request' && method === 'POST') {
      return sendJson(res, 200, await CloudActivationService.createActivationRequest(await getParsedBody(req)));
    }
    if (pathname === '/api/telemetry/activate-by-key' && method === 'POST') {
      return sendJson(res, 200, await CloudActivationService.activateByKey(await getParsedBody(req)));
    }
    if (pathname === '/api/telemetry/activation-status' && method === 'GET') {
      res.setHeader('Cache-Control', 'no-store');
      return sendJson(res, 200, await CloudActivationService.getActivationStatus(url.searchParams.get('hwid')));
    }
    if (pathname === '/api/telemetry/activation-requests' && method === 'GET') {
      if (!getAuthUser(req)) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });
      return sendJson(res, 200, { success: true, requests: await CloudActivationService.getPendingRequests() });
    }
    const activationMatch = pathname.match(/^\/api\/telemetry\/activation-requests\/(\d+)\/(approve|reject)$/);
    if (activationMatch && method === 'POST') {
      if (!getAuthUser(req)) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });
      const body = await getParsedBody(req);
      const result = activationMatch[2] === 'approve'
        ? await CloudActivationService.approveActivation(Number(activationMatch[1]), body)
        : await CloudActivationService.rejectActivation(Number(activationMatch[1]), body.reason);
      return sendJson(res, 200, result);
    }

    // ========================================================================
    // 3. HEARTBEAT INGESTION (Lokal NetCafeServer dan so'rovlar)
    // ========================================================================
    if (pathname === '/api/telemetry/heartbeat' && method === 'POST') {
      const authHeader = req.headers['authorization'] || '';
      const secretToken = authHeader.replace(/^Bearer\s+/i, '').trim();
      const body = await getParsedBody(req);

      const targetId = secretToken;
      if (!targetId && !body.signedLicense) {
        return sendJson(res, 401, { success: false, error: 'Autentifikatsiya kaliti (Bearer token) topilmadi.' });
      }

      const result = await SupabaseCloudService.ingestHeartbeat(targetId, body);
      return sendJson(res, 200, result);
    }

    // ========================================================================
    // 4. MASOFADAN BOSHQARISH & KILL-SWITCH (REMOTE DISPATCHER)
    // ========================================================================
    const commandMatch=pathname.match(/^\/api\/telemetry\/commands\/(\d+|ALL)$/i);
    const commandHistory=pathname.match(/^\/api\/telemetry\/commands\/history\/(\d+)$/);
    if(commandHistory && method==='GET') {
      if(!getAuthUser(req))return sendJson(res,401,{error:'Ruxsat berilmagan'});
      const client=SupabaseCloudService.getClient();
      if(!client)return sendJson(res,503,{error:'Bulut bazasi ulanmagan.'});
      const result=await client.from('remote_commands').select('id,club_id,command_type,status,payload,created_at,executed_at').eq('club_id',Number(commandHistory[1])).order('id',{ascending:false}).limit(100);
      if(result.error)throw result.error;
      return sendJson(res,200,{success:true,history:result.data||[]});
    }
    const killSwitchMatch = pathname.match(/^\/api\/telemetry\/kill-switch\/(\d+)$/);
    if ((pathname === '/api/remote/execute' || killSwitchMatch || commandMatch) && method === 'POST') {
      const auth = getAuthUser(req);
      if (!auth) return sendJson(res, 401, { success: false, error: 'Ruxsat berilmagan' });

      const body = await getParsedBody(req);
      const clubId = commandMatch ? (commandMatch[1].toUpperCase()==='ALL'?'ALL':Number(commandMatch[1])) : killSwitchMatch ? Number(killSwitchMatch[1]) : body.clubId;
      const action = body.action || body.commandType;
      let options = body.options || body.payload || body;

      if (!clubId || !action) {
        return sendJson(res, 400, { success: false, error: 'clubId va action ko\'rsatilishi shart.' });
      }

      // Kill-Switch Bloklash
      if (action === 'LOCK' || action === 'LOCK_CLUB_LICENSE') {
        const result = await SupabaseCloudService.blockClub(clubId, options.reason || "SaaS to'lovi muddati tugadi");
        return sendJson(res, 200, { success: true, result, message: "Litsenziya holati yangilandi." });
      }

      // Qulfdan Chiqarish
      if (action === 'UNLOCK' || action === 'ACTIVATE' || action === 'UNLOCK_CLUB_LICENSE') {
        const result = await SupabaseCloudService.unblockClub(clubId, options.days || options.extensionDays || 30);
        return sendJson(res, 200, { success: true, result });
      }

      if(action==='RESET_ADMIN_PASSWORD')return sendJson(res,400,{success:false,error:'Menejer akkaunti oynasidan login va parolni belgilang.'});
      if(!['RESTART_SERVER','FORCE_UPDATE','FORCE_CLIENT_UPDATE','BROADCAST_ANNOUNCEMENT'].includes(action))return sendJson(res,400,{success:false,error:'Buyruq turi qo‘llab-quvvatlanmaydi.'});
      if(action==='BROADCAST_ANNOUNCEMENT') {
        try {options=announcementPayload(options);}catch(error){return sendJson(res,400,{success:false,error:error.message});}
      }
      if(clubId==='ALL'){
        if(action!=='BROADCAST_ANNOUNCEMENT')return sendJson(res,400,{error:'Bu buyruq faqat bitta klub uchun.'});
        const clubs=await SupabaseCloudService.getAllClubs();for(const c of clubs)await SupabaseCloudService.queueRemoteCommand(c.id,action,options);
        return sendJson(res,200,{success:true,messageSummary:'Xabar '+clubs.length+' klub uchun navbatga qo‘yildi.'});
      }
      const commandClub=await SupabaseCloudService.getClubById(clubId);
      if(!commandClub)return sendJson(res,404,{error:'Klub topilmadi.'});
      if(['RESTART_SERVER','FORCE_UPDATE'].includes(action)) {
        try { requireRemoteMaintenance(commandClub); } catch(error) { return sendJson(res,409,{success:false,error:error.message}); }
      }
      const queuedCmd=await SupabaseCloudService.queueRemoteCommand(clubId,action,options);
      return sendJson(res,200,{success:true,commandId:queuedCmd.id,queuedCommand:queuedCmd,message:'Buyruq navbatga qo‘yildi.'});
    }

    // ========================================================================
    // 5. SAAS BILLING
    // ========================================================================
    if(['/api/billing/summary','/api/billing/clubs','/api/analytics/platform'].includes(pathname)&&method==='GET'){
      if(!getAuthUser(req))return sendJson(res,401,{error:'Ruxsat berilmagan'});
      const service=new CloudDashboardService(SupabaseCloudService.getClient());
      if(pathname==='/api/analytics/platform')return sendJson(res,200,await service.analytics(url.searchParams.get('days')));
      const data=await service.billing();return sendJson(res,200,{success:true,...data});
    }
    const tariffMatch=pathname.match(/^\/api\/billing\/tariff\/(\d+)$/);
    if(tariffMatch&&method==='POST'){
      if(!getAuthUser(req))return sendJson(res,401,{error:'Ruxsat berilmagan'});
      return sendJson(res,200,await new CloudDashboardService(SupabaseCloudService.getClient()).tariff(Number(tariffMatch[1]),await getParsedBody(req)));
    }
    if(['/api/billing/payment','/api/billing/payments'].includes(pathname)&&method==='POST'){
      const user=getAuthUser(req);if(!user)return sendJson(res,401,{error:'Ruxsat berilmagan'});
      return sendJson(res,200,await new CloudDashboardService(SupabaseCloudService.getClient()).payment(await getParsedBody(req),user.username));
    }

    // ========================================================================
    // 6. TELEGRAM BOT WEBHOOK
    // ========================================================================
    if (pathname === '/api/telegram/webhook' && method === 'POST') {
      if (!TelegramBotService.verifyWebhook(req)) return sendJson(res, 403, { success: false, error: 'Telegram webhook ruxsati yo\'q.' });
      const update = await getParsedBody(req);
      const result = await TelegramBotService.handleWebhookUpdate(update, CloudActivationService);
      return sendJson(res, 200, result);
    }

    // 404
    return sendJson(res, 404, { success: false, error: `API yo'nalishi topilmadi: ${pathname}` });
  } catch (error) {
    console.error('API Error:', error);
    return sendJson(res, error.statusCode || 500, { success: false, error: error.message, ...(error.code ? { code: error.code } : {}) });
  }
}
