/**
 * Softech Super Admin — SaaS Subscription & Billing Service
 * Location: SoftechCloudAdmin/src/services/billingService.js
 * 
 * Manages recurring SaaS payments, tariffs, licenses status, and payment transactions.
 */

import { db } from '../db/connection.js';
import { TelemetryService } from '../db/telemetryService.js';

export class BillingService {
  /**
   * 1. Klubning oylik obuna to'lovini hisoblash
   * - PER_PC: Har bir kompyuter uchun (masalan: 20 ta PC * 20 000 = 400 000 UZS/oy)
   * - FIXED: Qat'iy oylik obuna (masalan: 500 000 UZS/oy)
   */
  static calculateMonthlyFee(club) {
    const totalPcs = Math.max(0, parseInt(club.total_workstations, 10) || 0);
    const tariffType = (club.tariff_type || 'PER_PC').toUpperCase();
    const pricePerPc = parseFloat(club.tariff_price_per_pc) || 20000;
    const fixedPrice = parseFloat(club.tariff_fixed_price) || 500000;

    if (tariffType === 'FIXED') {
      return {
        tariffType: 'FIXED',
        monthlyFee: fixedPrice,
        description: `Qat'iy oylik obuna: ${fixedPrice.toLocaleString()} UZS / oy`
      };
    }

    const calculated = totalPcs * pricePerPc;
    return {
      tariffType: 'PER_PC',
      pricePerPc,
      totalPcs,
      monthlyFee: calculated,
      description: `${totalPcs} PC × ${pricePerPc.toLocaleString()} UZS = ${calculated.toLocaleString()} UZS / oy`
    };
  }

  /**
   * 2. Litsenziya Statusini hisoblash (Yashil, Sariq, Qizil)
   * - Yashil: To'lov qilingan (30 kun bor)
   * - Sariq: To'lov muddati yaqinlashmoqda (3 kun qoldi)
   * - Qizil: Muddati o'tgan (Qarzdor)
   */
  static getLicenseStatus(club) {
    if (!club.license_expires_at) {
      return {
        code: 'RED',
        daysLeft: 0,
        label: "Muddati o'tgan (Qarzdor)",
        badgeClass: 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
      };
    }

    const expiresMs = new Date(club.license_expires_at).getTime();
    const now = Date.now();
    const diffMs = expiresMs - now;
    const daysLeft = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (daysLeft <= 0 || club.status === 'SUSPENDED_PAYMENT') {
      return {
        code: 'RED',
        daysLeft: Math.min(0, daysLeft),
        label: "Muddati o'tgan (Qarzdor)",
        badgeClass: 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
      };
    }

    if (daysLeft <= 3) {
      return {
        code: 'YELLOW',
        daysLeft,
        label: `To'lov yaqinlashmoqda (${daysLeft} kun qoldi)`,
        badgeClass: 'bg-amber-500/20 text-amber-400 border border-amber-500/30',
        warningNotice: "Tizim klub egasiga avtomatik ogohlantirish chiqaradi"
      };
    }

    return {
      code: 'GREEN',
      daysLeft,
      label: `To'lov qilingan (${daysLeft} kun bor)`,
      badgeClass: 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
    };
  }

  /**
   * 3. Barcha klublar bo'yicha Billing umumiy xulosasi (Cockpit KPI)
   */
  static getBillingSummary() {
    const clubs = db.prepare('SELECT * FROM clubs ORDER BY id ASC').all();

    let totalMrr = 0; // Monthly Recurring Revenue
    let greenCount = 0;
    let yellowCount = 0;
    let redCount = 0;

    for (const c of clubs) {
      const feeInfo = this.calculateMonthlyFee(c);
      totalMrr += feeInfo.monthlyFee;

      const licStatus = this.getLicenseStatus(c);
      if (licStatus.code === 'GREEN') greenCount++;
      else if (licStatus.code === 'YELLOW') yellowCount++;
      else redCount++;
    }

    // Joriy oyda qabul qilingan jami to'lovlar summasi
    const currentMonth = new Date().toISOString().slice(0, 7); // YYYY-MM
    const currentMonthPayments = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_collected, COUNT(*) as count
      FROM subscription_payments
      WHERE strftime('%Y-%m', created_at) = ?
    `).get(currentMonth);

    // So'nggi 10 ta to'lov tranzaksiyasi
    const recentPayments = db.prepare(`
      SELECT p.*, c.name as club_name, c.city as club_city
      FROM subscription_payments p
      JOIN clubs c ON c.id = p.club_id
      ORDER BY p.id DESC
      LIMIT 10
    `).all();

    return {
      totalClubs: clubs.length,
      mrr: totalMrr, // Oylik obuna prognozi
      currentMonthCollected: Number(currentMonthPayments?.total_collected || 0),
      currentMonthPaymentsCount: Number(currentMonthPayments?.count || 0),
      statusCounts: {
        green: greenCount,
        yellow: yellowCount,
        red: redCount
      },
      recentPayments
    };
  }

  /**
   * 4. Barcha filiallar obunalari ro'yxati
   */
  static getAllClubsWithBilling() {
    const clubs = db.prepare('SELECT * FROM clubs ORDER BY id ASC').all();

    return clubs.map(c => {
      const feeInfo = this.calculateMonthlyFee(c);
      const licStatus = this.getLicenseStatus(c);

      // Oxirgi to'lov
      const lastPayment = db.prepare(`
        SELECT amount, payment_method, created_at, new_expiry_date
        FROM subscription_payments
        WHERE club_id = ?
        ORDER BY id DESC
        LIMIT 1
      `).get(c.id);

      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        ownerName: c.owner_name,
        ownerPhone: c.owner_phone,
        city: c.city,
        status: c.status,
        totalWorkstations: c.total_workstations,
        licenseExpiresAt: c.license_expires_at,
        tariff: {
          type: c.tariff_type || 'PER_PC',
          pricePerPc: Number(c.tariff_price_per_pc) || 20000,
          fixedPrice: Number(c.tariff_fixed_price) || 500000,
          monthlyFee: feeInfo.monthlyFee,
          description: feeInfo.description
        },
        licenseStatus: licStatus,
        lastPayment: lastPayment ? {
          amount: Number(lastPayment.amount),
          method: lastPayment.payment_method,
          date: lastPayment.created_at
        } : null
      };
    });
  }

  /**
   * 5. TO'LOV QABUL QILISH (Record Subscription Payment & Extend License)
   * - Summa, to'lov turi (Naqd, Click, Payme, Bank o'tkazmasi)
   * - Muddati (+1 oyga yoki ko'rsatilgan oylarga uzaytirish)
   * - Agar qulflangan bo'lsa darhol ACTIVE ga o'tkazadi va UNLOCK buyrug'ini yuboradi
   */
  static recordPayment(clubId, {
    amount,
    paymentMethod = 'CLICK',
    monthsAdded = 1,
    notes = '',
    recordedBy = 'superadmin'
  }) {
    const club = db.prepare('SELECT * FROM clubs WHERE id = ?').get(clubId);
    if (!club) {
      throw new Error(`Filial topilmadi (ID: ${clubId})`);
    }

    const payAmount = parseFloat(amount);
    if (!payAmount || payAmount <= 0) {
      throw new Error("To'lov summasi 0 dan katta bo'lishi shart.");
    }

    const validMethods = ['CASH', 'CLICK', 'PAYME', 'BANK_TRANSFER'];
    const method = String(paymentMethod).toUpperCase();
    if (!validMethods.includes(method)) {
      throw new Error(`Noto'g'ri to'lov turi: ${paymentMethod}`);
    }

