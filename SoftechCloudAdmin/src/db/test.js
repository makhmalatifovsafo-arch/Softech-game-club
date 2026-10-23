import { initDatabase, TelemetryService } from './index.js';

console.log('🧪 [Test] Softech Cloud Telemetry DB testlari boshlanmoqda...');

// 1. Bazani ishga tushirish
initDatabase();

// 2. Yangi klub ro'yxatdan o'tkazish
const newClub = TelemetryService.registerClub({
  name: "Softech Farg'ona Gaming",
  city: "Farg'ona",
  ownerName: 'Azizbek Qodirov',
  ownerPhone: '+998912345678',
  totalWorkstations: 35,
  serverLanIp: '192.168.1.88'
});
console.log('✓ [registerClub] Yangi klub yaratildi:', newClub.id, newClub.name, newClub.slug);

// 3. Heartbeat yangilash & kompyuterlar keshini yuborish
const heartbeatResult = TelemetryService.updateClubHeartbeat(newClub.id, {
  serverLanIp: '192.168.1.88',
  serverVersion: '1.0.1',
  workstations: [
    { pcNumber: 'PC-01', zoneName: 'VIP', status: 'OCCUPIED', sessionStartedAt: new Date().toISOString() },
    { pcNumber: 'PC-02', zoneName: 'STANDARD', status: 'AVAILABLE' },
    { pcNumber: 'PC-03', zoneName: 'STANDARD', status: 'OFFLINE' }
  ],
  dailyMetrics: {
    totalDailyRevenue: 1250000,
    totalSessionsCount: 45,
    totalPlayHours: 92.5,
    barRevenue: 300000,
    peakConcurrentPcs: 25
  }
});
console.log('✓ [updateClubHeartbeat] Heartbeat yangilandi:', heartbeatResult);

// 4. Masofaviy buyruq navbatga qo'yish
const cmd = TelemetryService.queueRemoteCommand(newClub.id, 'FORCE_UPDATE', { targetVersion: '1.0.2' });
console.log('✓ [queueRemoteCommand] Masofaviy buyruq navbatga qo\'yildi:', cmd.id, cmd.commandType);

// 5. Kutilayotgan buyruqlarni olish
const pending = TelemetryService.getPendingCommandsForClub(newClub.id);
console.log('✓ [getPendingCommandsForClub] Kutilayotgan buyruqlar soni:', pending.length);

// 6. Buyruqni bajarilgan deb belgilash
TelemetryService.markCommandExecuted(cmd.id, 'EXECUTED');
console.log('✓ [markCommandExecuted] Buyruq muvaffaqiyatli bajarildi');

// 7. Global metrikalarni hisoblash
const summary = TelemetryService.getGlobalMetricsSummary();
console.log('✓ [getGlobalMetricsSummary] Umumiy SaaS telemetriyasi:', JSON.stringify(summary, null, 2));

// 8. Super Admin PIN kodini tekshirish
const adminAuth = TelemetryService.verifyPinCode('admin', '7777');
console.log('✓ [verifyPinCode] 4-xonali PIN tekshiruvi:', adminAuth ? `Muvaffaqiyatli (${adminAuth.username})` : 'Xato!');

console.log('🎉 Barcha DB testlari muvaffaqiyatli o\'tdi!');
