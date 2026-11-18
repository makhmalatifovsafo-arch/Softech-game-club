import {setupConnection} from './setup-connection.js';
export const steps=['rooms','computers','tariffs','review'];
export const dayNames=['Du','Se','Ch','Pa','Ju','Sh','Ya'];
export const newId=prefix=>prefix+'_'+crypto.randomUUID();
export function inside(point,room){
  if(!room.polygonPoints)return point.x>=room.x&&point.y>=room.y&&point.x<room.x+room.width&&point.y<room.y+room.height;
  let hit=false;const p=room.polygonPoints;
  for(let i=0,j=p.length-1;i<p.length;j=i++)if((p[i].y>point.y)!==(p[j].y>point.y)&&point.x<(p[j].x-p[i].x)*(point.y-p[i].y)/(p[j].y-p[i].y)+p[i].x)hit=!hit;
  return hit;
}
export function placeInRoom(draft,pc,roomId){
  const room=draft.rooms.find(r=>r.id===roomId);pc.roomId=room?.id||'';
  if(!room)return;
  const others=draft.computers.filter(c=>c.id!==pc.id&&c.roomId===roomId);
  for(let y=room.y+60;y<room.y+room.height-20;y+=65)for(let x=room.x+45;x<room.x+room.width-20;x+=70){
    const point={x,y};if(inside(point,room)&&!others.some(c=>Math.hypot(c.x-x,c.y-y)<50)){Object.assign(pc,point);return;}
  }
  pc.x=room.x+room.width/2;pc.y=room.y+room.height/2;
}
export function moveRoom(draft,id,x,y){
  const room=draft.rooms.find(r=>r.id===id);if(!room)return;
  const dx=x-room.x,dy=y-room.y;room.x=x;room.y=y;
  if(room.polygonPoints)room.polygonPoints=room.polygonPoints.map(p=>({x:p.x+dx,y:p.y+dy}));
  for(const pc of draft.computers.filter(c=>c.roomId===id)){pc.x+=dx;pc.y+=dy;}
}
export function addComputer(draft,roomId){
  if(draft.computers.length>=500)throw Error('500 tadan ko‘p PC qo‘shib bo‘lmaydi.');
  const taken=new Set(draft.computers.map(c=>c.number));let number=1;while(taken.has(number))number++;
  const pc={id:newId('pc'),number,name:'PC-'+String(number).padStart(2,'0'),roomId:'',ip:'',mac:'',x:0,y:0};
  placeInRoom(draft,pc,roomId||draft.rooms[0]?.id);draft.computers.push(pc);draft.expectedComputers=draft.computers.length;return pc;
}
export function bindClient(draft,pcId,client){
  const pc=draft.computers.find(c=>c.id===pcId);if(!pc||!client?.connected)throw Error('Ulangan clientni tanlang.');
  const clean=value=>String(value||'').replace(/[:-]/g,'').toUpperCase();
  if(draft.computers.some(c=>c.id!==pcId&&(c.number===client.number||c.ip===client.ip||(client.mac&&clean(c.mac)===clean(client.mac)))))
    throw Error('Bu client boshqa PC’ga biriktirilgan. O‘sha PC’ni tanlang.');
  pc.number=client.number;pc.ip=client.ip;pc.mac=client.mac||'';
}
export function connected(pc,clients){
  return setupConnection(pc,clients).ok;
}
export function stepProblems(readiness,step){
  if(!readiness)return [];
  // Connecting every client is required at final readiness, but tariffs can be
  // prepared while an installer is still connecting the other computers.
  return [...readiness.issues,...(readiness.warnings||[])].filter(i=>step==='rooms'?i.step==='rooms':
    i.step===step&&(step!=='computers'||i.code!=='PC_OFFLINE'));
}
export function draftChanges(current,baseline){
  const rows=[];
  for(const [key,label] of [['rooms','Xona'],['computers','PC'],['tariffs','Tarif']]){
    const old=new Map(baseline[key].map(item=>[item.id,item]));
    for(const item of current[key]){
      const previous=old.get(item.id);old.delete(item.id);
      if(!previous)rows.push({label,name:item.name,kind:'Yangi',before:null,after:item});
      else if(JSON.stringify(item)!==JSON.stringify(previous))rows.push({label,name:item.name,kind:'O‘zgartirilgan',before:previous,after:item});
    }
    for(const previous of old.values())rows.push({label,name:previous.name,kind:'Olib tashlangan',before:previous,after:null});
  }
  return rows;
}