    const months = Math.max(1, parseInt(monthsAdded || 1, 10));

    // Yangi litsenziya muddatini hisoblash
    const previousExpiryIso = club.license_expires_at || new Date().toISOString();
    const prevTime = new Date(previousExpiryIso).getTime();
    const baseTime = prevTime > Date.now() ? prevTime : Date.now();
    const addedDays = months * 30;
    const newExpiryDateIso = new Date(baseTime + addedDays * 24 * 3600 * 1000).toISOString();

    // 1. clubs jadvalida litsenziyani uzaytirish va holatni ACTIVE qilish
    db.prepare(`
      UPDATE clubs
      SET license_expires_at = ?,
          status = 'ACTIVE',
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(newExpiryDateIso, clubId);

    // 2. Tranzaksiyani subscription_payments jadvaliga yozish
    const insertPayment = db.prepare(`
      INSERT INTO subscription_payments (
        club_id, amount, payment_method, months_added,
        previous_expiry_date, new_expiry_date, notes, recorded_by
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const result = insertPayment.run(
      clubId,
      payAmount,
      method,
      months,
      previousExpiryIso,
      newExpiryDateIso,
      notes || `SaaS obunasi +${months} oyga uzaytirildi`,
      recordedBy
    );

    const paymentId = Number(result.lastInsertRowid);

    // 3. Filial serveriga avtomatik UNLOCK_CLUB_LICENSE buyrug'ini navbatga qo'yish
    TelemetryService.queueRemoteCommand(clubId, 'UNLOCK_CLUB_LICENSE', {
      lockScreen: false,
      newStatus: 'ACTIVE',
      licenseExpiresAt: newExpiryDateIso,
      paymentId,
      message: `Obuna to'lovi qabul qilindi. Litsenziya +${months} oyga uzaytirildi.`,
      timestamp: Date.now()
    });

    return {
      success: true,
      paymentId,
      clubId,
      clubName: club.name,
      amount: payAmount,
      paymentMethod: method,
      monthsAdded: months,
      previousExpiryDate: previousExpiryIso,
      newExpiryDate: newExpiryDateIso,
      status: 'ACTIVE',
      message: `${club.name} uchun ${payAmount.toLocaleString()} UZS to'lov qabul qilindi. Litsenziya ${newExpiryDateIso.slice(0, 10)} gacha uzaytirildi.`
    };
  }

  /**
   * 6. Klub tarifini yangilash
   */
  static updateTariff(clubId, { tariffType, pricePerPc, fixedPrice }) {
    const club = db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(clubId);
    if (!club) throw new Error('Filial topilmadi');

    const type = ['PER_PC', 'FIXED'].includes(String(tariffType).toUpperCase()) ? String(tariffType).toUpperCase() : 'PER_PC';
    const pcPrice = parseFloat(pricePerPc) || 20000;
    const fixPrice = parseFloat(fixedPrice) || 500000;

    db.prepare(`
      UPDATE clubs
      SET tariff_type = ?,
          tariff_price_per_pc = ?,
          tariff_fixed_price = ?,
          updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(type, pcPrice, fixPrice, clubId);

    return {
      success: true,
      clubId,
      tariffType: type,
      pricePerPc: pcPrice,
      fixedPrice: fixPrice
    };
  }
}
