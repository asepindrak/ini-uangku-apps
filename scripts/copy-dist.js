import fs from 'node:fs';
import path from 'node:path';

const src = path.resolve('dist');
const dest = path.resolve('server/public_html');

if (fs.existsSync(src)) {
  if (fs.existsSync(dest)) {
    fs.rmSync(dest, { recursive: true, force: true });
  }
  fs.cpSync(src, dest, { recursive: true });
  console.log('✅ Synchronized dist -> server/public_html for Web App deployment');
}
