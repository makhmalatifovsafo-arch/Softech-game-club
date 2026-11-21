import {initializeBookingFunds} from './bookingFunds.js';
// Called by db.js inside the backed-up startup migration transaction (FKs off).
// No database is opened here, so migration fixtures can use an isolated DB.
const additions = {
  computer_ref: 'TEXT',
  grace_minutes: 'INTEGER NOT NULL DEFAULT 10 CHECK(grace_minutes BETWEEN 0 AND 180)',
  no_show_at: 'TEXT',
  session_id: 'TEXT',
  revision: 'INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0)',
  needs_review: 'INTEGER NOT NULL DEFAULT 0 CHECK(needs_review IN (0,1))',
  review_reason: 'TEXT',
  cancelled_at: 'TEXT',
  cancellation_reason: 'TEXT',
  booking_version: 'INTEGER NOT NULL DEFAULT 1',
  payment_kind: "TEXT NOT NULL DEFAULT 'NONE' CHECK(payment_kind IN ('NONE','CASH','BALANCE'))"
};
const states = "CHECK(status IN ('PENDING','CONFIRMED','ACTIVE','CANCELLED','COMPLETED','NO_SHOW'))";
const quoteIdentifier = name => '"' + name.replaceAll('"', '""') + '"';

export function initializeBookings(db) {
  db.exec('SAVEPOINT booking_schema');
  try {
    db.exec('CREATE TABLE IF NOT EXISTS booking_schema_versions(version INTEGER PRIMARY KEY)');
    if (!db.prepare('SELECT 1 FROM booking_schema_versions WHERE version=1').get()) {
      const table = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bookings'").get();
      if (!table) throw Error('Bron jadvali mavjud emas; asosiy sxema avval yaratilishi kerak.');
      // Preserve the actual schema, including extra legacy columns and constraints.
      // Do not rename the old table: that would rewrite dependent FK references.
      if (!table.sql.includes("'NO_SHOW'")) {
        if (db.prepare('PRAGMA foreign_keys').get().foreign_keys)
          throw Error('Bron migratsiyasi startup tranzaksiyasida foreign_keys=OFF bilan bajarilishi kerak.');
        const dependent = db.prepare("SELECT sql FROM sqlite_master WHERE tbl_name='bookings' AND type IN ('index','trigger') AND sql IS NOT NULL").all();
        const cols = db.prepare('PRAGMA table_info(bookings)').all().map(c => quoteIdentifier(c.name)).join(',');
        let sql = table.sql.replace(/^CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"bookings"|`bookings`|\[bookings\]|bookings)/i, 'CREATE TABLE bookings_upgrade');
        const statusCheck = /CHECK\s*\(\s*status\s+IN\s*\([^)]*\)\s*\)/i;
        if (statusCheck.test(sql)) sql = sql.replace(statusCheck, states);
        else sql = sql.replace(/\)\s*$/, ',' + states + ')');
        if (!sql.startsWith('CREATE TABLE bookings_upgrade')) throw Error('Bron jadvali sxemasi tanilmadi.');
        const count = db.prepare('SELECT count(*) AS n FROM bookings').get().n;
        const sequence = db.prepare("SELECT seq FROM sqlite_sequence WHERE name='bookings'").get()?.seq;
        db.exec(sql);
        db.exec(`INSERT INTO bookings_upgrade (${cols}) SELECT ${cols} FROM bookings`);
        if (db.prepare('SELECT count(*) AS n FROM bookings_upgrade').get().n !== count) throw Error('Bron tarixini ko‘chirish tekshiruvi o‘tmadi.');
        db.exec('DROP TABLE bookings; ALTER TABLE bookings_upgrade RENAME TO bookings');
        if (sequence !== undefined) db.prepare("UPDATE sqlite_sequence SET seq=max(seq,?) WHERE name='bookings'").run(sequence);
        for (const item of dependent) db.exec(item.sql);
      }
      const cols = new Set(db.prepare('PRAGMA table_info(bookings)').all().map(c => c.name));
      for (const [name, definition] of Object.entries(additions))
        if (!cols.has(name)) db.exec(`ALTER TABLE bookings ADD COLUMN ${name} ${definition}`);

      // Legacy computer_id is pc_number, not computers.id. Never use an OR alias join.
      const lookup = db.prepare('SELECT id FROM computers WHERE club_id=? AND pc_number=? AND pc_number>0');
      const update = db.prepare('UPDATE bookings SET computer_ref=?, no_show_at=?, needs_review=?, review_reason=? WHERE id=?');
      for (const row of db.prepare('SELECT * FROM bookings').all()) {
        const pcs = lookup.all(row.club_id, row.computer_id);
        const start = Date.parse(row.start_time), end = Date.parse(row.end_time);
        const validTime = Number.isFinite(start) && Number.isFinite(end) && end > start;
        const issues = [];
        if (pcs.length !== 1) issues.push('PC_REFERENCE');
        if (!validTime) issues.push('TIME_INTERVAL');
        if (row.status === 'ACTIVE' && !row.session_id) issues.push('SESSION_LINK');
        update.run(pcs.length === 1 ? pcs[0].id : null,
          validTime ? new Date(Math.min(end, start + row.grace_minutes * 60000)).toISOString() : null,
          issues.length ? 1 : 0, issues.join(',') || null, row.id);
      }
      db.exec('INSERT INTO booking_schema_versions(version) VALUES(1)');
    }
    db.exec(`CREATE INDEX IF NOT EXISTS idx_bookings_reservation ON bookings(club_id,computer_ref,status,start_time,end_time);
      CREATE INDEX IF NOT EXISTS idx_bookings_no_show ON bookings(club_id,status,no_show_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_session ON bookings(club_id,session_id) WHERE session_id IS NOT NULL;
      CREATE TABLE IF NOT EXISTS booking_settings(
        club_id INTEGER PRIMARY KEY REFERENCES clubs(id),
        grace_minutes INTEGER NOT NULL DEFAULT 10 CHECK(grace_minutes BETWEEN 0 AND 180),
        revision INTEGER NOT NULL DEFAULT 1 CHECK(revision>0)
      );
      CREATE TRIGGER IF NOT EXISTS prevent_booking_v2_delete BEFORE DELETE ON bookings
      WHEN OLD.booking_version>=2 BEGIN SELECT RAISE(ABORT,'Bron tarixini o‘chirish taqiqlangan.'); END;`);
    db.exec(`CREATE TRIGGER IF NOT EXISTS booking_session_completed AFTER UPDATE OF status ON sessions
      WHEN OLD.status='ACTIVE' AND NEW.status<>'ACTIVE'
      BEGIN
        INSERT INTO audit_logs(club_id,actor_username,category,action_type,details,created_at)
          SELECT club_id,'Tizim','SESSION','BOOKING_COMPLETED',
            json_object('bookingId',id,'sessionId',NEW.id,'computerId',NEW.computer_id),
            strftime('%Y-%m-%dT%H:%M:%fZ','now') FROM bookings
          WHERE club_id=NEW.club_id AND session_id=NEW.id AND status='ACTIVE';
        UPDATE bookings SET status='COMPLETED',revision=revision+1
          WHERE club_id=NEW.club_id AND session_id=NEW.id AND status='ACTIVE';
      END;
      CREATE TRIGGER IF NOT EXISTS booking_protect_pc BEFORE DELETE ON computers
      WHEN EXISTS(SELECT 1 FROM bookings WHERE club_id=OLD.club_id
        AND (computer_ref=OLD.id OR (computer_ref IS NULL AND computer_id=OLD.pc_number))
        AND status IN ('PENDING','CONFIRMED'))
      BEGIN SELECT RAISE(ABORT,'PCda bron mavjud. Avval bronni bekor qiling.'); END;`);
    if (!db.prepare('PRAGMA table_info(booking_settings)').all().some(c => c.name === 'creation_enabled'))
      db.exec('ALTER TABLE booking_settings ADD COLUMN creation_enabled INTEGER NOT NULL DEFAULT 1 CHECK(creation_enabled IN (0,1))');
    if (!db.prepare('PRAGMA table_info(bookings)').all().some(c => c.name === 'group_id'))
      db.exec('ALTER TABLE bookings ADD COLUMN group_id TEXT');
    db.exec('CREATE INDEX IF NOT EXISTS idx_bookings_group ON bookings(club_id,group_id,id)');
    initializeBookingFunds(db);
    db.exec('RELEASE booking_schema');
  } catch (error) {
    db.exec('ROLLBACK TO booking_schema; RELEASE booking_schema');
    throw error;
  }
}
