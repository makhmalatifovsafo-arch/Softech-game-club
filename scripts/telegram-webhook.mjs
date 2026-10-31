// --check is read-only; --configure explicitly installs the webhook without sending messages.
const configure = process.argv.includes('--configure');
if (!configure && !process.argv.includes('--check')) throw new Error('Use --check or --configure');
const token = process.env.TELEGRAM_BOT_TOKEN;
const chat = process.env.TELEGRAM_ADMIN_CHAT_ID;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
if (!token || !chat) throw new Error('TELEGRAM_BOT_TOKEN and TELEGRAM_ADMIN_CHAT_ID are required.');
const endpoint = new URL('/api/telegram/webhook', process.env.SOFTECH_CLOUD_URL || 'https://softech-game-club.vercel.app');
if (endpoint.protocol !== 'https:') throw new Error('Webhook requires HTTPS.');
async function call(method, body) {
  let response;
  try {
    response = await fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body || {}), signal: AbortSignal.timeout(15000)
    });
  } catch { throw new Error('Telegram connection failed. Check network access.'); }
  const data = await response.json();
  if (!response.ok || !data.ok) throw new Error('Telegram API: ' + (data.description || response.status));
  return data.result;
}
const bot = await call('getMe');
console.log('Bot: @' + bot.username);
if (configure) {
  if (!secret || !/^[A-Za-z0-9_-]{32,256}$/.test(secret)) throw new Error('TELEGRAM_WEBHOOK_SECRET: use 32-256 letters, numbers, underscores or hyphens.');
  await call('setWebhook', { url: endpoint.href, secret_token: secret, allowed_updates: ['message', 'callback_query'], drop_pending_updates: false });
  console.log('Webhook configured: ' + endpoint.origin);
}
const info = await call('getWebhookInfo');
console.log(JSON.stringify({ configured: Boolean(info.url), matchesExpectedEndpoint: info.url === endpoint.href, pendingUpdates: info.pending_update_count, lastError: info.last_error_message || null }, null, 2));
