// Read-only diagnostics: never requests a license or sends a Telegram message.
// Can also be copied alongside runtime/node.exe in an older server installation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dns from 'node:dns';

const directory = path.dirname(fileURLToPath(import.meta.url));
const lines = [];
function report(message) { lines.push(message); console.log(message); }
function readJson(name) {
  try { return JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')); }
  catch { return {}; }
}
report('Softech ulanish diagnostikasi (faqat tekshiruv)');
report('Kompyuter vaqti (UTC): ' + new Date().toISOString());
report('Runtime: ' + process.version);
report('Diskdagi server versiyasi: ' + (readJson('package.json').version || 'aniqlanmadi'));

function causes(error) {
  const detail = [error.code || error.name, error.syscall].filter(Boolean).join(' / ');
  return [detail, ...(error.cause ? causes(error.cause) : []),
    ...(error.errors || []).flatMap(causes)].filter(Boolean);
}
async function check(label, url, fetcher = fetch) {
  try {
    const response = await fetcher(url, {signal:AbortSignal.timeout(30000),cache:'no-store'});
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {}
    report(`${label}: HTTP ${response.status}; JSON: ${data ? 'ha' : 'yo‘q'}`);
    if (data?.version) report('Ishlayotgan versiya: ' + data.version);
    if (data?.app) report('Ilova: ' + data.app);
    return data;
  } catch (error) {
    report(`${label}: ULANMADI (${causes(error).join(', ')})`);
  }
}

async function checkDns(hostname, label, options) {
  let timeout;
  try {
    const addresses = await Promise.race([
      dns.promises.lookup(hostname, options),
      new Promise((_, reject) => { timeout = setTimeout(() => reject(Object.assign(new Error(), {code:'DNS_TIMEOUT'})), 5000); })
    ]);
    report(`${label}: OK (${addresses.map(item => item.family === 4 ? 'IPv4' : 'IPv6').join(', ')})`);
  } catch (error) { report(`${label}: XATO (${causes(error).join(', ')})`); }
  finally { clearTimeout(timeout); }
}

await check('Mahalliy server', 'http://127.0.0.1:5000/api/health');
const liveLicense = await check('Mahalliy litsenziya holati', 'http://127.0.0.1:5000/api/license/status');
try {
  const url = new URL(liveLicense?.cloudUrl || process.env.SOFTECH_CLOUD_URL || readJson('config.json').cloudUrl || 'https://softech-game-club.vercel.app');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('invalid URL');
  report('Bulut manzili: ' + url.toString());
  report('Manzil manbasi: ' + (liveLicense?.cloudUrl ? 'ishlayotgan server' : 'muhit/config.json yoki standart manzil'));
  if (url.hostname === 'softech-game-club-vercell.app') {
    report('MANZIL XATOSI: standart domen softech-game-club.vercel.app (vercel oldida nuqta, oxirida bitta l).');
  }
  await checkDns(url.hostname, 'Windows DNS (ADDRCONFIG)', {all:true,hints:dns.ADDRCONFIG});
  await checkDns(url.hostname, 'Windows DNS (hints=0)', {all:true,hints:0});
  await checkDns(url.hostname, 'Windows DNS (IPv4)', {all:true,family:4,hints:0});
  const base = url.toString().replace(/\/+$/, '');
  await check('Bulut serveri', base + '/api/version');
  await check('Litsenziya API', base + '/api/telemetry/activation-status?hwid=SOFTECH-CONNECTIVITY-CHECK');
  try {
    const { cloudFetch } = await import('./src/services/cloudIpv4.js');
    await check('Dastur transporti (Windows DNS tiklanishi bilan)', base + '/api/version', cloudFetch);
  } catch { report('IPv4 tiklanish moduli yuklanmadi. Yangilangan Server Setup ni o‘rnating.'); }
} catch { report('Bulut manzili noto‘g‘ri. SOFTECH_CLOUD_URL yoki config.json ni tekshiring.'); }
report('ENOTFOUND/EAI_AGAIN = DNS; CERT/TLS = sertifikat yoki kompyuter vaqti; TIMEOUT = aloqa kechikdi.');
report('ENOENT / getaddrinfo = Windows DNS chaqiruvi xatosi; ENOENT boshqa amal bilan kelsa, tizim resursini tekshirish kerak.');
report('Mahalliy server ulanmasa SoftechCockpit.exe ni oching. Disk va ishlayotgan versiya farq qilsa dasturni qayta oching.');
try {
  const output = path.join(directory, 'connection-report.txt');
  fs.writeFileSync(output, lines.join('\r\n') + '\r\n', 'utf8');
  console.log('Hisobot saqlandi: ' + output);
} catch { console.log('Hisobot faylini yozib bo‘lmadi; yuqoridagi natijadan foydalaning.'); }
