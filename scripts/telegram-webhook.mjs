// Run from the repository root with --env-file-if-exists=.env.
// Never print the bot token or webhook secret.
const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const setup = process.argv.includes('--setup') || process.argv.includes('--configure');
const urlIndex = process.argv.indexOf('--url');

async function telegram(method, body) {
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body), signal: AbortSignal.timeout(15000)
  });
  const data = await response.json();
  if (!response.ok || !data.ok) throw Error(`Telegram ${method} failed (HTTP ${response.status}).`);
  return data.result;
}

try {
  const explicitUrl = urlIndex >= 0 ? process.argv[urlIndex + 1] : null;
  if (urlIndex >= 0 && (!explicitUrl || explicitUrl.startsWith('--'))) throw Error('Provide an HTTPS address after --url.');
  const base = explicitUrl || process.env.SOFTECH_CLOUD_URL || 'https://softech-game-club.vercel.app';
  let endpoint;
  try { endpoint = new URL('/api/telegram/webhook', base); }
  catch { throw Error('Invalid cloud URL. Use --url https://softech-game-club.vercel.app'); }
  if (!token || !secret || !process.env.TELEGRAM_ADMIN_CHAT_ID) throw Error('TELEGRAM_BOT_TOKEN, TELEGRAM_ADMIN_CHAT_ID and TELEGRAM_WEBHOOK_SECRET must be configured in .env.');
  if (endpoint.protocol !== 'https:') throw Error('Webhook requires HTTPS. For Vercel add: --url https://softech-game-club.vercel.app');
  if (!/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw Error('TELEGRAM_WEBHOOK_SECRET must contain 32-256 letters, digits, underscores or hyphens.');
  const info = await telegram('getWebhookInfo', {});
  console.log(JSON.stringify({ url: info.url, pendingUpdates: info.pending_update_count,
    lastError: info.last_error_message, allowedUpdates: info.allowed_updates }, null, 2));
  // Empty update cannot approve a club or send a Telegram message.
  const probe = await fetch(endpoint, { method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
    body: '{}', signal: AbortSignal.timeout(15000) });
  if (!probe.ok) throw Error(`Webhook returned HTTP ${probe.status}. Set Vercel Production TELEGRAM_WEBHOOK_SECRET to the same value as .env, redeploy, then retry.`);
  const result = await probe.json();
  if (result.handled !== false) throw Error('Unexpected webhook response. Check SOFTECH_CLOUD_URL.');
  console.log('Webhook accepts the configured secret.');
  if (setup) {
    await telegram('setWebhook', { url: endpoint.href, secret_token: secret,
      allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
    console.log('Webhook configured; pending updates preserved.');
  } else console.log('To register this secret with Telegram, run again with --setup.');
} catch (error) {
  // Network errors may contain credential-bearing URLs; do not print their cause/stack.
  console.error(error instanceof TypeError ? 'Network request failed.' : error.message);
  process.exitCode = 1;
}
