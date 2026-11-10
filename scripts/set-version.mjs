import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
process.chdir(fileURLToPath(new URL('../', import.meta.url)));
const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version || '')) throw new Error('Usage: node scripts/set-version.mjs 1.0.19');
for (const file of ['package.json', 'NetCafeServer/package.json', 'SoftechCloudAdmin/package.json']) {
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  data.version = version;
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
}
const lock = JSON.parse(fs.readFileSync('package-lock.json', 'utf8'));
lock.version = lock.packages[''].version = version;
fs.writeFileSync('package-lock.json', JSON.stringify(lock, null, 2) + '\n');
fs.writeFileSync('Directory.Build.props', `<Project>\n  <PropertyGroup>\n    <Version>${version}</Version>\n    <AssemblyVersion>${version}.0</AssemblyVersion>\n    <FileVersion>${version}.0</FileVersion>\n  </PropertyGroup>\n</Project>\n`);
console.log('All component source versions set to ' + version + '. Release manifests are generated from built artifacts.');
