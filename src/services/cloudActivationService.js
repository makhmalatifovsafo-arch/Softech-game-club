import crypto from 'node:crypto';
import { SupabaseCloudService } from './supabaseClient.js';
import { TelegramBotService } from './telegramBot.js';

export function activationError(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}
export function positiveInteger(value, fallback, maximum = 10000) {
  const number = Number(value ?? fallback);
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw activationError('Son noto\'g\'ri kiritilgan.');
  return number;
}
export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function validateHwid(value) {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(value) || value === 'HWID-UNKNOWN') throw activationError('Qurilma HWID aniqlanmadi.');
  return value;
}
export function signClubLicense(club, hwid) {
  if (!['ACTIVE', 'TRIAL'].includes(club.status)) throw activationError('Klub litsenziyasi faol emas.', 403);
  if (!Number.isFinite(Date.parse(club.license_expires_at)) || Date.parse(club.license_expires_at) <= Date.now()) throw activationError('Litsenziya muddati tugagan.', 403);
  const issuedAt = new Date().toISOString();
  const payload = { clubId: club.id, clubName: club.name, hardwareFingerprint: hwid, status: 'ACTIVE', issuedAt,
    expiresAt: new Date(club.license_expires_at).toISOString(), maxPcs: club.total_workstations, verifiedAt: issuedAt };
  const signature = crypto.createHmac('sha256', process.env.SOFTECH_CLOUD_KEY || 'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026').update(JSON.stringify(payload)).digest('hex');
  return { payload, signature };
}
export class CloudActivationService {
  static client() {
    const client = SupabaseCloudService.getClient();
    if (!client) throw activationError('Bulut bazasi sozlanmagan. SUPABASE_URL va SUPABASE_SERVICE_ROLE_KEY ni tekshiring.', 503);
    return client;
  }
  static async result(query) {
    const { data, error } = await query;
    if (error) throw activationError('Bulut bazasida xatolik: ' + error.message, 503);
    return data;
  }
  static async byHwid(hwid) {
    return this.result(this.client().from('clubs').select('*').eq('hardware_fingerprint', hwid).maybeSingle());
  }
  static async createActivationRequest(body) {
    const hwid = validateHwid(body.hardwareFingerprint);
    let club = await this.byHwid(hwid);
    if (!club) {
      const row = { name: String(body.clubName || 'Yangi Game Club').trim().slice(0, 160),
        hardware_fingerprint: hwid, total_workstations: positiveInteger(body.totalPcs, 16),
        server_lan_ip: String(body.serverLanIp || ''), server_version: String(body.serverVersion || ''),
        status: 'PENDING', api_secret_token: 'softech_sec_' + crypto.randomBytes(24).toString('hex') };
      // Ignore duplicate HWIDs: retries must never reset an already active/blocked club.
      await this.result(this.client().from('clubs').upsert(row, { onConflict: 'hardware_fingerprint', ignoreDuplicates: true }));
      club = await this.byHwid(hwid);
      if (!club) throw activationError('Litsenziya so\'rovi saqlanmadi.', 503);
    }
    if (club.status !== 'PENDING') return { success: true, status: ['ACTIVE','TRIAL'].includes(club.status) ? 'APPROVED' : 'REJECTED', message: 'So\'rov holati mavjud.' };
    const notification = await TelegramBotService.sendMessage(
      '<b>YANGI SERVER LITSENZIYA SO\'ROVI</b>\nKlub: ' + escapeHtml(club.name) + '\nHWID: <code>' + escapeHtml(hwid) + '</code>\nPC: ' + club.total_workstations,
      { replyMarkup: { inline_keyboard: [[{ text: 'Tasdiqlash', callback_data: 'approve_' + club.id }, { text: 'Rad etish', callback_data: 'reject_' + club.id }]] } });
    return { success: true, status: 'PENDING', requestId: club.id, notification,
      message: notification.success ? 'So\'rov saqlandi va Telegramga yuborildi.' : 'So\'rov saqlandi. Telegramga yuborilmadi; super admin panelidan tasdiqlash mumkin.' };
  }
  static async getPendingRequests() {
    const rows = await this.result(this.client().from('clubs').select('*').eq('status', 'PENDING'));
    return (rows || []).map(c => ({ id: c.id, club_name: c.name, total_pcs: c.total_workstations, hardware_fingerprint: c.hardware_fingerprint, created_at: c.created_at, status: c.status }));
  }
  static async approveActivation(id, { days = 30, maxPcs } = {}) {
    const client = this.client();
    const club = await this.result(client.from('clubs').select('*').eq('id', id).maybeSingle());
    if (!club) throw activationError('So\'rov topilmadi.', 404);
    if (club.status !== 'PENDING') throw activationError('So\'rov allaqachon ko\'rib chiqilgan.', 409);
    const updated = await this.result(client.from('clubs').update({ status: 'ACTIVE',
      license_expires_at: new Date(Date.now() + positiveInteger(days, 30, 3650) * 86400000).toISOString(),
      total_workstations: positiveInteger(maxPcs, club.total_workstations), updated_at: new Date().toISOString()
    }).eq('id', id).eq('status', 'PENDING').select().maybeSingle());
    if (!updated) throw activationError('So\'rov holati o\'zgargan. Sahifani yangilang.', 409);
    return { success: true, club: updated, signedLicense: signClubLicense(updated, updated.hardware_fingerprint) };
  }
  static async rejectActivation(id, reason = 'Super Admin tomonidan rad etildi') {
    const row = await this.result(this.client().from('clubs').update({ status: 'BLOCKED', block_reason: String(reason).slice(0, 500) }).eq('id', id).eq('status', 'PENDING').select().maybeSingle());
    if (!row) throw activationError('Kutilayotgan so\'rov topilmadi.', 409);
    return { success: true };
  }
  static async activateByKey({ licenseKey, hardwareFingerprint }) {
    const hwid = validateHwid(hardwareFingerprint);
    if (typeof licenseKey !== 'string' || !licenseKey.trim()) throw activationError('Litsenziya kaliti kiritilishi shart.');
    const client = this.client();
    let club = await this.result(client.from('clubs').select('*').eq('api_secret_token', licenseKey.trim()).maybeSingle());
    if (!club) throw activationError('Litsenziya kaliti topilmadi.', 404);
    if (club.hardware_fingerprint && club.hardware_fingerprint !== hwid) throw activationError('Kalit boshqa kompyuterga biriktirilgan.', 409);
    signClubLicense(club, hwid); // Validate subscription before changing hardware.
    const existing = await this.byHwid(hwid);
    if (existing && existing.id !== club.id) {
      if (existing.status !== 'PENDING') throw activationError('Bu qurilma boshqa klubga biriktirilgan.', 409);
      await this.result(client.from('clubs').delete().eq('id', existing.id).eq('status', 'PENDING'));
    }
    let query = client.from('clubs').update({ hardware_fingerprint: hwid, updated_at: new Date().toISOString() }).eq('id', club.id);
    query = club.hardware_fingerprint ? query.eq('hardware_fingerprint', hwid) : query.is('hardware_fingerprint', null);
    club = await this.result(query.select().maybeSingle());
    if (!club) throw activationError('Kalit boshqa qurilmada ishlatilgan.', 409);
    return { success: true, club: { id: club.id, name: club.name }, signedLicense: signClubLicense(club, hwid) };
  }
  static async getActivationStatus(hwid) {
    validateHwid(hwid);
    const club = await this.byHwid(hwid);
    if (!club) return { success: true, status: 'NONE' };
    if (club.status === 'PENDING') return { success: true, status: 'PENDING' };
    if (!['ACTIVE','TRIAL'].includes(club.status) || Date.parse(club.license_expires_at) <= Date.now()) return { success: true, status: 'REJECTED', reason: club.block_reason || 'Litsenziya faol emas yoki muddati tugagan.' };
    return { success: true, status: 'APPROVED', club: { id: club.id, name: club.name }, signedLicense: signClubLicense(club, hwid) };
  }
}
