# Softech public website

Independent static marketing site. Production server, super admin and mobile applications are not modified by this site. There is no interactive product demo. Product presentation uses screenshots of the current server UI captured from an isolated local server and local cloud with seeded test data. No live club data is shown.

From the repository root:

```powershell
python -m http.server 5187 --bind 127.0.0.1 --directory website/softech/dist
```

Open http://127.0.0.1:5187. Deployment assets are in `dist`; no build or package installation is needed. Contacts: https://t.me/softech_support and tel:+998995634516. Panel links open the existing production mobile panel.

Tested with Microsoft Edge at 1440, 768, 390 and 320 px. Checks cover continuous scroll transitions, reverse scrolling, chapter navigation, removal of demo controls, order preview (including failed clipboard access), help search, local links, reduced motion and content without JavaScript. Fonts and artwork are served locally. Short viewports and reduced-motion users see a static sequence of all four chapters.

The order form prepares a message; the visitor copies it and sends it in Telegram. It does not automatically deliver or persist orders. Help content lives in `scripts/help-topics.mjs` (renderer: `scripts/build-help.mjs`); regenerate with `node website/softech/scripts/build-help.mjs` from the repository root. Browser checks (using the repository's existing Playwright/Edge setup and the running preview above): `node website/softech/scripts/check-site.mjs`.

See `ROADMAP.md` for the phased delivery and stable topic URLs for future in-app help. Server contextual help links now connect to five topic pages. The user authorized public website access. Help opens separately and sends no club data. The server source must ship in a new release before installed clubs receive the buttons.

Sites project identity is in `.openai/hosting.json`. Publish from a separate source checkout, not by initializing a nested Git repository here. The GitHub/Vercel production application remains separate.

## Artwork

`dist/assets/mobile-administrator.webp` shows the current `public/mobile` administrator UI captured at a 390×844 viewport in the isolated mobile test fixture (no production account or data). It is displayed inside a CSS phone frame. The presentation runway is 300 viewport heights; the first transition begins at 2% and completes at 18% of its scroll distance. A visible next-section link shows progress and continues to the mobile section after chapter four.

`dist/assets/server-{computers,session,bar,reports}.webp` are compressed screenshots of the actual `NetCafeServer` UI captured on 2026-11-17. The source files were copied into a new isolated test directory, a local test cloud and server were launched on temporary ports, and a seeded manager session was used to open the real views. All test processes were stopped after capture. These images are not AI-generated or hand-drawn UI replicas. Figures are test data, visibly labelled on the website. Original PNG captures are retained alongside the WebP files. Refresh screenshots when the product UI changes.

`dist/assets/hero.webp` is a WebP conversion of an image generated using the imagegen tool, generation mode. Original PNG is preserved in the user's Codex generated_images directory. No reference image was modified. Final prompt:

> Use case: stylized-concept. Create a premium cinematic 3D visual for SOFTECH, an internet gaming club management software landing page. No text, no letters, no logos, no UI. A spectacular sculptural monolithic gaming command tower, black chrome crystalline angular architecture floating over a dark geometric pedestal, with hot violet and magenta light spilling between fractured vertical plates and vivid electric chartreuse neon strips tracing its structural edges. Suggest futuristic computer/server architecture, elegant sharp machined surfaces, dense rich highlights, subtle volumetric haze. Black void background fading perfectly to near-black at edges. Hero artwork, very high-end contemporary digital art direction, dramatic low angle, centered three-quarter perspective composition, tower occupying upper center and right, generous dark space toward left, widescreen 3:2. Small glowing particle fragments and precision micro-details, not a cityscape, not a skull, not a character. Cinematic, editorial, beautifully lit, striking silhouette.
