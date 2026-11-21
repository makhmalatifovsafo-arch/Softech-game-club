// Read-only presentation. Booking does not unlock or terminate a session.
export function reservationForComputer(db,pc,now=Date.now()) {
  if(db.prepare("SELECT 1 FROM sessions WHERE club_id=? AND computer_id=? AND status='ACTIVE'").get(pc.club_id,pc.id))return null;
  return db.prepare(`SELECT id,revision,start_time,end_time,no_show_at FROM bookings
    WHERE club_id=? AND computer_ref=? AND needs_review=0 AND session_id IS NULL
      AND status IN ('PENDING','CONFIRMED') AND julianday(start_time)<=julianday(?) AND julianday(no_show_at)>julianday(?)
    ORDER BY start_time,id LIMIT 1`).get(pc.club_id,pc.id,new Date(now).toISOString(),new Date(now).toISOString())||null;
}
export function sendReservationState(db,manager,pcId,now=Date.now()) {
  const pc=db.prepare('SELECT id,club_id,pc_number FROM computers WHERE id=?').get(pcId);
  if(!pc)return;
  const b=reservationForComputer(db,pc,now);
  manager.send(pc.id,'BOOKING_STATE',{pcNumber:pc.pc_number,serverNow:now,reserved:!!b,
    bookingId:b?.id||null,revision:b?.revision||0,startTime:b?.start_time||null,endTime:b?.end_time||null});
}
