export function initAnnouncements(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS cloud_announcements(
    club_id INTEGER NOT NULL, id INTEGER NOT NULL, title TEXT NOT NULL, message TEXT NOT NULL,
    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, dismissed_at TEXT,
    PRIMARY KEY(club_id,id))`);
}
export function pendingAnnouncements(db, clubId) {
  initAnnouncements(db);
  return db.prepare('SELECT id,title,message,received_at AS receivedAt FROM cloud_announcements WHERE club_id=? AND dismissed_at IS NULL ORDER BY id LIMIT 100').all(clubId);
}
export function dismissAnnouncement(db, clubId, id) {
  initAnnouncements(db);
  return db.prepare('UPDATE cloud_announcements SET dismissed_at=COALESCE(dismissed_at,CURRENT_TIMESTAMP) WHERE club_id=? AND id=?').run(clubId,id).changes>0;
}
