import crypto from 'node:crypto';

const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });

export function initializeMoneyOperations(db) {
  // Keep receipts with the financial records. Expiring a receipt would allow an
  // old request to add money again. This migration does not alter existing rows.
  db.exec(`CREATE TABLE IF NOT EXISTS money_operation_receipts (
    club_id INTEGER NOT NULL, operation TEXT NOT NULL, request_id TEXT NOT NULL,
    actor_id TEXT NOT NULL, fingerprint TEXT NOT NULL,
    status_code INTEGER NOT NULL, response_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (club_id, operation, request_id)
  )`);
}

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(
    Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])
  );
  return value;
}

export function runMoneyOperation(db, { clubId, actorId, operation, requestId, payload }, write) {
  // Older installed/mobile clients can still use their existing protocol.
  // Updated cashiers always send an ID, retained until an acknowledged result.
  const keyed = requestId !== undefined && requestId !== null;
  if (keyed && (typeof requestId !== 'string' || !/^[a-zA-Z0-9_-]{8,100}$/.test(requestId)))
    throw fail('To‘lov amalining raqami noto‘g‘ri.', 400);
  const fingerprint = crypto.createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
  db.exec('BEGIN IMMEDIATE');
  let startedNewWrite = false;
  try {
    if (keyed) {
      const saved = db.prepare('SELECT * FROM money_operation_receipts WHERE club_id=? AND operation=? AND request_id=?')
        .get(clubId, operation, requestId);
      if (saved) {
        if (saved.actor_id !== String(actorId) || saved.fingerprint !== fingerprint)
          throw fail('Bu amal raqami boshqa to‘lovga tegishli. Oldingi amalni tekshiring.');
        const result = { status: saved.status_code, body: JSON.parse(saved.response_json), replayed: true };
        db.exec('COMMIT');
        return result;
      }
    }
    startedNewWrite = true;
    const result = write();
    if (keyed) {
      result.body = { ...result.body, requestId };
      db.prepare(`INSERT INTO money_operation_receipts
        (club_id,operation,request_id,actor_id,fingerprint,status_code,response_json) VALUES(?,?,?,?,?,?,?)`)
        .run(clubId, operation, requestId, String(actorId), fingerprint, result.status, JSON.stringify(result.body));
    }
    // The money, stock and receipt commit together, before any network response.
    db.exec('COMMIT');
    return { ...result, replayed: false };
  } catch (error) {
    let rolledBack = false;
    try { db.exec('ROLLBACK'); rolledBack = true; } catch {}
    // A read/parse failure may concern an already committed receipt. Only an
    // acknowledged rollback of a NEW write permits the UI to discard its ID.
    if (startedNewWrite && rolledBack && error.statusCode !== 409) error.operationNotApplied = true;
    throw error;
  }
}
