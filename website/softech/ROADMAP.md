# Website stages

## Stage 1 — foundation (implemented)

- Cyberpunk landing page with a four-part scroll presentation using the real server interface: computer grid, session start, bar and financial reports. Captures use isolated test data, clearly labelled. Native scrolling drives perspective, zoom, scene transitions and progress; reduced-motion and short viewports use a static layout. The interactive demo has been removed at the user's request.
- Order form prepares a message locally. User copies the preview and sends it to @softech_support themselves. No request is automatically sent, stored, or represented as accepted.
- Searchable help index and six directly accessible, static topic URLs. HTML remains useful without JavaScript.
- Contextual help is now wired in server source; see Stage 4.

## Stage 2 — presentation depth

Actual product screenshots and focused scroll transitions are implemented. Further iteration should follow user feedback on the animation, without reintroducing an interactive product demo. Keep administrator and owner journeys understandable, and validate phones, keyboard navigation and motion preferences; avoid scroll hijacking and heavy video backgrounds.

## Stage 3 — orders and public launch

The owner authorized public access on 2026-11-17. If orders must arrive without a Telegram handoff, add server-side storage, input validation, spam controls, delivery retry, a receipt number and an order inbox. Configure approved notifications. Never expose bot tokens in static source.

## Stage 4 — contextual in-app help

The server now has ? links in session opening, VIP Postpaid, both checkout dialogs, tariff settings, room tariffs, Bar and the PC-bar dialog. Five short articles and the mobile overview each have four steps and one example. The Windows launcher opens help in the system browser; the browser version uses a separate tab. Offline clicks show a short local explanation. No club IDs, credentials, money amounts or customer data are sent.

Next batch: session transfers, customer balance, reports and connection indicators. Add these after reviewing the first batch with users. Mobile and super-admin contextual buttons are not included yet.

Initial route contract:

The paths below are relative to the website root: `/site` on the shared Vercel deployment, or `/` on the older ChatGPT Sites host. Existing Sites links remain supported; new desktop releases use Vercel `/site/help/...`.

| Topic ID | Path | Intended location |
| --- | --- | --- |
| session.start | /help/seans-ochish/ | Session start dialog |
| session.vip | /help/vip-postpaid/ | VIP session section |
| tariff.schedule | /help/dinamik-tariflar/ | General and room tariff settings |
| bar.sale | /help/bar-savdosi/ | Bar / add to PC |
| session.checkout | /help/seansni-yopish/ | Checkout / refund |
| mobile.overview | /help/mobil-panel/ | Mobile help |

Topic titles can change; retain existing paths or add redirects when moving them. Do not show a generic homepage when a known topic is requested. Keep help static and independent of the club database.
