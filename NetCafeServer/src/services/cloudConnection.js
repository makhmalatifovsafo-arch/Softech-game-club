import { readCloudResponse } from './cloudResponse.js';

// Keep the original socket/DNS/TLS cause: fetch's top-level message hides it.
export function describeCloudError(error, address) {
  const codes = [];
  function collect(value) {
    if (!value || codes.length > 20) return;
    if (typeof value.code === 'string') codes.push(value.code);
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
  } else if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) {
    explanation = 'Bulut domeni DNS orqali topilmadi. Internet va DNS sozlamalarini tekshiring.';
  } else if (/TIMEOUT|TIMEDOUT/.test(code)) {
    explanation = 'Bulut serveri belgilangan vaqtda javob bermadi. Internet ulanishini tekshirib, qayta urining.';
  } else if (code === 'ECONNREFUSED') {
    explanation = 'Bulut ulanishni rad etdi. Server manzili, proksi va firewall sozlamalarini tekshiring.';
  } else {
    explanation = 'Bulut bilan aloqa uzildi. Internet, VPN/proksi va firewall sozlamalarini tekshiring.';
  }
  return Object.assign(new Error(`${explanation} (${host}; ${code})`, { cause: error }), { code });
}

// One deadline includes headers AND body. Only reads may be retried: a lost
// POST response can already have saved the request and sent a Telegram message.
export async function requestCloudJson(url, options = {}, { timeoutMs = 30000, fetchImpl = globalThis.fetch } = {}) {
  const method = (options.method || 'GET').toUpperCase();
  const signal = AbortSignal.timeout(timeoutMs);
  for (let attempt = 0; ; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, { ...options, cache: 'no-store', signal });
      const data = await readCloudResponse(response);
      return { response, data };
    } catch (error) {
      if (response && !signal.aborted && error.name === 'Error' && !error.cause && !error.code) throw error;
      const failure = describeCloudError(signal.aborted ? signal.reason : error, url);
      if (method === 'GET' && attempt === 0 && !signal.aborted &&
          ['ECONNRESET', 'EAI_AGAIN', 'UND_ERR_SOCKET'].includes(failure.code)) continue;
      throw failure;
    }
  }
}
