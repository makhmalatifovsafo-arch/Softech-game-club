// Interpret a wall clock in the club's timezone, independent of the phone timezone.
export function clubFields(instant,timeZone){
 const parts=Object.fromEntries(new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'}).formatToParts(new Date(instant)).map(p=>[p.type,p.value]));
 return {date:`${parts.year}-${parts.month}-${parts.day}`,time:`${parts.hour}:${parts.minute}`,seconds:parts.second};
}
export function clubInstant(date,time,timeZone){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!/^([01]\d|2[0-3]):[0-5]\d$/.test(time))throw Error('Sana va 24 soatlik vaqtni kiriting.');
 const target=Date.parse(date+'T'+time+':00Z');let value=target;
 for(let i=0;i<4;i++){const f=clubFields(value,timeZone);const wall=Date.parse(f.date+'T'+f.time+':'+f.seconds+'Z');value+=target-wall;}
 const f=clubFields(value,timeZone);if(f.date!==date||f.time!==time)throw Error('Bu vaqt klub vaqt zonasida mavjud emas.');
 // DST overlap: do not silently pick one of two distinct reservation instants.
 for(const delta of [-3600000,3600000]){const other=clubFields(value+delta,timeZone);if(other.date===date&&other.time===time)throw Error('Bu vaqt ikki marta uchraydi. Boshqa vaqt tanlang.');}
 return new Date(value).toISOString();
}
