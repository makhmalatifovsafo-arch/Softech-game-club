// Draft-only geometry. Room/PC IDs, connections and tariffs are never replaced.
export const MIN_ROOM_SIZE = 120;
export const MAX_ROOM_SIZE = 10000;
const clamp = (n, min, max) => Math.max(min, Math.min(max, n));

export function polygonBounds(points) {
  const x = Math.min(...points.map(p => p.x)), y = Math.min(...points.map(p => p.y));
  return {x, y, width: Math.max(...points.map(p => p.x)) - x, height: Math.max(...points.map(p => p.y)) - y};
}
const cross = (a, b, c) => (b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
const onSegment = (a, b, p) => Math.abs(cross(a,b,p)) < 1e-6 && p.x >= Math.min(a.x,b.x) && p.x <= Math.max(a.x,b.x) && p.y >= Math.min(a.y,b.y) && p.y <= Math.max(a.y,b.y);
function intersects(a, b, c, d) {
  return (cross(a,b,c)*cross(a,b,d)<0 && cross(c,d,a)*cross(c,d,b)<0) ||
    onSegment(a,b,c) || onSegment(a,b,d) || onSegment(c,d,a) || onSegment(c,d,b);
}
export function polygonProblem(points) {
  if(points.length<3)return 'Xona uchun kamida 3 ta burchak belgilang.';
  if(points.length>128)return 'Bitta xonada ko‘pi bilan 128 ta burchak bo‘lishi mumkin.';
  if(points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)||Math.abs(p.x)>100000||Math.abs(p.y)>100000))return 'Xona xarita chegarasidan chiqib ketdi.';
  const box=polygonBounds(points);
  if(box.width<MIN_ROOM_SIZE||box.height<MIN_ROOM_SIZE)return 'Xonani biroz kattaroq chizing.';
  if(box.width>MAX_ROOM_SIZE||box.height>MAX_ROOM_SIZE)return 'Xona juda katta. Burchaklarni yaqinroq joylashtiring.';
  for(let i=0;i<points.length;i++){
    const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];
    if(Math.hypot(a.x-b.x,a.y-b.y)<1)return 'Ikki burchak bir joyda turmasin.';
    // Adjacent collinear edges may continue straight, but may not double back.
    if(Math.abs(cross(a,b,c))<1e-6&&(b.x-a.x)*(c.x-b.x)+(b.y-a.y)*(c.y-b.y)<0)return 'Xona devorlari ustma-ust tushmasin.';
    for(let j=i+2;j<points.length;j++){
      if(i===0&&j===points.length-1)continue;
      if(intersects(a,b,points[j],points[(j+1)%points.length]))return 'Xona devorlari kesishmasin. Burchakni boshqa joyga suring.';
    }
  }
  const area=points.reduce((sum,a,i)=>{const b=points[(i+1)%points.length];return sum+a.x*b.y-b.x*a.y;},0);
  return Math.abs(area)<1 ? 'Xona burchaklari bir to‘g‘ri chiziqda bo‘lmasin.' : '';
}

export function resizedBounds(room, handle, dx, dy) {
  let {x,y,width,height}=room;
  if(handle.includes('w')){width=clamp(room.width-dx,MIN_ROOM_SIZE,MAX_ROOM_SIZE);x=room.x+room.width-width;}
  if(handle.includes('e'))width=clamp(room.width+dx,MIN_ROOM_SIZE,MAX_ROOM_SIZE);
  if(handle.includes('n')){height=clamp(room.height-dy,MIN_ROOM_SIZE,MAX_ROOM_SIZE);y=room.y+room.height-height;}
  if(handle.includes('s'))height=clamp(room.height+dy,MIN_ROOM_SIZE,MAX_ROOM_SIZE);
  return {x,y,width,height};
}

export function resizeRoom(draft, original, id, box) {
  const before=original.rooms.find(r=>r.id===id),room=draft.rooms.find(r=>r.id===id);
  if(!before||!room||before.width<=0||before.height<=0)return;
  const transform=p=>({x:box.x+(p.x-before.x)*box.width/before.width,y:box.y+(p.y-before.y)*box.height/before.height});
  Object.assign(room,box);
  if(before.polygonPoints)room.polygonPoints=before.polygonPoints.map(transform);
  // Keep PCs at the same relative positions instead of stranding them outside
  // a room when its corner is dragged inward. Their identities stay untouched.
  const positions=new Map(original.computers.filter(c=>c.roomId===id).map(c=>[c.id,c]));
  for(const pc of draft.computers){const old=positions.get(pc.id);if(old)Object.assign(pc,transform(old));}
}

export function roomVertices(room) {
  return room.polygonPoints?.map(p=>({...p})) || [
    {x:room.x,y:room.y},{x:room.x+room.width,y:room.y},
    {x:room.x+room.width,y:room.y+room.height},{x:room.x,y:room.y+room.height}
  ];
}
