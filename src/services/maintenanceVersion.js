export function requireRemoteMaintenance(club) {
  const version=String(club?.server_version || '');
  const parts=/^(\d+)\.(\d+)\.(\d+)$/.exec(version);
  const supported=parts && (Number(parts[1])>1 || Number(parts[1])===1 && (Number(parts[2])>0 || Number(parts[2])===0 && Number(parts[3])>=34));
  if(!supported)throw Error(`Bu server (${version || 'versiya noma’lum'}) yangi masofaviy yangilashni qo‘llamaydi. Avval Server v1.0.34 yoki yangisini o‘rnating va bulutga ulanishini kuting.`);
}
