import {bookingError} from './bookingAvailability.js';

// Bounded operational listing. Historical records remain stored and can be
// reached by date and page; the kiosk never loads the entire booking ledger.
export function listBookingRows(db,clubId,params,now=new Date()) {
  const localDay=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const day=params.get('date')||localDay(now),start=new Date(day+'T00:00:00');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!Number.isFinite(+start)||localDay(start)!==day)throw bookingError('Sanani to‘g‘ri kiriting.');
  const end=new Date(start);end.setDate(end.getDate()+1);
  const offset=Number(params.get('offset')||0),limit=100;
  if(!Number.isSafeInteger(offset)||offset<0)throw bookingError('Sahifa noto‘g‘ri.');
  const where=[],args=[];
  if(clubId!==null){where.push('b.club_id=?');args.push(clubId);}
  if(params.has('bookingId')){const id=Number(params.get('bookingId'));if(!Number.isSafeInteger(id)||id<=0)throw bookingError('Bron raqami noto‘g‘ri.');where.push('b.id=?');args.push(id);}
  else if(params.get('refunds')==='1')where.push(`EXISTS(SELECT 1 FROM booking_funds f WHERE f.club_id=b.club_id AND f.booking_id=b.id AND f.channel='CASH'
    GROUP BY f.booking_id HAVING sum(CASE WHEN f.kind='CAPTURE' THEN f.amount ELSE -f.amount END)>0)
    AND (b.session_id IS NOT NULL OR b.status IN ('CANCELLED','NO_SHOW'))`);
  else {where.push('julianday(b.start_time)<julianday(?) AND julianday(b.end_time)>julianday(?)');args.push(end.toISOString(),start.toISOString());}
  if(params.get('computer')){where.push('b.computer_ref=?');args.push(params.get('computer'));}
  const filter=where.join(' AND '),total=db.prepare('SELECT count(*) n FROM bookings b WHERE '+filter).get(...args).n;
  const rows=db.prepare(`SELECT b.*,c.name computer_name,c.pc_number FROM bookings b
    LEFT JOIN computers c ON c.id=b.computer_ref AND c.club_id=b.club_id WHERE ${filter}
    ORDER BY b.start_time,b.id LIMIT ? OFFSET ?`).all(...args,limit,offset);
  return {rows,page:{date:day,offset,limit,total,hasMore:offset+rows.length<total}};
}
