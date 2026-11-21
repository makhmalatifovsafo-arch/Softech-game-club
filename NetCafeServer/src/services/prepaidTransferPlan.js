import { calculateMinuteCost, resolveZoneIdForComputer } from './pricingEngine.js';

// Freeze refund prices for the converted remaining time, including partial minutes.
export function frozenPriceSegments(pcId, clubId, start, end) {
  const zone=resolveZoneIdForComputer(pcId,clubId),segments=[];
  const until=Date.parse(end);
  for(let cursor=Date.parse(start);cursor<until;) {
    const next=Math.min(until,(Math.floor(cursor/60000)+1)*60000);
    segments.push([cursor,next,calculateMinuteCost(new Date(cursor),false,clubId,zone,(next-cursor)/60000)]);
    cursor=next;
  }
  return {version:2,segments};
}

// Preserve already purchased prices, including fractional minutes and transferred
// sessions. Only newly purchased time uses the current tariff.
export function extendFrozenPricePlan(session, end) {
  const previous=JSON.parse(session.prepaid_rate_plan || 'null');
  const start=Date.parse(session.started_at),until=Date.parse(session.ends_at);
  const segments=previous?.version===2 ? previous.segments : Array.isArray(previous)
    ? previous.map((rate,i)=>[start+i*60000,Math.min(until,start+(i+1)*60000),
        Number(rate)*Math.max(0,Math.min(1,(until-start)/60000-i))]).filter(([a,b])=>b>a)
    : [[start,until,Number(session.paid_amount)]];
  return {version:2,segments:[...segments,...frozenPriceSegments(session.computer_id,session.club_id,session.ends_at,end).segments]};
}
