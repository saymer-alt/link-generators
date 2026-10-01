#!/usr/bin/env node
// Secret scanner for the field-test tool directory. Runs in CI (offline job)
// and locally before committing: fails on real-looking credentials in any file
// of this directory. Fixture/base64 placeholders used by the project tests are
// allow-listed.
'use strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('.', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const ALLOWED_KEYS = new Set([
  // project synthetic fixtures (public test keys, also in tests/fixtures)
  'AQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQEBAQE=',
  'AgICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgI=',
  'AwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwMDAwM=',
  'bmXOC+F1FxEMF9dyiK2H5/1SUtzH0JuVo51h2wPfgyo=', // Cloudflare WARP well-known peer key
]);

const findings = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) { walk(p); continue; }
    const text = readFileSync(p, 'utf8');
    const lines = text.split('\n');
    lines.forEach((line, i) => {
      const at = `${p}:${i + 1}`;
      // WARP-style private keys (44-char padded base64) outside the allowlist
      const key = line.match(/(?:private-key|PrivateKey)\s*[=:]\s*([A-Za-z0-9+/]{43}=)/);
      if (key && !ALLOWED_KEYS.has(key[1])) findings.push(`${at}: real-looking private key`);
      // subscription URLs carrying tokens/credentials (ALL-CAPS values are
      // recognized placeholders used by the redaction unit tests)
      const credUrl = line.match(/https?:\/\/[^\s"'<>]*[?&](?:token|key|password|secret|auth)=([^\s"'<>&]+)/i);
      if (credUrl && !/^[A-Z0-9_]+$/.test(credUrl[1]) && !line.includes('[redacted]') && !line.includes('YOUR_')) {
        findings.push(`${at}: URL with credential query parameter`);
      }
      // password fields with non-placeholder values
      const pwd = line.match(/password\s*[=:]\s*["']?([^"'\s]{4,})/i);
      if (pwd && !/^(pass|REPLACE|your_|example|\$\{)/i.test(pwd[1])) findings.push(`${at}: literal password`);
      // the tool never needs a subscription/VCS raw URL committed: flag any of them
      if (/raw\.githubusercontent\.com|gist\.githubusercontent\.com/i.test(line)) {
        findings.push(`${at}: subscription/VCS raw URL embedded`);
      }
    });
  }
};
walk(DIR);
if (findings.length) {
  console.error('SECRET SCAN FAILED:');
  for (const f of findings) console.error('  ' + f);
  process.exit(1);
}
console.log('secret scan: clean');
