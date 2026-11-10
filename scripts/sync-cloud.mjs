// Root cloud sources are canonical; the standalone deployment is a generated mirror.
// Only these source paths are managed. Credentials, config and databases are untouched.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const target = path.join(root, 'SoftechCloudAdmin');
const check = process.argv.includes('--check');
const managed = ['src', 'api', 'public', 'migrations', 'supabase_schema.sql', 'vercel.json'];
const differences = [];

function sync(relative) {
  const source = path.join(root, relative);
  const destination = path.join(target, relative);
  if (fs.statSync(source).isDirectory()) {
    for (const name of fs.readdirSync(source)) sync(path.join(relative, name));
    if (fs.existsSync(destination)) {
      for (const name of fs.readdirSync(destination)) {
        if (!fs.existsSync(path.join(source, name))) {
          // Do not silently delete unexpected files; require deliberate source cleanup.
          differences.push(`Unexpected mirror file: ${path.join(relative, name)}`);
        }
      }
    }
    return;
  }
  const bytes = fs.readFileSync(source);
  if (fs.existsSync(destination) && bytes.equals(fs.readFileSync(destination))) return;
  if (check) differences.push(relative);
  else {
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes);
    console.log(`Synced ${relative}`);
  }
}

for (const entry of managed) sync(entry);
if (differences.length) {
  console.error('Cloud mirror differs from root sources:\n' + differences.join('\n'));
  console.error('Run npm run sync:cloud after editing root cloud sources.');
  process.exitCode = 1;
} else console.log(check ? 'Cloud mirror is in sync.' : 'Cloud mirror synchronized.');
