import {db} from '../db/connection.js';
import {mergeFinancialReports,localFinancialReports,platformAnalytics} from './financialTelemetry.js';
export class AnalyticsService {
  static getPlatformAnalytics(days=30) {
    days=Math.max(1,Math.min(365,Number.parseInt(days,10)||30));
    const start=new Date(Date.now()-days*86400000).toISOString().slice(0,10);
    const metrics=db.prepare('SELECT * FROM club_metrics WHERE record_date>=?').all(start);
    return platformAnalytics(db.prepare('SELECT * FROM clubs').all(),mergeFinancialReports(metrics,localFinancialReports(db,start)),days);
  }
}
