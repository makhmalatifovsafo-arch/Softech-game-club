import { parentPort, workerData } from 'node:worker_threads';
import { DatabaseSync } from 'node:sqlite';
import { buildServerAnalytics } from './analyticsService.js';

// Never import db.js here: reporting must not run migrations or create a database.
let db;
try {
  db = new DatabaseSync(workerData.databasePath, { readOnly:true });
  db.exec('PRAGMA query_only=ON; PRAGMA busy_timeout=2000; BEGIN;');
  const generatedAt=new Date().toISOString();
  const report=buildServerAnalytics(db,{...workerData.options,now:new Date(generatedAt)});
  db.exec('COMMIT');
  parentPort.postMessage({report,generatedAt});
} catch(error) {
  parentPort.postMessage({error:error.message});
} finally { db?.close(); }
