import { retainedSessionPayments, receiptCategory, paymentMethod } from './netSessionReceipts.js';

export function initializeTransferHistory(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS session_transfer_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT, club_id INTEGER NOT NULL, session_id TEXT NOT NULL,
    transferred_at TEXT NOT NULL, game_amount REAL NOT NULL,
    from_id TEXT NOT NULL, from_name TEXT NOT NULL, from_number INTEGER, from_zone TEXT,
    to_id TEXT NOT NULL, to_name TEXT NOT NULL, to_number INTEGER, to_zone TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_session_transfer_history ON session_transfer_history(club_id,session_id,id);
  CREATE INDEX IF NOT EXISTS idx_client_transactions_session_history ON client_transactions(club_id,session_id);`);
}

// Called INSIDE the existing transfer transaction. No payments are generated.
export function recordSessionTransfer(db, { session, from, to, now, gameAmount }) {
  if (!Number.isFinite(gameAmount) || gameAmount < 0) throw Error('Ko‘chirish summasini saqlab bo‘lmadi.');
  db.prepare(`INSERT INTO session_transfer_history
    (club_id,session_id,transferred_at,game_amount,from_id,from_name,from_number,from_zone,to_id,to_name,to_number,to_zone)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(session.club_id,session.id,new Date(now).toISOString(),gameAmount,
      String(from.id),from.name,from.pc_number,from.zone,String(to.id),to.name,to.pc_number,to.zone);
}

const transferCount = session => (String(session.notes || '').match(/\| TRANSFER:/g) || []).length;
const finiteAmount = value => value !== null && value !== undefined && Number.isFinite(Number(value)) && Number(value) >= 0;
const snapshot = (row, side) => ({ id:row[side+'_id'], name:row[side+'_name'], pc_number:row[side+'_number'], zone:row[side+'_zone'] });

export function createSessionAttribution(db) {
  const hasTable = name => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name);
  const stored = hasTable('session_transfer_history')
    ? db.prepare('SELECT * FROM session_transfer_history WHERE club_id=? AND session_id=? ORDER BY id') : null;
  const audit = hasTable('audit_logs') ? db.prepare(`SELECT details FROM audit_logs
    WHERE club_id=? AND action_type='PC_SWAP' AND json_valid(details)
      AND json_extract(details,'$.sessionId')=? ORDER BY id`) : null;

  function distribution(session, end) {
    const start = Date.parse(session.started_at), count = transferCount(session);
    const rows = stored ? stored.all(session.club_id,session.id) : [];
    let events = rows.map(row => ({ at:Date.parse(row.transferred_at), amount:row.game_amount,
      from:snapshot(row,'from'), to:snapshot(row,'to') }));
    // Older HTTP transfers recorded reliable IDs/timestamps in the audit log.
    // Use them only when the complete chain can be verified; never infer time
    // or past prices from a PC name or today's tariff.
    if (count > events.length && audit) {
      for (const row of audit.all(session.club_id,session.id)) {
        const entry = JSON.parse(row.details);
        const at = Date.parse(entry?.transferredAt);
        if (!Number.isFinite(at) || !entry.fromComputerId || !entry.toComputerId) continue;
        if (events.some(e => e.at===at && String(e.from.id)===String(entry.fromComputerId) && String(e.to.id)===String(entry.toComputerId))) continue;
        let amount = finiteAmount(entry.carriedAmount) ? Number(entry.carriedAmount) : null;
        if (amount === null) {
          let plan; try { plan=JSON.parse(session.prepaid_rate_plan || 'null'); } catch {}
          // A preserved prepaid prefix is the exact cumulative consumed value.
          const prefix=plan?.version===2 && Array.isArray(plan.segments) &&
            plan.segments.find(segment=>Array.isArray(segment) && segment[0]===start && segment[1]===at);
          if (prefix && finiteAmount(prefix[2])) amount=Number(prefix[2]);
        }
        events.push({at,amount,from:{id:entry.fromComputerId,name:entry.fromName},to:{id:entry.toComputerId,name:entry.toName}});
      }
    }
    if (!count && !events.length) {
      const pc={id:session.computer_id};
      return {time:[{pc,start,end}],money:[{pc,start:0,end:Infinity}],transferred:false};
    }
    events=events.filter(e=>Number.isFinite(e.at) && e.at>=start && e.at<=end).sort((a,b)=>a.at-b.at);
    // Retain a contiguous, verified tail if old transfers are missing.
    // Deleting a PC rebinds completed sessions to the club's archive placeholder.
    // The persisted destination still identifies the actual last PC in that case.
    let expected=String(session.computer_id)===`archived_${session.club_id}` && events.length
      ? String(events[events.length-1].to.id) : String(session.computer_id);
    const tail=[];
    for(let i=events.length-1;i>=0;i--){
      if(String(events[i].to.id)!==expected)break;
      tail.unshift(events[i]);expected=String(events[i].from.id);
    }
    const complete=tail.length===count && count>0 && tail.length===events.length;
    if (!tail.length) return {time:[{pc:null,start,end}],money:[{pc:null,start:0,end:Infinity}],transferred:true};
    const time=[],money=[];
    let cursor=start, pc=complete?tail[0].from:null, moneyPc=pc, moneyCursor=0;
    for(const event of tail){
      time.push({pc,start:cursor,end:event.at});cursor=event.at;pc=event.to;
      if(finiteAmount(event.amount) && Math.round(Number(event.amount))>=moneyCursor){
        const boundary=Math.max(moneyCursor,Math.round(Number(event.amount)));
        money.push({pc:moneyPc,start:moneyCursor,end:boundary});moneyCursor=boundary;moneyPc=event.to;
      }else moneyPc=null;
    }
    time.push({pc,start:cursor,end});money.push({pc:moneyPc,start:moneyCursor,end:Infinity});
    return {time,money,transferred:true};
  }

  // Read-only placement of the SAME retained receipts used by financial reports.
  // Offsets include payments outside the selected dates, so a later extension
  // does not get credited to a PC the customer had already left.
  const cash=db.prepare('SELECT rowid AS ledger_order,*,datetime(created_at) AS paid_at FROM transactions WHERE club_id=? AND session_id=?');
  const balance=db.prepare("SELECT rowid AS ledger_order,*,datetime(created_at) AS paid_at FROM client_transactions WHERE club_id=? AND session_id=? AND type IN ('SESSION_DEDUCT','REFUND') AND category='GAME'");
  function paymentOffsets(session) {
    const rows=[];
    for(const [query,isBalance] of [[cash,false],[balance,true]]){
      const retained=retainedSessionPayments(query.all(session.club_id,session.id).map(t=>({...t,in_range:1,
        category:isBalance?'GAME':receiptCategory(t),paymentMethod:isBalance?'BALANCE':paymentMethod(t.payment_type||t.payment_method),
        amount:isBalance&&t.type==='REFUND'?-Number(t.amount):Number(t.amount)})));
      for(const row of retained)if(row.category==='GAME' && row.amount>0 && (isBalance || ['CASH','CARD'].includes(row.paymentMethod)))
        rows.push({...row,key:(isBalance?'balance:':'tx:')+row.id});
    }
    rows.sort((a,b)=>String(a.paid_at).localeCompare(String(b.paid_at)) || a.ledger_order-b.ledger_order || a.key.localeCompare(b.key));
    const offsets=new Map();let cursor=0;
    for(const row of rows){offsets.set(row.key,cursor);cursor+=row.amount;}
    return offsets;
  }
  return {distribution,paymentOffsets};
}
