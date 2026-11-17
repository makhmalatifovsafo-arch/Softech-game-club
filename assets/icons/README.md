# Softech application branding

`mark.svg` is the website's original vector symbol. Club applications use lime
`#c8ff31` on near-black `#090a0c`; Super Admin uses the inverse colors.

Rebuild on Windows without downloading anything:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File scripts/build-brand-icons.ps1
node scripts/sync-cloud.mjs
```

The generator creates padded, opaque PNG/SVG icons for the mobile applications
and nine-resolution ICO files for the client, server and launcher. Setup and
updater projects reference these same ICO files. PNG icons include 180px for
Apple home screens, plus 192px and 512px for web app manifests. The symbol stays
inside the maskable safe area.

Source changes take effect in Windows applications after rebuilding and shipping
the executable packages. Web application updates retain existing app identities;
the browser/OS controls when already installed home-screen icons refresh.
