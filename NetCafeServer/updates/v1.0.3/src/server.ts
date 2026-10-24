import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { initDatabase, db } from './db.js';
import { ClientManager } from './services/clientManager.js';
import { HeartbeatMonitor } from './services/heartbeatMonitor.js';
import { SessionScheduler } from './services/sessionScheduler.js';
import { ProtocolDispatcher } from './handlers/protocolDispatcher.js';
import type {
  StartSessionPayload,
  StopSessionPayload,
  LockScreenPayload,
  UpdateRemainingTimePayload,
  SendMessagePayload
} from './types/protocol.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PUBLIC_DIR = path.resolve(__dirname, '../public');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 5000;

// 1. Bazani initsializatsiya qilish
initDatabase();

// 20 ta test kompyuter bo'lishini ta'minlash (Klub xaritasi chiroyli chiqishi uchun)
ensureInitialComputers();

function ensureInitialComputers() {
  const countRow = db.prepare('SELECT COUNT(*) as count FROM computers').get() as { count: number };
  if (countRow.count < 10) {
    for (let i = 1; i <= 20; i++) {
      const pcId = `pc_${i}`;
      const pcNumber = i;
      const pcName = `PC-${String(i).padStart(2, '0')}`;
      const status = i <= 2 ? 'AVAILABLE' : (i === 3 ? 'OCCUPIED' : (i <= 6 ? 'LOCKED' : 'OFFLINE'));

      db.prepare(`
        INSERT OR IGNORE INTO computers (id, pc_number, name, ip_address, mac_address, status)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(pcId, pcNumber, pcName, `192.168.1.${100 + i}`, `00:1A:2B:3C:4D:${String(i).padStart(2, '0')}`, status);
    }

    // 3-kompyuterga faol test seans kiritish (demoda vaqt ketayotganini ko'rish uchun)
    const now = new Date();
    const ends = new Date(now.getTime() + 75 * 60 * 1000); // 1 soat 15 minut qolgan
    db.prepare(`
      INSERT OR IGNORE INTO sessions (id, computer_id, tariff_id, customer_name, started_at, ends_at, total_amount, paid_amount, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
    `).run('ses_demo_3', 'pc_3', 'trf_standard_1h', 'Bekzod', now.toISOString(), ends.toISOString(), 15000, 15000);

    db.prepare(`
      UPDATE computers SET current_session_id = 'ses_demo_3' WHERE id = 'pc_3'
    `).run();

    // Test tranzaksiyalari (Kassa statistikasi uchun)
    db.prepare(`
      INSERT OR IGNORE INTO transactions (id, session_id, amount, payment_type, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run('tx_demo_1', 'ses_demo_3', 15000, 'CASH', 'usr_admin_default');

    db.prepare(`
      INSERT OR IGNORE INTO transactions (id, session_id, amount, payment_type, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run('tx_demo_2', null, 30000, 'CARD', 'usr_admin_default');
  }
}

// 2. HTTP Server va REST API
const server = http.createServer((req, res) => {
  // CORS sarlavhalari
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url || '/', `http://${req.headers.host}`);

  // --------------------------------------------------------------------------
  // REST API Marshrutlari
  // --------------------------------------------------------------------------

  // 1. GET /api/computers — Barcha kompyuterlar holati va seanslari
  if (url.pathname === '/api/computers' && req.method === 'GET') {
    const computers = db.prepare(`
      SELECT 
        c.id, c.pc_number, c.name, c.ip_address, c.mac_address, c.status,
        s.id as session_id, s.customer_name, s.started_at, s.ends_at, s.total_amount,
        t.name as tariff_name
      FROM computers c
      LEFT JOIN sessions s ON c.current_session_id = s.id AND s.status = 'ACTIVE'
      LEFT JOIN tariffs t ON s.tariff_id = t.id
      ORDER BY c.pc_number ASC
    `).all();

    const now = Date.now();
    const formatted = computers.map((pc: any) => {
      let remainingSeconds = 0;
      if (pc.ends_at) {
        remainingSeconds = Math.max(0, Math.floor((new Date(pc.ends_at).getTime() - now) / 1000));
      }
      return {
        id: pc.id,
        pcNumber: pc.pc_number,
        name: pc.name,
        ipAddress: pc.ip_address,
        macAddress: pc.mac_address,
        status: pc.status,
        activeSession: pc.session_id ? {
          sessionId: pc.session_id,
          customerName: pc.customer_name,
          tariffName: pc.tariff_name,
          startedAt: pc.started_at,
          endsAt: pc.ends_at,
          remainingSeconds
        } : null
      };
    });

    sendJson(res, 200, formatted);
    return;
  }

  // 2. GET /api/tariffs — Faol tariflar
  if (url.pathname === '/api/tariffs' && req.method === 'GET') {
    const tariffs = db.prepare('SELECT * FROM tariffs WHERE is_active = 1 ORDER BY price_per_hour ASC').all();
    sendJson(res, 200, tariffs);
    return;
  }

  // 3. GET /api/stats — Bugungi kassa va klub statistikasi
  if (url.pathname === '/api/stats' && req.method === 'GET') {
    const totalCash = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
      WHERE payment_type = 'CASH' AND DATE(created_at) = DATE('now')
    `).get() as { total: number };

    const totalCard = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM transactions 
      WHERE payment_type IN ('CARD', 'CLICK', 'PAYME') AND DATE(created_at) = DATE('now')
    `).get() as { total: number };

    const pcCounts = db.prepare(`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN status = 'OCCUPIED' THEN 1 ELSE 0 END) as occupied,
        SUM(CASE WHEN status = 'AVAILABLE' THEN 1 ELSE 0 END) as available,
        SUM(CASE WHEN status = 'OFFLINE' THEN 1 ELSE 0 END) as offline
      FROM computers
    `).get() as { total: number; occupied: number; available: number; offline: number };

    sendJson(res, 200, {
      totalRevenue: totalCash.total + totalCard.total,
      cashRevenue: totalCash.total,
      cardRevenue: totalCard.total,
      totalComputers: pcCounts.total,
      occupiedComputers: pcCounts.occupied || 0,
      availableComputers: pcCounts.available || 0,
      offlineComputers: pcCounts.offline || 0
    });
    return;
  }

  // 4. POST /api/sessions/start — Yangi seans boshlash
  if (url.pathname === '/api/sessions/start' && req.method === 'POST') {
    readBody(req, (data) => {
      try {
        const { computerId, tariffId, durationMinutes, customerName, paymentType, amount } = data;

        const tariff = db.prepare('SELECT name FROM tariffs WHERE id = ?').get(tariffId) as { name: string } | undefined;
        if (!tariff) {
          sendJson(res, 400, { error: 'Tarif topilmadi' });
          return;
        }

        const sessionId = `ses_${Date.now().toString(36)}`;
        const startedAt = new Date();
        const endsAt = new Date(startedAt.getTime() + durationMinutes * 60 * 1000);

        // 1. Sessiya qo'shish
        db.prepare(`
          INSERT INTO sessions (id, computer_id, tariff_id, customer_name, started_at, ends_at, total_amount, paid_amount, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ACTIVE')
        `).run(sessionId, computerId, tariffId, customerName || 'Mijoz', startedAt.toISOString(), endsAt.toISOString(), amount, amount);

        // 2. Tranzaksiya qo'shish
        db.prepare(`
          INSERT INTO transactions (id, session_id, amount, payment_type, created_by)
          VALUES (?, ?, ?, ?, 'usr_admin_default')
        `).run(`tx_${Date.now().toString(36)}`, sessionId, amount, paymentType || 'CASH');

        // 3. Kompyuter holatini yangilash
        db.prepare(`
          UPDATE computers 
          SET status = 'OCCUPIED', current_session_id = ? 
          WHERE id = ?
        `).run(sessionId, computerId);

        // 4. Klientga WebSocket orqali START_SESSION yuborish
        const startPayload: StartSessionPayload = {
          sessionId,
          tariffName: tariff.name,
          startedAt: startedAt.getTime(),
          endsAt: endsAt.getTime(),
          remainingSeconds: durationMinutes * 60,
          customerName: customerName || 'Mijoz',
        };
        ClientManager.send(computerId, 'START_SESSION', startPayload);

        // Barcha Admin panellarga yangilanish yuborish
        broadcastAdminUpdate();

        sendJson(res, 201, { success: true, sessionId });
      } catch (e: any) {
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // 5. POST /api/sessions/stop — Seansni majburiy to'xtatish (Qulflash)
  if (url.pathname === '/api/sessions/stop' && req.method === 'POST') {
    readBody(req, (data) => {
      try {
        const { computerId } = data;
        const pc = db.prepare('SELECT current_session_id FROM computers WHERE id = ?').get(computerId) as any;

        if (pc?.current_session_id) {
          db.prepare(`UPDATE sessions SET status = 'COMPLETED', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(pc.current_session_id);
        }

        db.prepare(`UPDATE computers SET status = 'LOCKED', current_session_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(computerId);

        // Klientga STOP va LOCK yuborish
        ClientManager.send(computerId, 'STOP_SESSION', {
          sessionId: pc?.current_session_id || '',
          reason: 'ADMIN_TERMINATED',
          forceKillApps: true,
          message: 'Seans administrator tomonidan to\'xtatildi.'
        });
        ClientManager.send(computerId, 'LOCK_SCREEN', {
          reason: 'ADMIN_LOCK',
          message: 'Kompyuter administrator tomonidan bloklandi.'
        });

        broadcastAdminUpdate();
        sendJson(res, 200, { success: true });
      } catch (e: any) {
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // 6. POST /api/sessions/extend — Vaqt qo'shish
  if (url.pathname === '/api/sessions/extend' && req.method === 'POST') {
    readBody(req, (data) => {
      try {
        const { computerId, additionalMinutes, additionalAmount, paymentType } = data;
        const pc = db.prepare('SELECT current_session_id FROM computers WHERE id = ?').get(computerId) as any;

        if (!pc?.current_session_id) {
          sendJson(res, 400, { error: 'Faol seans topilmadi' });
          return;
        }

        const session = db.prepare('SELECT ends_at, total_amount, paid_amount FROM sessions WHERE id = ?').get(pc.current_session_id) as any;
        const currentEnd = new Date(session.ends_at).getTime();
        const newEnd = new Date(currentEnd + additionalMinutes * 60 * 1000);

        db.prepare(`
          UPDATE sessions 
          SET ends_at = ?, total_amount = total_amount + ?, paid_amount = paid_amount + ?, updated_at = CURRENT_TIMESTAMP
          WHERE id = ?
        `).run(newEnd.toISOString(), additionalAmount, additionalAmount, pc.current_session_id);

        if (additionalAmount > 0) {
          db.prepare(`
            INSERT INTO transactions (id, session_id, amount, payment_type, created_by)
            VALUES (?, ?, ?, ?, 'usr_admin_default')
          `).run(`tx_${Date.now().toString(36)}`, pc.current_session_id, additionalAmount, paymentType || 'CASH');
        }

        // Klientga vaqt yangilanganini bildirish
        const remSec = Math.floor((newEnd.getTime() - Date.now()) / 1000);
        ClientManager.send(computerId, 'UPDATE_REMAINING_TIME', {
          sessionId: pc.current_session_id,
          remainingSeconds: remSec,
          endsAt: newEnd.getTime()
        });

        broadcastAdminUpdate();
        sendJson(res, 200, { success: true, newEndsAt: newEnd.toISOString(), remainingSeconds: remSec });
      } catch (e: any) {
        sendJson(res, 500, { error: e.message });
      }
    });
    return;
  }

  // 7. POST /api/messages/send — Xabar yuborish
  if (url.pathname === '/api/messages/send' && req.method === 'POST') {
    readBody(req, (data) => {
      const { computerId, title, message } = data;
      ClientManager.send(computerId, 'SEND_MESSAGE', {
        messageId: `msg_${Date.now()}`,
        title: title || 'Admin Xabari',
        message: message || '',
        severity: 'INFO',
        displayDurationSeconds: 10
      });
      sendJson(res, 200, { success: true });
    });
    return;
  }

  // --------------------------------------------------------------------------
  // Statik fayllar (Admin Panel Frontend)
  // --------------------------------------------------------------------------
  let filePath = path.join(PUBLIC_DIR, url.pathname === '/' ? 'index.html' : url.pathname);
  if (!fs.existsSync(filePath)) {
    filePath = path.join(PUBLIC_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.html': 'text/html',
      '.js': 'text/javascript',
      '.css': 'text/css',
      '.json': 'application/json',
      '.svg': 'image/svg+xml'
    };
    res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

// Yordamchi metodlar
function sendJson(res: http.ServerResponse, code: number, data: any) {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req: http.IncomingMessage, callback: (data: any) => void) {
  let body = '';
  req.on('data', chunk => { body += chunk; });
  req.on('end', () => {
    try {
      callback(JSON.parse(body));
    } catch {
      callback({});
    }
  });
}

function broadcastAdminUpdate() {
  ClientManager.broadcast('ADMIN_DATA_UPDATED', { timestamp: Date.now() });
}

// 3. WebSocket Serverni ulash
const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', (socket: WebSocket, req) => {
  const remoteIp = req.socket.remoteAddress || 'unknown';

  socket.on('message', (data: Buffer | string) => {
    ProtocolDispatcher.handleMessage(socket, data.toString());
  });

  socket.on('close', () => {
    ClientManager.unregisterClient(socket);
    broadcastAdminUpdate();
  });

  socket.on('error', () => {
    ClientManager.unregisterClient(socket);
    broadcastAdminUpdate();
  });
});

// 4. Serverni ishga tushirish
server.listen(PORT, () => {
  console.log('================================================================');
  console.log(`🚀 NetCafe Pro Core Engine Server: http://localhost:${PORT}`);
  console.log(`🖥️  Admin Dashboard Panel:        http://localhost:${PORT}/`);
  console.log(`🔌 WebSocket Endpoint:            ws://localhost:${PORT}/ws`);
  console.log('================================================================');

  HeartbeatMonitor.start();
  SessionScheduler.start();
});

// Graceful Shutdown
process.on('SIGINT', () => {
  HeartbeatMonitor.stop();
  SessionScheduler.stop();
  db.close();
  server.close(() => {
    process.exit(0);
  });
});
