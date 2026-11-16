export function connectLive({getTicket,onSignal,WebSocketImpl=globalThis.WebSocket}){
 let stopped=false,socket,timer,watchdog,attempt=0;
 const schedule=delay=>{clearTimeout(timer);if(!stopped){timer=setTimeout(run,delay);timer.unref?.();}};
 async function run(){
  if(stopped)return;
  try{
   const config=await getTicket();if(stopped)return;
   if(!config?.enabled){schedule(30000);return;}
   if(!config.url?.startsWith('wss://'))throw Error('Invalid live URL');
   socket=new WebSocketImpl(config.url);
   watchdog=setTimeout(()=>socket?.close(),10000);watchdog.unref?.();
   socket.onopen=()=>socket.send(JSON.stringify({ticket:config.ticket}));
   socket.onmessage=e=>{try{const {event}=JSON.parse(String(e.data));if(['connected','jobs','data','result'].includes(event)){clearTimeout(watchdog);attempt=0;Promise.resolve(onSignal(event)).catch(()=>{});}}catch{}};
   socket.onerror=()=>socket.close();
   socket.onclose=()=>{clearTimeout(watchdog);schedule(Math.min(30000,1000*2**Math.min(attempt++,5))+Math.random()*500);};
  }catch{schedule(Math.min(30000,1000*2**Math.min(attempt++,5)));}
 }
 run();
 return ()=>{stopped=true;clearTimeout(timer);clearTimeout(watchdog);socket?.close();};
}
