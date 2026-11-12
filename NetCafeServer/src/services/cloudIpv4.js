import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns';

// Scoped workaround for Windows getaddrinfo/ADDRCONFIG failures. Resolve the
// original hostname through Windows using IPv4 without ADDRCONFIG. Keep Host,
// SNI and certificate verification; never replace the URL with a hardcoded IP.
export function requestWithIpv4(address, options, { lookupImpl = lookup } = {}) {
  const url = new URL(address);
  if (!['https:', 'http:'].includes(url.protocol)) throw new Error('Unsupported cloud protocol');
  return new Promise((resolve, reject) => {
    const request = (url.protocol === 'https:' ? https : http).request(url, {
      method: options.method || 'GET',
      headers: options.headers,
      signal: options.signal,
      agent: false,
      autoSelectFamily: false,
      family: 4,
      rejectUnauthorized: true,
      lookup(hostname, settings, callback) {
        lookupImpl(hostname, { family: 4, hints: 0, all: Boolean(settings.all) }, callback);
      }
    }, response => {
      const chunks = [];
      let bytes = 0;
      response.on('error', reject);
      response.on('data', chunk => {
        bytes += chunk.length;
        if (bytes > 4 * 1024 * 1024) {
          request.destroy(new Error('Bulut litsenziya javobi juda katta.'));
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const item of Array.isArray(value) ? value : [value]) if (item !== undefined) headers.append(name, item);
        }
        try {
          resolve(new Response([204, 205, 304].includes(response.statusCode) ? null : Buffer.concat(chunks), {
            status: response.statusCode, headers
          }));
        } catch (error) { reject(error); }
      });
    });
    request.on('error', reject);
    request.end(options.body);
  });
}

export function isWindowsDnsFailure(error, platform = process.platform) {
  if (platform !== 'win32') return false;
  const visited = new Set();
  function inspect(value) {
    if (!value || visited.has(value) || visited.size >= 20) return false;
    visited.add(value);
    // Do not replay a request for ambiguous file/socket/TLS failures.
    if (value.code === 'ENOENT' && value.syscall === 'getaddrinfo') return true;
    if (value.errors?.length) return value.errors.every(inspect);
    return inspect(value.cause);
  }
  return inspect(error);
}

// Cloud JSON APIs only; file downloads keep their separate streaming transport.
export async function cloudFetch(address, options = {}, {
  fetchImpl = globalThis.fetch, ipv4FetchImpl = requestWithIpv4, platform = process.platform
} = {}) {
  const requestOptions = { ...options, redirect: 'error', signal: options.signal || AbortSignal.timeout(30000) };
  try { return await fetchImpl(address, requestOptions); }
  catch (error) {
    // DNS failed before sending HTTP. A redirect might have sent a POST first,
    // so redirects are explicitly disabled on this transport.
    if (!requestOptions.signal.aborted && isWindowsDnsFailure(error, platform)) {
      return ipv4FetchImpl(address, requestOptions);
    }
    throw error;
  }
}
