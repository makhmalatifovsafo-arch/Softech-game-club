import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ownFile = fileURLToPath(import.meta.url);
export const backupDirectory = database => path.join(path.dirname(database), 'data', 'backups');
const markerPath = database => path.join(path.dirname(database), 'data', 'database-created.json');
const owned = /^(startup|hourly|daily|setup)-\d{13}-[a-f0-9-]{36}\.db$/;

export function guardDatabase(database) {
  if ((!fs.existsSync(database) || fs.statSync(database).size === 0) && (fs.existsSync(markerPath(database)) ||
      fs.existsSync(database + '-wal') || fs.existsSync(database + '-shm') ||
      (fs.existsSync(backupDirectory(database)) && fs.readdirSync(backupDirectory(database)).some(n => owned.test(n)))))
    throw Error('Asosiy baza topilmadi. Bo‘sh baza yaratilmaydi. data/backups zaxiralaridan tiklash kerak.');
}

export function markDatabase(database) {
  const marker = markerPath(database);
  fs.mkdirSync(path.dirname(marker), { recursive: true });
  if (!fs.existsSync(marker)) fs.writeFileSync(marker, JSON.stringify({ database: path.basename(database), createdAt: new Date().toISOString() }), { flag: 'wx' });
}

export function verifyDatabase(database) {
  const check = new DatabaseSync(database, { readOnly: true });
  try {
    if (check.prepare('PRAGMA quick_check').all().some(r => Object.values(r)[0] !== 'ok'))
      throw Error('Baza yaxlitligi tekshiruvidan o‘tmadi: ' + database);
  } finally { check.close(); }
}

export function snapshot(database, kind = 'hourly') {
  if (!['startup', 'hourly', 'daily', 'setup'].includes(kind)) throw Error('Invalid backup kind');
  verifyDatabase(database);
  const directory = backupDirectory(database);
  fs.mkdirSync(directory, { recursive: true });
  const destination = path.join(directory, `${kind}-${Date.now()}-${crypto.randomUUID()}.db`);
  const partial = destination + '.partial';
  const source = new DatabaseSync(database, { readOnly: true });
  try {
    source.exec('PRAGMA busy_timeout=10000; PRAGMA synchronous=FULL;');
    source.prepare('VACUUM INTO ?').run(partial);
    verifyDatabase(partial);
    const fd = fs.openSync(partial, 'r+');
    try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    fs.renameSync(partial, destination);
  } finally {
    source.close();
    if (fs.existsSync(partial)) fs.unlinkSync(partial);
  }
  return destination;
}

// Prune only verified generated snapshots, after another snapshot was completed.
export function pruneBackups(database) {
  const directory = backupDirectory(database);
  if (!fs.existsSync(directory)) return;
  for (const [kind, keep] of Object.entries({ startup: 3, hourly: 4, daily: 7, setup: 3 })) {
    const files = fs.readdirSync(directory).filter(n => owned.test(n) && n.startsWith(kind + '-')).sort().reverse();
    if (files.length <= keep) continue;
    verifyDatabase(path.join(directory, files[0]));
    for (const name of files.slice(keep)) {
      const file = path.join(directory, name);
      if (fs.lstatSync(file).isFile() && !fs.lstatSync(file).isSymbolicLink()) fs.unlinkSync(file);
    }
  }
}

export function startDatabaseBackups(database) {
  let child;
  const run = () => {
    if (child) return;
    child = spawn(process.execPath, [ownFile, '--scheduled', database], { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    child.stderr.on('data', chunk => console.warn('[Database backup]', chunk.toString().trim()));
    child.on('error', error => { console.error('[Database backup]', error.message); child = null; });
    child.on('exit', code => { if (code) console.error('[Database backup] Zaxira olinmadi; oldingi nusxalar saqlandi.'); child = null; });
  };
  run();
  const timer = setInterval(run, 60 * 60 * 1000); timer.unref();
  return () => clearInterval(timer);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const [action, database, output] = process.argv.slice(2);
    if (action === '--verify') { verifyDatabase(database); console.log('Backup OK'); }
    else if (action === '--recover-copy') {
      // Never overwrite a live database: recovery first produces a separate, reviewable file.
      if (!output || fs.existsSync(output)) throw Error('Tiklash uchun yangi, mavjud bo‘lmagan fayl yo‘lini kiriting.');
      verifyDatabase(database);
      fs.copyFileSync(database, output, fs.constants.COPYFILE_EXCL);
      verifyDatabase(output); console.log('Recovered copy: ' + output);
    } else if (action === '--scheduled') {
      snapshot(database, 'hourly');
      const today = new Date().toISOString().slice(0, 10);
      const dailyExists = fs.readdirSync(backupDirectory(database)).some(n => owned.test(n) && n.startsWith('daily-') && new Date(Number(n.split('-')[1])).toISOString().slice(0, 10) === today);
      if (!dailyExists) snapshot(database, 'daily');
      pruneBackups(database);
    } else throw Error('Use --verify FILE, --recover-copy BACKUP NEW_FILE, or --scheduled DATABASE');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
