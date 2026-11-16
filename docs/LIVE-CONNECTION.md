# Club mobile live connection

The WebSocket hub must run as a persistent Node 22 process, not a Vercel function.
Run `node scripts/live-hub.mjs` with `PORT` (default 8090) and a randomly generated
`SOFTECH_LIVE_SECRET` of at least 32 characters. Put an HTTPS reverse proxy in front,
with WebSocket upgrades enabled for `/live`. `/health` returns readiness.

Configure Vercel Production and the hub with the SAME `SOFTECH_LIVE_SECRET`.
Configure Vercel with `SOFTECH_LIVE_URL=wss://YOUR-HOST/live` and
`SOFTECH_LIVE_NOTIFY_URL=https://YOUR-HOST/notify`. Redeploy Vercel and install the
updated club server. Never put the secret in browser code, client configuration,
or Git. No database migration is required for this transport.

Mobile sessions and signed server licenses obtain short-lived, club-bound tickets
through existing cloud authentication. The hub carries only wake notifications:
jobs to servers, snapshot/result changes to mobile. All business reads and writes
retain existing authentication, encryption, permissions and durable receipts.
Tickets expire after 60 seconds; reconnect obtains a new authorization check.
Revocation therefore removes notification access within 60 seconds. Notifications
contain no customer, financial or command data.

Polling remains enabled for old versions, missed notifications and hub outages.
This is near-real-time delivery, not a guarantee of uninterrupted internet.
Server snapshots still depend on local mutation hooks and periodic sync; mobile
does not overwrite an open dialog when a refresh notification arrives.

Validate first in a test club: open/close a session from mobile, change it on the
cashier, disconnect the hub and reconnect, restart the server, rotate an account,
and verify that a second club never receives the first club's notifications.
Do not report production live until the hub, Vercel configuration, and updated
server have all been deployed and checked together.
