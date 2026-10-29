// tsc only emits .ts files; the worker thread script is plain JS, copy it next to the build.
const fs = require('node:fs');
const path = require('node:path');
const src = path.join(__dirname, '..', 'src', 'workers');
const dst = path.join(__dirname, '..', 'dist', 'workers');
fs.mkdirSync(dst, { recursive: true });
for (const f of fs.readdirSync(src)) if (f.endsWith('.js')) fs.copyFileSync(path.join(src, f), path.join(dst, f));
console.log('copied worker assets');
