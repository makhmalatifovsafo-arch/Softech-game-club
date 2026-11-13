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
