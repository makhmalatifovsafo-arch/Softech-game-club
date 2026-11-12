import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Transform } from 'node:stream';
import { describeCloudError } from './cloudConnection.js';

function validateUrl(address) {
  const url = new URL(address);
  if (url.username || url.password || url.hash ||
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)))) {
    throw new Error('Yangilanish manzili xavfsiz HTTPS bo‘lishi shart.');
  }
  return url;
}

// GitHub assets redirect to another HTTPS host. Use streaming responses, not
// the size-limited cloud JSON transport. Scoped IPv4 lookup avoids Windows
// ADDRCONFIG/getaddrinfo ENOENT without changing system DNS or TLS validation.
export async function openUpdateResponse(address, { signal, lookupImpl = lookup, maxRedirects = 5 } = {}) {
  let url = validateUrl(address);
  for (let redirects = 0; ; redirects++) {
    let response;
    try {
      response = await new Promise((resolve, reject) => {
        const request = (url.protocol === 'https:' ? https : http).get(url, {
          signal, agent: false, family: 4, autoSelectFamily: false, rejectUnauthorized: true,
          headers: { 'User-Agent': 'Softech-Updater/3.0', 'Cache-Control': 'no-cache', 'Accept-Encoding': 'identity' },
          lookup(hostname, options, callback) {
            lookupImpl(hostname, { family: 4, hints: 0, all: Boolean(options.all) }, callback);
          }
        }, incoming => { incoming.on('error', () => {}); resolve(incoming); });
        request.on('error', reject);
      });
    } catch (error) { throw describeCloudError(signal?.aborted ? signal.reason : error, url); }
    if (![301, 302, 303, 307, 308].includes(response.statusCode)) return response;
    const location = response.headers.location;
    response.destroy();
    if (!location || redirects >= maxRedirects) throw new Error('Yangilanish manzili juda ko‘p yoki yaroqsiz yo‘naltirish qaytardi.');
    const next = validateUrl(new URL(location, url));
    if (url.protocol === 'https:' && next.protocol !== 'https:') throw new Error('HTTPS yangilanish HTTP manziliga yo‘naltirilmaydi.');
    url = next;
  }
}

export async function fetchUpdateManifest(address, options = {}) {
  const signal = options.signal || AbortSignal.timeout(30000);
  const response = await openUpdateResponse(address, { ...options, signal });
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error(`Yangilanish manifesti: HTTP ${response.statusCode}. Release ichidagi version.json faylini tekshiring.`);
  }
  try {
    const chunks = []; let bytes = 0;
    for await (const chunk of response) {
      bytes += chunk.length;
      if (bytes > 1024 * 1024) throw new Error('Yangilanish manifesti juda katta.');
      chunks.push(chunk);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
    catch { throw new Error('Yangilanish manifesti JSON formatida emas.'); }
  } catch (error) {
    if (signal.aborted || error.code || error.cause) throw describeCloudError(signal.aborted ? signal.reason : error, address);
    throw error;
  } finally { response.destroy(); }
}

export async function downloadUpdateFile(address, destination, options = {}) {
  const signal = options.signal || AbortSignal.timeout(900000);
  const response = await openUpdateResponse(address, { ...options, signal });
  if (response.statusCode !== 200) {
    response.destroy();
    throw new Error(`Yangilanish paketi: HTTP ${response.statusCode}.`);
  }
  const part = destination + '.part';
  let bytes = 0;
  const total = Number(response.headers['content-length']) || null;
  const progress = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    options.onProgress?.(bytes, total);
    callback(null, chunk);
  } });
  try {
    await pipeline(response, progress, fs.createWriteStream(part), { signal });
    if (total !== null && bytes !== total) throw new Error('Yangilanish paketi to‘liq yuklanmadi.');
    fs.renameSync(part, destination);
  } catch (error) {
    fs.rmSync(part, { force: true });
    throw describeCloudError(signal.aborted ? signal.reason : error, address);
  } finally { response.destroy(); }
}
