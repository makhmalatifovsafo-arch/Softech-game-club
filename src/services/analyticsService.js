import { db } from '../db/connection.js';

/**
 * AnalyticsService — Global Platform Analytics & Trend Intelligence
 */
export class AnalyticsService {
  // Analytics reads recorded telemetry; opening a page must never invent clubs or sales.
  static getPlatformAnalytics(days = 30) {

    const daysCount = parseInt(days, 10) || 30;
    const now = new Date();
    const startDate = new Date(now.getTime() - daysCount * 24 * 3600 * 1000).toISOString().slice(0, 10);

    // 1. Oxirgi N kunlik umumiy daromad va o'sish egri chizig'i (Line Chart)
    const dailyRaw = db.prepare(`
      SELECT 
        record_date,
        SUM(total_daily_revenue) as total_revenue,
        SUM(bar_revenue) as bar_revenue,
        SUM(total_sessions_count) as total_sessions,
        SUM(total_play_hours) as total_play_hours,
        MAX(peak_concurrent_pcs) as peak_pcs
      FROM club_metrics
      WHERE record_date >= ?
      GROUP BY record_date
      ORDER BY record_date ASC
    `).all(startDate);

    let cumulativeRevenue = 0;
    const monthNamesUz = ['yan', 'fev', 'mar', 'apr', 'may', 'iyn', 'iyl', 'avg', 'sen', 'okt', 'noy', 'dek'];
    const daysUz = ['Yak', 'Dush', 'Sesh', 'Chor', 'Pay', 'Jum', 'Shan'];

    const dynamicRevenue = dailyRaw.map(r => {
      const d = new Date(r.record_date);
      const totalRev = Number(r.total_revenue) || 0;
      const barRev = Number(r.bar_revenue) || 0;
      const sessionsRev = Math.max(0, totalRev - barRev);
      cumulativeRevenue += totalRev;

      const dayNumber = d.getDate();
      const monthName = monthNamesUz[d.getMonth()] || '';
      const dayOfWeek = daysUz[d.getDay()];

      return {
        date: r.record_date,
        formattedDate: `${dayNumber}-${monthName}`,
        dayOfWeek,
        totalRevenue: totalRev,
        barRevenue: barRev,
        sessionsRevenue: sessionsRev,
        cumulativeRevenue,
        sessionsCount: Number(r.total_sessions) || 0,
        playHours: Number(r.total_play_hours) || 0
      };
    });

    // 2. Top Klublar Reytingi (Horizontal Bar Chart)
    const topClubsRaw = db.prepare(`
      SELECT 
        c.id,
        c.name,
        c.city,
        c.total_workstations,
        c.status,
        c.server_version,
        SUM(m.total_daily_revenue) as period_revenue,
        SUM(m.bar_revenue) as period_bar_revenue,
        AVG(m.peak_concurrent_pcs) as avg_peak_pcs
      FROM clubs c
      LEFT JOIN club_metrics m ON c.id = m.club_id AND m.record_date >= ?
      GROUP BY c.id
      ORDER BY period_revenue DESC
      LIMIT 5
    `).all(startDate);

    const topClubs = topClubsRaw.map((c, index) => {
      const workstations = Math.max(1, Number(c.total_workstations) || 20);
      const avgPeak = Number(c.avg_peak_pcs) || 0;
      const occupancyRate = Math.min(100, Math.round((avgPeak / workstations) * 100));

      return {
        rank: index + 1,
        id: c.id,
        name: c.name,
        city: c.city || 'Toshkent',
        workstations,
        totalRevenue: Number(c.period_revenue) || 0,
        barRevenue: Number(c.period_bar_revenue) || 0,
        occupancyRate,
        status: c.status
      };
    });

    // Hourly telemetry is not collected yet. Do not fabricate a distribution.
    const hourlyDistribution = [];

    // 4. KPI Xulosa Ko'rsatkichlari
    const totalPlatformPeriodRevenue = dynamicRevenue.reduce((acc, curr) => acc + curr.totalRevenue, 0);
    const avgDailyRevenue = dynamicRevenue.length > 0 ? Math.round(totalPlatformPeriodRevenue / dynamicRevenue.length) : 0;
    const totalSessions = dynamicRevenue.reduce((acc, curr) => acc + curr.sessionsCount, 0);
    const totalPlayHours = dynamicRevenue.reduce((acc, curr) => acc + curr.playHours, 0);

    return {
      success: true,
      timeframeDays: daysCount,
      summary: {
        totalRevenue: totalPlatformPeriodRevenue,
        avgDailyRevenue,
        totalSessions,
        totalPlayHours,
        topClub: topClubs[0] ? topClubs[0].name : 'Noma\'lum',
        topCity: null,
        peakHour: 'Ma‘lumot yo‘q'
      },
      dynamicRevenue,
      topClubs,
      hourlyPeakOccupancy: hourlyDistribution
    };
  }
}
