// Keep deployment assets reproducible in both cloud roots. Only static website
// files are published; Sites metadata, source scripts and credentials stay out.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function syncWebsite({ check = false } = {}) {
  const differences = [];
  let changed = 0;
  function copy(source, destination) {
    const from = path.join(root, source), to = path.join(root, destination);
    if (fs.statSync(from).isDirectory()) {
      for (const name of fs.readdirSync(from)) copy(path.join(source, name), path.join(destination, name));
      if (fs.existsSync(to)) for (const name of fs.readdirSync(to)) {
        if (!fs.existsSync(path.join(from, name))) differences.push(`Unexpected generated file: ${path.join(destination, name)}`);
      }
      return;
    }
    const bytes = fs.readFileSync(from);
    if (fs.existsSync(to) && bytes.equals(fs.readFileSync(to))) return;
    if (check) differences.push(destination);
    else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, bytes); changed++; }
  }
  copy('website/softech/dist', 'public/site');
  copy('website/softech/dist/assets/mark.svg', 'NetCafeServer/public/brand-mark.svg');
  // These website assets contain TrueType data despite their historical .woff2 names.
  for (const destination of ['Shared/Branding/Fonts', 'NetCafeServer/public/fonts']) {
    copy('website/softech/dist/assets/font-7.woff2', `${destination}/Manrope-ExtraBold.ttf`);
    copy('website/softech/dist/assets/Manrope-LICENSE.txt', `${destination}/Manrope-LICENSE.txt`);
  }
  if (differences.length) throw Error('Website/branding copies differ:\n' + differences.join('\n') + '\nRun npm run sync:cloud.');
  console.log(check ? 'Website and branding assets are in sync.' : `Website and branding synchronized (${changed} files updated).`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  syncWebsite({ check: process.argv.includes('--check') });
}
