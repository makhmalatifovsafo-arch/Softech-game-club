/**
 * Softech Super Admin — Master Telegram Notification Dispatcher
 * Location: SoftechCloudAdmin/src/services/telegramBot.js
 * 
 * Pings the SaaS owner about critical club events and responds to bot commands:
 * 1. Server Offline Alert
 * 2. Server Restored Alert
 * 3. Subscription Expiring Alert
 * 4. Version Updated Alert
 * 5. Hardware Fingerprint Activation Request & Approval
 * 6. Remote Kill-Switch Action
 * Commands: /status, /revenue, /clubs, /start, /help
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/connection.js';
import { TelemetryService } from '../db/telemetryService.js';
import { BillingService } from './billingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

function loadInitialCredentials() {
  let token = process.env.TELEGRAM_BOT_TOKEN;
  let chatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  try {
    const configPath = path.resolve(ROOT_DIR, 'config.json');
    if (fs.existsSync(configPath)) {
      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      if (!token && config.telegram?.botToken) token = config.telegram.botToken;
      if (!chatId && config.telegram?.adminChatId) chatId = config.telegram.adminChatId;
    }
  } catch {}

  return {
    botToken: token || '8984240982:AAGwNfsGlyIG7ewsWKA8Odbo_rchA6Et-a8',
    adminChatId: chatId ? String(chatId) : '958262819'
  };
}

const initial = loadInitialCredentials();

export class TelegramBotService {
  static botToken = initial.botToken;
  static adminChatId = initial.adminChatId;
  static isPolling = false;
  static lastUpdateId = 0;
  static sentMessagesLog = [];

  /**
   * Konfiguratsiyani o'rnatish
   */
  static configure({ token, chatId }) {
    if (token) this.botToken = token;
    if (chatId) this.adminChatId = String(chatId);
    console.log(`🤖 [Telegram Bot] Konfiguratsiya yangilandi (Token: ${this.botToken ? 'O\'rnatilgan' : 'Yo\'q'}, Admin Chat ID: ${this.adminChatId}).`);
  }

  /**
   * Asosiy klaviatura menyusi (Tezkor tugmalar)
   */
  static getMainKeyboard() {
    return {
      keyboard: [
        [{ text: '📊 /status' }, { text: '💵 /revenue' }],
        [{ text: '🏢 /clubs' }, { text: '❓ /help' }]
      ],
      resize_keyboard: true,
      persistent: true
    };
  }

  /**
   * Asosiy xabar yuborish metodi (HTML formati bilan)
   */
  static async sendMessage(text, { chatId = null, parseMode = 'HTML', replyMarkup = null } = {}) {
    const targetChatId = chatId || this.adminChatId;
    const timestamp = new Date().toISOString();

    const record = {
      timestamp,
      targetChatId,
      text,
      status: 'SENT'
    };
    this.sentMessagesLog.unshift(record);
    if (this.sentMessagesLog.length > 50) this.sentMessagesLog.pop();

    if (this.botToken && !this.botToken.startsWith('MOCK_')) {
      try {
        const url = `https://api.telegram.org/bot${this.botToken}/sendMessage`;
        const bodyObj = {
          chat_id: targetChatId,
          text,
          parse_mode: parseMode
        };

        if (replyMarkup) {
          bodyObj.reply_markup = replyMarkup;
        }

        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(bodyObj)
        });
        const data = await res.json();
        if (!data.ok) {
          console.warn(`⚠️ [Telegram Bot] API javob xatosi (${data.error_code}): ${data.description}`);
        }
        return { success: data.ok, messageId: data.result?.message_id, data };
      } catch (err) {
        console.warn('⚠️ [Telegram Bot] Tarmoq orqali yuborishda xatolik:', err.message);
        return { success: false, error: err.message };
      }
    }

    console.log(`\n📨 [Telegram Bot Dispatched to Chat ${targetChatId}]:\n${text}\n`);
    return { success: true, simulated: true, timestamp };
  }

  // ==========================================================================
  // 1. ALERT TRIGGERS (HODISA VA OGOHLANTIRISHLAR)
  // ==========================================================================

  /**
   * 1. Server Offline Alert:
   * "🚨 DIQQAT: 'CyberArena' klubi serveri bilan aloqa uzildi! (Oxirgi signal: 3 daqiqa oldin)"
   */
  static async sendServerOfflineAlert(clubName, minutesAgo = 3) {
    const text = `🚨 <b>DIQQAT: '${clubName}' klubi serveri bilan aloqa uzildi!</b>\n` +
      `⏱️ <i>Oxirgi signal: ${minutesAgo} daqiqa oldin</i>\n\n` +
      `⚠️ Lokal server elektr quvvati yoki internet uzilgan bo'lishi mumkin. Kassa holatini tekshirish tavsiya etiladi.`;

    return this.sendMessage(text, { replyMarkup: this.getMainKeyboard() });
  }

  /**
   * 2. Server Restored:
   * "✅ ALOQA TIKLANDI: 'CyberArena' qayta onlayn bo'ldi"
   */
  static async sendServerRestoredAlert(clubName) {
    const text = `✅ <b>ALOQA TIKLANDI: '${clubName}' qayta onlayn bo'ldi!</b>\n\n` +
      `🟢 Filial kassa serveri bulut bilan muvaffaqiyatli sinxronlashdi va jonli telemetriya uzatmoqda.`;

    return this.sendMessage(text, { replyMarkup: this.getMainKeyboard() });
  }

  /**
   * 3. To'lov Ogohlantirishi:
   * "📅 OBUNA TUGAMOQDA: 'Major Club' litsenziyasi tugashiga 2 kun qoldi"
   */
  static async sendSubscriptionExpiringAlert(clubName, daysLeft = 2) {
    const text = `📅 <b>OBUNA TUGAMOQDA: '${clubName}' litsenziyasi tugashiga ${daysLeft} kun qoldi!</b>\n\n` +
      `💳 SaaS oylik obuna to'lovi qilinmasa, kassa paneli avtomatik bloklanadi. Klub rahbari bilan bog'lanish tavsiya etiladi.`;

    return this.sendMessage(text, { replyMarkup: this.getMainKeyboard() });
  }

  /**
   * 4. Yangi Versiya Qabul Qilindi:
   * "🚀 UPDATE: 'Apex Gaming' o'z tizimini v1.0.1 versiyasiga muvaffaqiyatli yangiladi"
   */
  static async sendVersionUpdatedAlert(clubName, newVersion = '1.0.1') {
    const cleanVersion = String(newVersion).startsWith('v') ? newVersion : `v${newVersion}`;
    const text = `🚀 <b>UPDATE: '${clubName}' o'z tizimini ${cleanVersion} versiyasiga muvaffaqiyatli yangiladi!</b>\n\n` +
      `✓ OTA paket to'liq qabul qilindi va barcha lokal kompyuterlar yangi xavfsizlik protokoli bilan ishlamoqda.`;

    return this.sendMessage(text, { replyMarkup: this.getMainKeyboard() });
  }

  // ==========================================================================
  // 2. BOT BUYRUQLARI (COMMANDS)
  // ==========================================================================

  static async processCommand(commandText, chatId = null) {
    const rawCmd = String(commandText || '').trim();
    const cmd = rawCmd.toLowerCase();

    // 1. /status — Barcha klublarning joriy holati
    if (cmd === '/status' || cmd.startsWith('/status@') || cmd.includes('/status')) {
      const summary = TelemetryService.getGlobalMetricsSummary();
      const clubs = TelemetryService.getAllClubsWithLiveMetrics();

      let clubsListText = '';
      for (const c of clubs) {
        const icon = c.is_online_now ? '🟢' : '🔴';
        const statusLabel = c.is_online_now ? 'Onlayn' : 'Oflayn';
        clubsListText += `• ${icon} <b>${c.name}</b> (${statusLabel} • ${c.total_workstations} PC)\n`;
      }

      const totalPcs = summary.workstations.totalNetwork || 1;
      const occupiedPcs = summary.workstations.occupiedNow || 0;
      const loadPercent = Math.round((occupiedPcs / totalPcs) * 100);

      const responseText = 
        `📊 <b>Softech SaaS — Platforma Holati</b>\n\n` +
        `🏢 <b>Klublar:</b> ${summary.clubs.total} ta (${summary.clubs.onlineNow} onlayn, ${summary.clubs.total - summary.clubs.onlineNow} oflayn)\n` +
        `🖥️ <b>Zal Yuklamasi:</b> ${occupiedPcs} / ${totalPcs} PC band (${loadPercent}%)\n` +
        `⚡ <b>Server Versiyasi:</b> v1.0.1 Live\n\n` +
        `<b>Filiallar holati:</b>\n` +
        (clubsListText || '• Ro\'yxat bo\'sh\n');

      await this.sendMessage(responseText, { chatId, replyMarkup: this.getMainKeyboard() });
      return responseText;
    }

    // 2. /revenue — Bugungi umumiy platforma tushumi
    if (cmd === '/revenue' || cmd.startsWith('/revenue@') || cmd.includes('/revenue')) {
      const summary = TelemetryService.getGlobalMetricsSummary();
      const billingSummary = BillingService.getBillingSummary();

      const todayRev = (summary.revenue.todayTotal || 0).toLocaleString();
      const barRev = (summary.revenue.barTotal || 0).toLocaleString();
      const sessionsRev = Math.max(0, (summary.revenue.todayTotal || 0) - (summary.revenue.barTotal || 0)).toLocaleString();
      const mrrFormatted = (billingSummary.mrr || 0).toLocaleString();

      const responseText = 
        `💵 <b>Softech SaaS — Bugungi Tushum</b>\n\n` +
        `💰 <b>Jami Kassa:</b> ${todayRev} UZS\n` +
        `🎮 <b>O'yin Seanslari:</b> ${sessionsRev} UZS (${summary.revenue.sessionsCount} ta seans)\n` +
        `🥤 <b>Bar Savdosi:</b> ${barRev} UZS\n` +
        `💳 <b>SaaS Oylik MRR:</b> ${mrrFormatted} UZS / oy\n\n` +
        `<i>Real vaqtdagi kassa telemetriyasi faol.</i>`;

      await this.sendMessage(responseText, { chatId, replyMarkup: this.getMainKeyboard() });
      return responseText;
    }

    // 3. /clubs — Klublar ro'yxati va ma'lumotlari
    if (cmd === '/clubs' || cmd.startsWith('/clubs@') || cmd.includes('/clubs')) {
      const clubs = TelemetryService.getAllClubsWithLiveMetrics();
      let text = `🏢 <b>Ro'yxatdan o'tgan klublar (${clubs.length} ta):</b>\n\n`;

      for (const c of clubs) {
        const icon = c.is_online_now ? '🟢' : '🔴';
        text += `${icon} <b>${c.name}</b>\n` +
          `   📍 Shahar: ${c.city || 'Toshkent'}\n` +
          `   👤 Mas'ul: ${c.owner_name || 'Kassir'} (${c.owner_phone || '-'})\n` +
          `   💻 Kompyuterlar: ${c.total_workstations} ta (${c.occupied_workstations_count || 0} band)\n` +
          `   📅 Litsenziya: ${c.license_status || 'ACTIVE'}\n\n`;
      }

      await this.sendMessage(text, { chatId, replyMarkup: this.getMainKeyboard() });
      return text;
    }

    // /start yoki /help
    if (cmd === '/start' || cmd === '/help' || cmd.includes('/start') || cmd.includes('/help')) {
      const helpText = 
        `👋 <b>Assalomu alaykum, Softech SaaS Egasi!</b>\n\n` +
        `Men <b>Softech Super Admin</b> markaziy monitoring botiman.\n` +
        `Barcha filiallardagi kassa uzilishlari, yangi versiyalar, litsenziya muddatlari va tushumlar haqida sizga real vaqtda xabar berib boraman.\n\n` +
        `<b>Tezkor buyruqlar:</b>\n` +
        `📊 /status — Barcha klublarning onlayn/oflayn holati va yuklamasi\n` +
        `💵 /revenue — Bugungi umumiy platforma tushumi va MRR\n` +
        `🏢 /clubs — Ro'yxatdan o'tgan barcha filiallar ro'yxati\n` +
        `❓ /help — Yordam va buyruqlar ma'lumotnomasi\n\n` +
        `📞 <b>Qo'llab-quvvatlash (Support):</b>\n` +
        `• +998 95 222 06 44\n` +
        `• +998 99 563 45 16\n\n` +
        `<i>Pastdagi tugmalardan foydalanishingiz mumkin 👇</i>`;

      await this.sendMessage(helpText, { chatId, replyMarkup: this.getMainKeyboard() });
      return helpText;
    }

    // Noma'lum buyruq
    const unknownText = `Noma'lum buyruq. Marhamat, quyidagi tugmalardan birini tanlang:`;
    await this.sendMessage(unknownText, { chatId, replyMarkup: this.getMainKeyboard() });
    return unknownText;
  }

  // ==========================================================================
  // 3. TELEGRAM LONG POLLING DISPATCHER
  // ==========================================================================

  /**
   * Long-polling orqali Telegram serveridan yangi xabarlarni tinglash
   */
  static startPolling() {
    if (this.isPolling) return;
    if (!this.botToken || this.botToken.startsWith('MOCK_')) {
      console.log('ℹ️ [Telegram Bot] Token o\'rnatilmagan yoki MOCK holatda, polling ishga tushirilmadi.');
      return;
    }

    this.isPolling = true;
    console.log(`🤖 [Telegram Bot] Long-Polling ishga tushirildi (@softech_superadmin006_bot)...`);

    // Fon tsiklida so'rov jo'natish
    const pollLoop = async () => {
      while (this.isPolling) {
        try {
          const url = `https://api.telegram.org/bot${this.botToken}/getUpdates?offset=${this.lastUpdateId + 1}&timeout=20`;
          const res = await fetch(url, { method: 'GET' });
          if (res.ok) {
            const data = await res.json();
            if (data.ok && Array.isArray(data.result)) {
              for (const update of data.result) {
                this.lastUpdateId = update.update_id;
                await this.handleWebhookUpdate(update);
              }
            }
          }
        } catch (err) {
          // Tarmoq uzilishida ozgina kutamiz
          await new Promise(r => setTimeout(r, 5000));
        }

        // Qisqa tanaffus
        await new Promise(r => setTimeout(r, 500));
      }
    };

    pollLoop();
  }

  static stopPolling() {
    this.isPolling = false;
  }

  /**
   * Telegram Webhook / Update ni qabul qilish
   */
  static async handleWebhookUpdate(update) {
    if (!update || !update.message) return { handled: false };

    const message = update.message;
    const text = message.text;
    const chatId = message.chat?.id;

    // Agar admin chat ID birinchi marta kelsa va mos kelsa, saqlab qo'yamiz
    if (chatId && String(chatId) === this.adminChatId) {
      this.adminChatId = String(chatId);
    }

    if (text) {
      console.log(`📩 [Telegram Bot Input]: "${text}" (Chat ID: ${chatId})`);
      const response = await this.processCommand(text, chatId);
      return { handled: true, command: text, response };
    }

    return { handled: true };
  }

  /**
   * So'nggi yuborilgan xabarlar logi (API va testlar uchun)
   */
  static getRecentLogs(limit = 20) {
    return this.sentMessagesLog.slice(0, limit);
  }
}
