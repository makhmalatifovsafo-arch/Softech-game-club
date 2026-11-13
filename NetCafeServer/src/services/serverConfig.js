import fs from 'node:fs';
import path from 'node:path';

export function configError(filename = 'config.json') {
  return Object.assign(new Error(`${path.basename(filename)} sozlamalarini o'qib bo'lmadi. Fayl saqlandi; uni tekshirish kerak.`), {code:'INVALID_SERVER_CONFIG'});
}

// Windows editors/PowerShell may save JSON with a UTF-8 or UTF-16 BOM.
// Decode the encoding marker; never discard settings or replace invalid JSON.
export function decodeConfig(bytes, filename = 'config.json') {
  try {
    let encoding = 'utf-8';
    if (bytes[0] === 0xff && bytes[1] === 0xfe) encoding = 'utf-16le';
    else if (bytes[0] === 0xfe && bytes[1] === 0xff) encoding = 'utf-16be';
    const text = new TextDecoder(encoding, { fatal: true }).decode(bytes);
    const config = JSON.parse(text);
    if (!config || typeof config !== 'object' || Array.isArray(config)) throw Error();
    return config;
  } catch {
    // JSON.parse errors can include credential values. Report only the filename.
    throw configError(filename);
  }
}

export function readServerConfig(filename) {
  let bytes;
  try { bytes = fs.readFileSync(filename); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw configError(filename); }
  return decodeConfig(bytes, filename);
}
