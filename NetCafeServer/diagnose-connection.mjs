// Read-only diagnostics: never requests a license or sends a Telegram message.
// Can also be copied alongside runtime/node.exe in an older server installation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
  return [error.code || error.name, ...(error.cause ? causes(error.cause) : []),
    ...(error.errors || []).flatMap(causes)].filter(Boolean);
}
async function check(label, url) {
  try {
    const response = await fetch(url, {signal:AbortSignal.timeout(30000),cache:'no-store'});
    const text = await response.text();
    let data;
    try { data = JSON.parse(text); } catch {}
    report(`${label}: HTTP ${response.status}; JSON: ${data ? 'ha' : 'yo‘q'}`);
    if (data?.version) report('Ishlayotgan versiya: ' + data.version);
    if (data?.app) report('Ilova: ' + data.app);
  } catch (error) {
    report(`${label}: ULANMADI (${causes(error).join(', ')})`);
  }
}

await check('Mahalliy server', 'http://127.0.0.1:5000/api/health');
try {
  const url = new URL(process.env.SOFTECH_CLOUD_URL || readJson('config.json').cloudUrl || 'https://softech-game-club.vercel.app');
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw Error('invalid URL');
  report('Bulut manzili: ' + url.toString());
  const base = url.toString().replace(/\/+$/, '');
  await check('Bulut serveri', base + '/api/version');
  await check('Litsenziya API', base + '/api/telemetry/activation-status?hwid=SOFTECH-CONNECTIVITY-CHECK');
} catch { report('Bulut manzili noto‘g‘ri. SOFTECH_CLOUD_URL yoki config.json ni tekshiring.'); }
report('ENOTFOUND/EAI_AGAIN = DNS; CERT/TLS = sertifikat yoki kompyuter vaqti; TIMEOUT = aloqa kechikdi.');
report('Mahalliy server ulanmasa SoftechCockpit.exe ni oching. Disk va ishlayotgan versiya farq qilsa dasturni qayta oching.');
try {
  const output = path.join(directory, 'connection-report.txt');
  fs.writeFileSync(output, lines.join('\r\n') + '\r\n', 'utf8');
  console.log('Hisobot saqlandi: ' + output);
} catch { console.log('Hisobot faylini yozib bo‘lmadi; yuqoridagi natijadan foydalaning.'); }
