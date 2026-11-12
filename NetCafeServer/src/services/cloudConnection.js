import { readCloudResponse } from './cloudResponse.js';
import { cloudFetch, requestWithIpv4 } from './cloudIpv4.js';

// Keep the original socket/DNS/TLS cause: fetch's top-level message hides it.
export function describeCloudError(error, address) {
  const codes = [];
  const operations = [];
  const visited = new Set();
  function collect(value) {
    if (!value || visited.has(value) || visited.size >= 20) return;
    visited.add(value);
    if (typeof value.code === 'string') codes.push(value.code);
    if (typeof value.syscall === 'string' && /^[a-zA-Z0-9_]+$/.test(value.syscall)) operations.push(value.syscall);
    if (value.name === 'TimeoutError') codes.push('TIMEOUT');
    if (value.cause) collect(value.cause);
    for (const child of value.errors || []) collect(child);
  }
  collect(error);
  const code = codes.find(c => /CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(c)) || codes[0] || 'NETWORK_ERROR';
  const host = new URL(address).host;
  let explanation;
  if (/CERT|TLS|SSL|SELF_SIGNED|UNABLE_TO_VERIFY/.test(code)) {
    explanation = 'HTTPS sertifikatini tekshirib bo‘lmadi. Windows sana/vaqti va antivirus/proksi sertifikatlarini tekshiring.';
  } else if (code === 'ENOENT' && operations.includes('getaddrinfo')) {
    explanation = 'Windows DNS tizimi bulut domenini aniqlay olmadi. Bulut manzilini tekshiring va diagnose-connection.cmd orqali DNS hisobotini oling.';
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    explanation = 'Bulut domeni DNS orqali topilmadi. Internet va DNS sozlamalarini tekshiring.';
  } else if (/TIMEOUT|TIMEDOUT/.test(code)) {
    explanation = 'Bulut serveri belgilangan vaqtda javob bermadi. Internet ulanishini tekshirib, qayta urining.';
  } else if (code === 'ECONNREFUSED') {
    explanation = 'Bulut ulanishni rad etdi. Server manzili, proksi va firewall sozlamalarini tekshiring.';
  } else if (code === 'ENOENT') {
    explanation = 'Ulanish uchun zarur tizim resursi topilmadi. Sababini aniqlash uchun diagnose-connection.cmd ni ishga tushiring.';
  } else {
    explanation = 'Bulut bilan aloqa uzildi. Internet, VPN/proksi va firewall sozlamalarini tekshiring.';
  }
  const syscall = operations[0];
  return Object.assign(new Error(`${explanation} (${host}; ${code}${syscall ? '; ' + syscall : ''})`, { cause: error }), { code, syscall });
}

// One deadline includes headers AND body. Sent POSTs must not be replayed:
// a lost response may already have saved the request and notified Telegram.
export async function requestCloudJson(url, options = {}, {
  timeoutMs = 30000, fetchImpl = globalThis.fetch,
  ipv4FetchImpl = requestWithIpv4, platform = process.platform
} = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const signal = AbortSignal.timeout(timeoutMs);
  const requestOptions = { ...options, cache: 'no-store', redirect: 'error', signal };
  let readRetried = false;
  for (;;) {
    let response;
    try {
      response = await cloudFetch(url, requestOptions, { fetchImpl, ipv4FetchImpl, platform });
      const data = await readCloudResponse(response);
      return { response, data };
    } catch (error) {
      if (response && !signal.aborted && error.name === 'Error' && !error.cause && !error.code) throw error;
      const failure = describeCloudError(signal.aborted ? signal.reason : error, url);
      if (method === 'GET' && !readRetried && !signal.aborted &&
          ['ECONNRESET', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(failure.code)) {
        readRetried = true;
        continue;
      }
      throw failure;
    }
  }
}
