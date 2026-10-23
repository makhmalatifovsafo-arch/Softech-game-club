/**
 * Softech Game Club Management System — HWID Engine
 * Location: NetCafeServer/src/services/hwidService.js
 * 
 * Hardware Fingerprinting & Tamper-Resistant Machine Binding
 * Queries Motherboard UUID, CPU Processor ID, and Primary NIC MAC address.
 */

import crypto from 'node:crypto';
import os from 'node:os';
import { execSync } from 'node:child_process';

const PRIVATE_SYSTEM_SALT = process.env.SOFTECH_HWID_SALT || 'SOFTECH_CRYPTO_SYSTEM_SALT_2026_SECURE_HWID_BINDING';

export class HwidService {
  static _cachedFingerprint = null;
  static _cachedRawComponents = null;

  /**
   * 1. Ona plata (Motherboard) UUID sini olish
   */
  static getMotherboardUuid() {
    try {
      if (process.platform === 'win32') {
        // 1-urinish: wmic
        const out = execSync('wmic csproduct get uuid', { encoding: 'utf8', timeout: 3000 });
        const lines = out.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.toUpperCase().includes('UUID'));
        if (lines.length > 0 && lines[0].length >= 10 && !lines[0].includes('00000000')) {
          return lines[0].toUpperCase();
        }

        // 2-urinish: PowerShell CIM
        const psOut = execSync('powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_ComputerSystemProduct).UUID"', { encoding: 'utf8', timeout: 4000 });
        const psUuid = psOut.trim();
        if (psUuid && psUuid.length >= 10) {
          return psUuid.toUpperCase();
        }
      }
    } catch (err) {
      // Fallback
    }

    // Windows bo'lmagan yoki WMI xatosi uchun barqaror fallback
    return `FALLBACK-MB-${os.hostname().toUpperCase()}`;
  }

  /**
   * 2. CPU Processor ID sini olish
   */
  static getCpuProcessorId() {
    try {
      if (process.platform === 'win32') {
        const out = execSync('wmic cpu get processorid', { encoding: 'utf8', timeout: 3000 });
        const lines = out.trim().split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.toUpperCase().includes('PROCESSORID'));
        if (lines.length > 0 && lines[0].length >= 4) {
          return lines[0].toUpperCase();
        }

        const psOut = execSync('powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Processor).ProcessorId"', { encoding: 'utf8', timeout: 4000 });
        const psCpu = psOut.trim();
        if (psCpu && psCpu.length >= 4) {
          return psCpu.toUpperCase();
        }
      }
    } catch (err) {
      // Fallback
    }

    const cpus = os.cpus();
    const model = cpus.length > 0 ? cpus[0].model : 'UNKNOWN-CPU';
    return `CPU-${model.replace(/[^A-Z0-9]/gi, '').slice(0, 16).toUpperCase()}`;
  }

  /**
   * 3. Asosiy Tarmoq Kartasi (NIC) MAC Manzilini olish
   */
  static getPrimaryMacAddress() {
    try {
      const nics = os.networkInterfaces();
      for (const name of Object.keys(nics)) {
        const list = nics[name] || [];
        for (const net of list) {
          if (!net.internal && net.mac && net.mac !== '00:00:00:00:00:00') {
            return net.mac.toUpperCase();
          }
        }
      }
    } catch (err) {}

    return '00:00:00:00:00:00';
  }

  /**
   * 4. Barcha komponentlarni yig'ish va xom komponentlar obyektini qaytarish
   */
  static getRawComponents() {
    if (this._cachedRawComponents) return this._cachedRawComponents;

    const mbUuid = this.getMotherboardUuid();
    const cpuId = this.getCpuProcessorId();
    const mac = this.getPrimaryMacAddress();

    this._cachedRawComponents = {
      motherboardUuid: mbUuid,
      cpuProcessorId: cpuId,
      primaryMacAddress: mac,
      hostname: os.hostname(),
      platform: os.platform(),
      arch: os.arch()
    };

    return this._cachedRawComponents;
  }

  /**
   * 5. HMAC-SHA256 orqali unikal HardwareFingerprint (HWID) generatsiya qilish
   * Format: HWID-XXXX-XXXX-XXXX-XXXX
   */
  static getHardwareFingerprint() {
    if (this._cachedFingerprint) return this._cachedFingerprint;

    const raw = this.getRawComponents();
    const canonicalString = `MB=${raw.motherboardUuid}|CPU=${raw.cpuProcessorId}|MAC=${raw.primaryMacAddress}`;

    const hmac = crypto.createHmac('sha256', PRIVATE_SYSTEM_SALT);
    hmac.update(canonicalString);
    const hash = hmac.digest('hex').toUpperCase();

    // 16 belgili 4 blokli HWID
    const hwid = `HWID-${hash.slice(0, 4)}-${hash.slice(4, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}`;
    this._cachedFingerprint = hwid;

    return hwid;
  }

  /**
   * 6. Mavjud HWID ni berilgan HWID bilan solishtirish (Hardware Binding Tekshiruvi)
   */
  static verifyHardwareFingerprint(expectedHwid) {
    if (!expectedHwid || typeof expectedHwid !== 'string') return false;
    const currentHwid = this.getHardwareFingerprint();
    return currentHwid === expectedHwid.trim().toUpperCase();
  }
}
