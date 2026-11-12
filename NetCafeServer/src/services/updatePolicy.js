export function canApplyUpdate({ staged, applying, activeSessions, pendingWrites, idleSeconds, minimumIdleSeconds = 10, manual = false }) {
  return Boolean(staged) && !applying && pendingWrites === 0 &&
    (manual === true ? Number.isInteger(activeSessions) && activeSessions >= 0 :
      activeSessions === 0 && Number.isFinite(idleSeconds) && idleSeconds >= Math.max(5, minimumIdleSeconds));
}
export function validateRelease(manifest, component) {
  if (!/^\d+\.\d+\.\d+$/.test(manifest?.version ?? '')) throw new Error('Invalid release version');
  const file = manifest[component];
  const url = new URL(file?.downloadUrl || file?.url);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    throw new Error('HTTPS release download required');
  if (!/^[a-f\d]{64}$/i.test(file?.sha256 ?? '')) throw new Error('Release SHA256 required');
  return { version: manifest.version, url: url.href, sha256: file.sha256.toLowerCase() };
}
