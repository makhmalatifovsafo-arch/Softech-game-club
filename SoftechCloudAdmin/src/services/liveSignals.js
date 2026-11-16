import crypto from 'node:crypto';
export function liveTicket(clubId,role){
 const secret=process.env.SOFTECH_LIVE_SECRET,url=process.env.SOFTECH_LIVE_URL;
 if(!secret||secret.length<32||!url?.startsWith('wss://'))return {enabled:false};
 const expiresAt=Date.now()+60000;
 const body=Buffer.from(JSON.stringify({clubId:Number(clubId),role,expiresAt})).toString('base64url');
 const signature=crypto.createHmac('sha256',secret).update(body).digest('base64url');
 return {enabled:true,url,ticket:body+'.'+signature,expiresAt};
}
export async function notifyLive(clubId,event){
 const url=process.env.SOFTECH_LIVE_NOTIFY_URL,secret=process.env.SOFTECH_LIVE_SECRET;
 if(!url?.startsWith('https://')||!secret)return;
 try{const r=await fetch(url,{method:'POST',headers:{Authorization:'Bearer '+secret,'Content-Type':'application/json'},body:JSON.stringify({clubId:Number(clubId),event}),signal:AbortSignal.timeout(1500)});if(!r.ok)console.warn('[Live] Notification HTTP',r.status);}
 catch{console.warn('[Live] Notification unavailable; polling retained.');}
}
