import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDatabase, TelemetryService } from './db/index.js';
import { handleAuthRoute } from './routes/auth.js';
import { requireSuperAdminAuth } from './middleware/auth.js';
import { RemoteControlService } from './services/remoteControl.js';
import { handleTelemetryRoute, startOfflineDetectionWorker } from './routes/telemetry.js';
import { BillingService } from './services/billingService.js';
import { TelegramBotService } from './services/telegramBot.js';
import { AnalyticsService } from './services/analyticsService.js';
import { ActivationService } from './services/activationService.js';
import { SupabaseCloudService } from './services/supabaseClient.js';
import { WebSocketServer } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PUBLIC_DIR = path.resolve(__dirname, '../public');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 7000;

// 1. Bazani initsializatsiya qilish
initDatabase();
ActivationService.initSchema();

// 2. Fondagi avtomatik Offline Detection Worker ni ishga tushirish (har 60s)
startOfflineDetectionWorker(60000);

// 3. Telegram Bot Long-Polling tinglovchisini ishga tushirish
TelegramBotService.startPolling();

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function serveStaticFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Fayl topilmadi');
      return;
    }
    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

const server = http.createServer(async (req, res) => {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const pathname = url.pathname;

  // ==========================================================================
  // 1. AUTH API ROUTES
  // ==========================================================================
  if (pathname.startsWith('/api/auth/')) {
    return handleAuthRoute(req, res, pathname);
  }

  // ==========================================================================
  // 2. TELEMETRY & SAAS API ROUTES
  // ==========================================================================
  if (pathname === '/api/telemetry/summary' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const summary = TelemetryService.getGlobalMetricsSummary();
    return sendJson(res, 200, { success: true, summary });
  }

  if (pathname === '/api/telemetry/clubs' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const clubs = TelemetryService.getAllClubsWithLiveMetrics();
    return sendJson(res, 200, { success: true, clubs });
  }

  // Yangi Klubni ro'yxatdan o'tkazish (Onboarding & Litsenziya kaliti yaratish)
  if ((pathname === '/api/telemetry/clubs' || pathname === '/api/clubs') && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        if (!data.name || !data.name.trim()) {
          return sendJson(res, 400, { success: false, error: "Klub nomi kiritilishi shart." });
        }
        if (!data.ownerName || !data.ownerName.trim()) {
          return sendJson(res, 400, { success: false, error: "Klub egasining ismi kiritilishi shart." });
        }
        if (!data.ownerPhone || !data.ownerPhone.trim()) {
          return sendJson(res, 400, { success: false, error: "Telefon raqami kiritilishi shart." });
        }

        const newClub = TelemetryService.registerClub(data);
        const host = req.headers.host || `localhost:${PORT}`;

        return sendJson(res, 201, {
          success: true,
          message: "Klub muvaffaqiyatli ro'yxatdan o'tkazildi!",
          club: {
            id: newClub.id,
            name: newClub.name,
            slug: newClub.slug,
            city: newClub.city,
            ownerName: newClub.owner_name,
            ownerPhone: newClub.owner_phone,
            totalWorkstations: newClub.total_workstations,
            licenseKey: newClub.api_secret_token,
            licenseExpiresAt: newClub.license_expires_at,
            status: newClub.status,
            tariffType: newClub.tariff_type
          },
          connectionGuide: {
            serverLanIp: newClub.server_lan_ip,
            cloudEndpoint: `http://${host}/api/telemetry/heartbeat`,
            licenseToken: newClub.api_secret_token,
            quickCommand: `NetCafeServer --cloud-token ${newClub.api_secret_token}`
          }
        });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // Individual Club Detailed Inspector View
  if (pathname.startsWith('/api/telemetry/clubs/') && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const clubId = parseInt(pathname.split('/').pop(), 10);
    const detail = TelemetryService.getClubDetailedInspector(clubId);
    if (!detail) {
      return sendJson(res, 404, { success: false, error: 'Klub topilmadi' });
    }
    return sendJson(res, 200, { success: true, ...detail });
  }

  // Filialdan kelgan telemetriya (Heartbeat Ingestion API)
  if (pathname.startsWith('/api/telemetry/heartbeat')) {
    return handleTelemetryRoute(req, res, pathname);
  }

  // ==========================================================================
  // BILLING & SAAS RECURRING SUBSCRIPTION ROUTES
  // ==========================================================================
  if (pathname === '/api/billing/summary' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const summary = BillingService.getBillingSummary();
    return sendJson(res, 200, { success: true, summary });
  }

  if (pathname === '/api/billing/clubs' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const clubs = BillingService.getAllClubsWithBilling();
    return sendJson(res, 200, { success: true, clubs });
  }

  if (pathname === '/api/billing/payments' && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const { clubId, amount, paymentMethod, monthsAdded, notes } = body ? JSON.parse(body) : {};
        const result = BillingService.recordPayment(parseInt(clubId, 10), {
          amount,
          paymentMethod,
          monthsAdded,
          notes
        });
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  if (pathname.startsWith('/api/billing/tariff/') && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    const clubId = parseInt(pathname.split('/').pop(), 10);
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const result = BillingService.updateTariff(clubId, data);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // PLATFORM ANALYTICS & CHART.JS TELEMETRY ROUTES
  // ==========================================================================
  if (pathname === '/api/analytics/platform' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const days = parseInt(url.searchParams.get('days') || '30', 10);
    const analytics = AnalyticsService.getPlatformAnalytics(days);
    return sendJson(res, 200, analytics);
  }

  // Buyruqlar tarixini olish
  if (pathname.startsWith('/api/telemetry/commands/history') && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const parts = pathname.split('/');
    const clubId = parts.length > 5 ? parseInt(parts.pop(), 10) : null;
    const history = RemoteControlService.getCommandHistory(clubId, 30);
    return sendJson(res, 200, { success: true, history });
  }

  // Super Admin masofaviy buyruq yuborishi (Individual yoki barcha klublarga)
  if (pathname.startsWith('/api/telemetry/commands/') && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    const rawClubId = pathname.split('/').pop();
    const clubId = rawClubId.toUpperCase() === 'ALL' ? 'ALL' : parseInt(rawClubId, 10);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const action = data.action || data.commandType;
        const payload = data.payload || data;

        let result;
        if (action === 'RESET_ADMIN_PASSWORD') {
          result = RemoteControlService.resetAdminPassword(clubId, {
            newPassword: payload.newPassword,
            reason: payload.reason
          });
        } else if (action === 'LOCK_CLUB_LICENSE' || action === 'LOCK') {
          result = RemoteControlService.setLicenseStatus(clubId, 'LOCK', payload);
        } else if (action === 'UNLOCK_CLUB_LICENSE' || action === 'ACTIVATE') {
          result = RemoteControlService.setLicenseStatus(clubId, 'ACTIVATE', payload);
        } else if (action === 'RESTART_SERVER') {
          result = RemoteControlService.restartServer(clubId, payload);
        } else if (action === 'BROADCAST_ANNOUNCEMENT') {
          result = RemoteControlService.broadcastAnnouncement(clubId, payload);
        } else {
          // Universal fallback
          const cmd = TelemetryService.queueRemoteCommand(clubId, action, payload);
          result = { success: true, command: cmd };
        }

        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // ACTIVATION & REMOTE KILL-SWITCH ROUTES
  // ==========================================================================

  // 1. NetCafeServer dan yangi o'rnatish so'rovi (Activation Request)
  if (pathname === '/api/telemetry/activation-request' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const result = await ActivationService.createActivationRequest(data);
        return sendJson(res, 201, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 2. Kutilayotgan litsenziya so'rovlarini olish (Super Admin PWA)
  if (pathname === '/api/telemetry/activation-requests' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const requests = ActivationService.getPendingRequests();
    return sendJson(res, 200, { success: true, requests });
  }

  // 3. Super Admin tomonidan litsenziyani tasdiqlash ([✅ TASDIQLASH])
  if (pathname.startsWith('/api/telemetry/activation-requests/') && pathname.endsWith('/approve') && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    const parts = pathname.split('/');
    const requestId = parseInt(parts[parts.length - 2], 10);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const result = await ActivationService.approveActivation(requestId, data);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 4. Super Admin tomonidan so'rovni rad etish ([❌ RAD ETISH])
  if (pathname.startsWith('/api/telemetry/activation-requests/') && pathname.endsWith('/reject') && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    const parts = pathname.split('/');
    const requestId = parseInt(parts[parts.length - 2], 10);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const result = await ActivationService.rejectActivation(requestId, data.reason);
        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // 5. REMOTE KILL-SWITCH (Instant Emergency Lockdown & Supabase Realtime Sync)
  if (pathname.startsWith('/api/telemetry/kill-switch/') && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    const clubId = parseInt(pathname.split('/').pop(), 10);

    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const data = body ? JSON.parse(body) : {};
        const action = (data.action || 'LOCK').toUpperCase();
        const reason = data.reason || (action === 'LOCK' ? "Oylik obuna to'lovi to'lanmagan" : "Litsenziya faollashtirildi");

        let result;
        if (action === 'UNLOCK' || action === 'ACTIVATE') {
          // A) Qulfdan chiqarish
          result = await ActivationService.liftLockdown(clubId, data);
          await SupabaseCloudService.unblockClub(clubId, data.days || 30);
        } else {
          // B) Zalni bloklash (Kill-Switch)
          result = await ActivationService.dispatchKillSwitch(clubId, { ...data, reason });
          await SupabaseCloudService.blockClub(clubId, reason);
        }

        return sendJson(res, 200, result);
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  // ==========================================================================
  // TELEGRAM BOT & NOTIFICATION DISPATCHER ROUTES
  // ==========================================================================
  if (pathname === '/api/telegram/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const update = body ? JSON.parse(body) : {};
        const result = await TelegramBotService.handleWebhookUpdate(update);
        return sendJson(res, 200, { success: true, ...result });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  if (pathname === '/api/telegram/command' && req.method === 'POST') {
    if (!requireSuperAdminAuth(req, res)) return;
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      try {
        const { command } = body ? JSON.parse(body) : {};
        const responseText = await TelegramBotService.processCommand(command);
        return sendJson(res, 200, { success: true, command, response: responseText });
      } catch (err) {
        return sendJson(res, 400, { success: false, error: err.message });
      }
    });
    return;
  }

  if (pathname === '/api/telegram/logs' && req.method === 'GET') {
    if (!requireSuperAdminAuth(req, res)) return;
    const logs = TelegramBotService.getRecentLogs(30);
    return sendJson(res, 200, { success: true, logs });
  }

  // ==========================================================================
  // 3. STATIC FILES & PWA ROUTING
  // ==========================================================================
  if (pathname === '/' || pathname === '/index.html') {
    return serveStaticFile(res, path.resolve(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
  }

  if (pathname === '/login') {
    return serveStaticFile(res, path.resolve(PUBLIC_DIR, 'views/login.html'), 'text/html; charset=utf-8');
  }

  if (pathname === '/sw.js') {
    return serveStaticFile(res, path.resolve(PUBLIC_DIR, 'sw.js'), 'application/javascript; charset=utf-8');
  }

  if (pathname === '/manifest.json') {
    return serveStaticFile(res, path.resolve(PUBLIC_DIR, 'manifest.json'), 'application/json; charset=utf-8');
  }

  // Icons va boshqa statik resurslar
  const safePath = path.normalize(pathname).replace(/^(\.\.[\/\\])+/, '');
  const staticPath = path.resolve(PUBLIC_DIR, '.' + safePath);

  if (fs.existsSync(staticPath) && fs.statSync(staticPath).isFile()) {
    const ext = path.extname(staticPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    return serveStaticFile(res, staticPath, contentType);
  }

  // Fallback to index.html for SPA / PWA routes
  return serveStaticFile(res, path.resolve(PUBLIC_DIR, 'index.html'), 'text/html; charset=utf-8');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log('================================================================');
  console.log(`🚀 Softech Cloud Core & Mobile Cockpit: http://0.0.0.0:${PORT}`);
  console.log(`📱 PWA Login View:                      http://localhost:${PORT}/login`);
  console.log(`📊 Cockpit Dashboard:                  http://localhost:${PORT}/`);
  console.log(`⚡ Real-Time Cloud WebSocket:          ws://localhost:${PORT}/cloud-ws`);
  console.log('================================================================');
});

// 4. Doimiy Cloud WebSocket Serveri (Real-Time Kill-Switch & Telemetriya Kanali)
const wss = new WebSocketServer({ server, path: '/cloud-ws' });

wss.on('connection', (ws, req) => {
  const url = new URL(req.url || '/', `http://${req.headers.host}`);
  const hwid = url.searchParams.get('hwid');
  const clubId = url.searchParams.get('clubId');

  if (hwid) {
    ActivationService.registerSocket(`hwid:${hwid}`, ws);
  }
  if (clubId) {
    ActivationService.registerSocket(`club:${clubId}`, ws);
  }

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'NETCAFE_SERVER_HELLO' || msg.type === 'SERVER_HELLO' || msg.type === 'HEARTBEAT_PING') {
        if (msg.hwid || msg.hardwareFingerprint) {
          ActivationService.registerSocket(`hwid:${msg.hwid || msg.hardwareFingerprint}`, ws);
        }
        if (msg.clubId) {
          ActivationService.registerSocket(`club:${msg.clubId}`, ws);
        }
        ws.send(JSON.stringify({ type: 'HEARTBEAT_ACK', timestamp: Date.now() }));
      }
    } catch {}
  });

  ws.on('close', () => {
    if (hwid) ActivationService.unregisterSocket(`hwid:${hwid}`);
    if (clubId) ActivationService.unregisterSocket(`club:${clubId}`);
  });

  ws.on('error', (err) => {
    console.warn('⚠️ Cloud WebSocket xatoligi:', err.message);
  });
});
