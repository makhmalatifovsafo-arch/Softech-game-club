export function resolveCloudUrl(config = {}, env = process.env) {
  const value = env.SOFTECH_CLOUD_URL || config.cloudUrl || 'https://softech-game-club.vercel.app';
  const url = new URL(value.trim());
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new Error('SOFTECH_CLOUD_URL must be an HTTP(S) base URL without credentials, query or fragment.');
  }
  return url.toString().replace(/\/+$/, '');
}
