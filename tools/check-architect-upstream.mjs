#!/usr/bin/env node

import { readFile } from 'node:fs/promises';

const snapshotUrl = new URL('../data/upstream/architect-mihomo-compat.json', import.meta.url);
const snapshot = JSON.parse(await readFile(snapshotUrl, 'utf8'));
const repo = snapshot.source.repository;
const ref = snapshot.source.branch || 'main';
const token = process.env.GITHUB_TOKEN || '';

const headers = {
  Accept: 'application/vnd.github+json',
  'User-Agent': 'link-generators-upstream-compat-check',
};
if (token) headers.Authorization = `Bearer ${token}`;

const changed = [];
const failed = [];

for (const [path, meta] of Object.entries(snapshot.source.files)) {
  const encodedPath = path.split('/').map(encodeURIComponent).join('/');
  const url = `https://api.github.com/repos/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`;
  try {
    const response = await fetch(url, { headers });
    if (!response.ok) {
      failed.push({ path, status: response.status, reason: response.statusText });
      continue;
    }
    const data = await response.json();
    const actual = data.sha;
    if (actual !== meta.blob_sha) {
      changed.push({ path, expected: meta.blob_sha, actual });
    }
  } catch (error) {
    failed.push({ path, reason: error instanceof Error ? error.message : String(error) });
  }
}

if (failed.length) {
  console.error('ARCHITECT_UPSTREAM_CHECK_ERROR');
  for (const item of failed) {
    console.error(`- ${item.path}: ${item.status ?? ''} ${item.reason}`.trim());
  }
  process.exit(3);
}

if (changed.length) {
  console.error('ARCHITECT_COMPAT_SOURCES_CHANGED');
  for (const item of changed) {
    console.error(`- ${item.path}`);
    console.error(`  stored: ${item.expected}`);
    console.error(`  current: ${item.actual}`);
  }
  console.error('Review the changed upstream files, independently verify material claims against current Mihomo/amneziawg-go, then update the snapshot intentionally.');
  process.exit(2);
}

console.log('ARCHITECT_COMPAT_SOURCES_UNCHANGED');
console.log(`source=${repo}@${ref}`);
console.log(`snapshot_checked_at=${snapshot.source.checked_at}`);
console.log(`files=${Object.keys(snapshot.source.files).length}`);
