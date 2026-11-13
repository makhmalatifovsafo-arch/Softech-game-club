import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {inspectInstallation} from './Inspect-SoftechServer.mjs';
import {restoreEmptyConfig} from './Restore-SoftechConfig.mjs';

export function recoverClub10(directory) {
  const report=inspectInstallation(directory);
  const tables=report.database.tables;
  if(report.database.result!=='OK'||!tables||['users','computers','sessions'].some(name=>tables[name]===null))
    return {...report,recovery:'STOPPED_DATABASE_REVIEW_REQUIRED'};
  try{
    restoreEmptyConfig(directory,{confirmedClubId:10});
    report.recovery='CONFIG_RESTORED_FOR_CLUB_10';
  }catch(error){report.recovery='STOPPED';report.reason=error.code?'FILE_ACCESS_ERROR':error.message;}
  return report;
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
  const report=recoverClub10(path.resolve(process.argv[2]||'C:\\SoftechServer'));
  const output=path.join(path.dirname(fileURLToPath(import.meta.url)),'Softech-Club10-Report.txt');
  const content='Softech Club 10. Baza va litsenziya almashtirilmagan. Maxfiy qiymatlar kiritilmagan.\n'+JSON.stringify(report,null,2)+'\n';
  console.log(content);
  try{fs.writeFileSync(output,content);}catch{console.log('Hisobot saqlanmadi. Oynani suratga oling.');}
  if(report.recovery==='CONFIG_RESTORED_FOR_CLUB_10')console.log('TIKLANDI: Sozlamalar 10-klub uchun tiklandi. Softech Serverni oching. Litsenziyani bulut tekshiradi.');
  else console.log('TOXTATILDI: Fayllarni almashtirmadik. Softech-Club10-Report.txt faylini yuboring.');
}
