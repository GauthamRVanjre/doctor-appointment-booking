import fs from 'node:fs';
import path from 'node:path';

const projectRoot = process.cwd();
const envPath = path.join(projectRoot, '.env.local');
const envExamplePath = path.join(projectRoot, 'env.local.example');

function fail(message) {
  console.error(message);
  process.exit(1);
}

const [majorVersion, minorVersion] = process.versions.node.split('.').map(Number);
if (Number.isNaN(majorVersion) || majorVersion < 24 || (majorVersion === 24 && minorVersion < 10)) {
  fail(`Node.js 24.10 or newer is required for local SQLite booking. Current version: ${process.versions.node}`);
}

if (!process.env.npm_config_user_agent?.includes('pnpm')) {
  fail('Run this repo with pnpm so installs and scripts stay consistent.');
}

if (!fs.existsSync(envExamplePath)) {
  fail('Missing env.local.example. Restore the tracked template before continuing.');
}

if (!fs.existsSync(envPath)) {
  fail('Missing .env.local. Copy env.local.example to .env.local before running the app.');
}

const envContents = fs.readFileSync(envPath, 'utf8');
for (const key of ['NEXT_PUBLIC_AGORA_APP_ID', 'NEXT_AGORA_APP_CERTIFICATE']) {
  const matcher = new RegExp(`^${key}=.+$`, 'm');
  if (!matcher.test(envContents)) {
    fail(`.env.local is missing a value for ${key}`);
  }
}

console.log('Doctor checks passed');
