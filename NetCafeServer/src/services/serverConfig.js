import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { writeDurableFile } from './durableJson.js';
import { resolveCloudUrl } from './cloudUrl.js';

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

// Recover only a damaged document, never a deliberate, parseable configuration.
// Bind the saved settings to the locally signed club identity. Normal license
// expiry, hardware, ban and clock checks still run after this operation.
export function recoverServerConfig(filename) {
  let original;
  try { original=fs.readFileSync(filename); }
  catch { throw configError(filename); }
  try { decodeConfig(original,filename); return false; }
  catch(error) { if(error.code!=='INVALID_SERVER_CONFIG')throw error; }
  try {
    const saved=fs.readFileSync(filename+'.last-good');
    const config=decodeConfig(saved,filename);
    const signed=decodeConfig(fs.readFileSync(path.join(path.dirname(filename),'data','softech_license.sig')));
    const expected=crypto.createHmac('sha256',process.env.SOFTECH_CLOUD_KEY||'SOFTECH_CLOUD_RSA_HMAC_MASTER_SIGNING_KEY_2026')
      .update(JSON.stringify(signed.payload)).digest('hex');
    if(signed.signature!==expected || !Number.isSafeInteger(Number(config.clubId)) || Number(config.clubId)<=0 ||
       Number(config.clubId)!==Number(signed.payload.clubId) || typeof config.cloudUrl!=='string')throw Error();
    resolveCloudUrl(config,{});
    // Preserve evidence before replacing anything; a disk error must leave the
    // original untouched. A different club or invalid backup is never guessed.
    const evidence=filename+'.corrupt-'+crypto.randomUUID()+'.bak';
    writeDurableFile(evidence,original);
    if(!fs.readFileSync(filename).equals(original))throw Error();
    writeDurableFile(filename,saved);
    console.warn('[Config] Damaged settings restored from verified club backup; original preserved.');
    return true;
  } catch { throw configError(filename); }
}
