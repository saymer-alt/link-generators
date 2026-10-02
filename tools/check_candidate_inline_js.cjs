const fs = require('node:fs');
const html = fs.readFileSync('index.html', 'utf8');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
if (!scripts.length) throw new Error('No inline scripts found');
const code = scripts[scripts.length - 1][1];
fs.writeFileSync('/tmp/link-generators-inline.js', code);
try {
  new Function(code);
  console.log('Inline JS syntax: PASS, chars=' + code.length);
} catch (e) {
  console.error('Inline JS syntax: FAIL');
  console.error(e && e.stack ? e.stack : e);
  process.exit(1);
}
