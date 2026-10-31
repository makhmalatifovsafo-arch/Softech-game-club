import { monthlyFee, licenseStatus, validatePayment } from './cloudDashboardService.js';
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
  static calculateMonthlyFee(club) { return monthlyFee(club); }

  /**
   * 2. Litsenziya Statusini hisoblash (Yashil, Sariq, Qizil)
   * - Yashil: To'lov qilingan (30 kun bor)
   * - Sariq: To'lov muddati yaqinlashmoqda (3 kun qoldi)
   * - Qizil: Muddati o'tgan (Qarzdor)
   */
  static getLicenseStatus(club) { return licenseStatus(club); }

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
          type: feeInfo.tariffType,
          pricePerPc: Number(c.tariff_price_per_pc ?? 20000),
          fixedPrice: Number(c.tariff_fixed_price ?? 500000),
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
  static recordPayment(clubId,input) {
    const p=validatePayment({...input,clubId});
    if(!db.prepare('PRAGMA table_info(subscription_payments)').all().some(c=>c.name==='request_id'))db.exec('ALTER TABLE subscription_payments ADD COLUMN request_id TEXT');
    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS subscription_request_id ON subscription_payments(request_id)');
    db.exec('BEGIN IMMEDIATE');
    try {
      const club=db.prepare('SELECT * FROM clubs WHERE id=?').get(clubId);if(!club)throw new Error('Klub topilmadi.');
      let row=db.prepare('SELECT * FROM subscription_payments WHERE request_id=?').get(p.requestId);
      if(row){if(row.club_id!==p.clubId||row.amount!==p.amount||row.months_added!==p.months||row.payment_method!==p.method)throw new Error('Bu requestId boshqa to‘lov uchun ishlatilgan.');}
      else {
        const previous=club.license_expires_at || new Date().toISOString(),base=Math.max(Date.parse(previous)||0,Date.now()),expiry=new Date(base+p.months*30*86400000).toISOString();
        db.prepare('INSERT INTO subscription_payments (club_id,amount,payment_method,months_added,previous_expiry_date,new_expiry_date,notes,recorded_by,request_id) VALUES (?,?,?,?,?,?,?,?,?)').run(p.clubId,p.amount,p.method,p.months,previous,expiry,p.notes,input.recordedBy||'superadmin',p.requestId);
        db.prepare("UPDATE clubs SET license_expires_at=?,status='ACTIVE',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(expiry,p.clubId);
        row=db.prepare('SELECT * FROM subscription_payments WHERE request_id=?').get(p.requestId);
      }
      db.exec('COMMIT');return {success:true,paymentId:row.id,clubId:row.club_id,clubName:club.name,amount:row.amount,paymentMethod:row.payment_method,monthsAdded:row.months_added,previousExpiryDate:row.previous_expiry_date,newExpiryDate:row.new_expiry_date,status:'ACTIVE'};
    }catch(error){db.exec('ROLLBACK');throw error;}
  }

  /**
   * 6. Klub tarifini yangilash
   */
  static updateTariff(clubId, { tariffType, pricePerPc, fixedPrice }) {
    const club = db.prepare('SELECT id, name FROM clubs WHERE id = ?').get(clubId);
    if (!club) throw new Error('Filial topilmadi');

    const type = String(tariffType).toUpperCase();
    if (!['PER_PC','FIXED'].includes(type)) throw new Error('Tarif turi yaroqsiz.');
    const pcPrice = Number(pricePerPc);
    const fixPrice = Number(fixedPrice);
    if(![pcPrice,fixPrice].every(v=>Number.isFinite(v)&&v>=0&&v<=1e12))throw new Error('Tarif narxi yaroqsiz.');

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
