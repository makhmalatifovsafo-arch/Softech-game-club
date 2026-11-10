// A stored status can lag behind reality; the connected client socket is authoritative.
export async function autoWakeComputer(pc,{isConnected,sendWake}) {
  if(isConnected(pc.id))return {status:'online',message:'Seans ochildi.'};
  if(!pc.mac_address)return {status:'missing_mac',message:'Seans ochildi, lekin MAC saqlanmagan. Klientni bir marta qo‘lda yoqib serverga ulang — MAC avtomatik saqlanadi. Yoki Sozlamalar → Kompyuterlar → MAC / Avtoyoqish orqali kiriting.'};
  try{await sendWake(pc.mac_address);return {status:'sent',message:'Seans ochildi. Kompyuterni avtomatik yoqish signali yuborildi.'};}
  catch{return {status:'failed',message:'Seans ochildi, ammo yoqish signali yuborilmadi. Tarmoq va Wake-on-LAN sozlamalarini tekshiring.'};}
}
