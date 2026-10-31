'use strict';
// #280 — read-only parser contract for portable .lgproject.json v2.
// Synthetic values only. No real subscription links, HWIDs, or network calls.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const vm = require('node:vm');
const inlineScripts = [...html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]).filter(Boolean);
assert.ok(inlineScripts.length, 'inline script exists');
for (const code of inlineScripts) assert.doesNotThrow(
  () => new vm.Script(code, {filename:'index.html inline'}),
  'full inline Browser JS must parse, not only the isolated RB-CORE segment'
);
const start = html.indexOf('// === REVERSE BUILD CORE (OWNER-REVERSE-01, PR B) — RB-CORE-START ===');
const end = html.indexOf('// === REVERSE BUILD CORE — RB-CORE-END ===', start);
assert.ok(start >= 0 && end > start, 'RB-CORE markers found');
const api = new Function(html.slice(start, end) + '\nreturn {rbParseProjectText, rbValidateProject, rbMigrateProject};')();

const H1 = '11111111111111111111111111111111';
const H2 = '22222222222222222222222222222222';
const U = ['https://a.example.invalid/feed', 'https://b.example.invalid/feed', 'https://c.example.invalid/feed'];
const base = () => ({
  schemaVersion: 1,
  sources: {subMode: true, mainInput: U.join('\n'), fallbackInput: '', autoWhitelist: false},
  wgProfiles: [],
  options: {profile: 'vps-local'},
  dialer: {name: '', members: '', providers: ''},
  domainPolicy: {enabled: false, cards: []},
  tiered: {enabled: false, cards: []}
});
const portable = () => ({
  ...base(),
  schemaVersion: 2,
  sources: {
    ...base().sources,
    subscriptionSources: U.map((url, i) => ({sourceId: 'src-' + (i + 1), url}))
  },
  identities: {
    defaultId: 'id-primary',
    entries: [
      {id: 'id-primary', label: 'Primary', hwid: H1},
      {id: 'id-second', label: 'Secondary', hwid: H2}
    ],
    providerBindings: [
      {sourceId: 'src-1', identityId: 'id-primary'},
      {sourceId: 'src-2', identityId: 'id-second'},
      {sourceId: 'src-3', identityId: 'id-second'}
    ]
  }
});
const parse = p => api.rbParseProjectText(JSON.stringify(p));
let checks = 0;
function valid(p, version, status) {
  const result = parse(p);
  assert.equal(result.ok, true, result.error || '');
  assert.equal(result.project.schemaVersion, version);
  assert.equal(result.identityStatus, status);
  checks++;
  return result;
}
function invalid(name, mutate, match) {
  const p = portable();
  mutate(p);
  const result = parse(p);
  assert.equal(result.ok, false, name + ' unexpectedly accepted');
  assert.match(result.error, match, name);
  // Fail-closed errors are always symbolic; no user-provided secret leaked.
  assert.ok(!result.error.includes(U[0]) && !result.error.includes(U[1]) &&
            !result.error.includes(U[2]) && !result.error.includes(H1) &&
            !result.error.includes(H2), name + ' leaked sensitive data');
  checks++;
}
const fresh = valid(portable(), 2, 'PORTABLE_V2_VALIDATED_ONLY');
assert.deepEqual(fresh.project.identities.providerBindings.map(
  v => fresh.project.identities.entries.find(e => e.id === v.identityId).hwid), [H1, H2, H2]);
assert.deepEqual(parse(fresh.project), fresh, 'canonical read-only v2 must round-trip');
valid(base(), 1, 'LEGACY_IDENTITY_MISSING');
const experimentalV2 = {...base(), schemaVersion: 2};
const migrated = valid(experimentalV2, 1, 'LEGACY_IDENTITY_MISSING');
assert.deepEqual(parse(migrated.project), migrated, 'old experimental v2 round-trip');
assert.equal(Object.hasOwn(migrated.project, 'identities'), false, 'no fabricated identity on legacy migration');
const noSubs = portable();
noSubs.sources = {...noSubs.sources, subMode: false, mainInput: 'ss://example', subscriptionSources: []};
noSubs.identities.providerBindings = [];
noSubs.identities.entries = [noSubs.identities.entries[0]];
valid(noSubs, 2, 'PORTABLE_V2_VALIDATED_ONLY');

invalid('missing identities', p => {delete p.identities;}, /identities.*required/);
invalid('partial v2 has no identity registry', p => {delete p.identities; p.sources.subscriptionSources[0].sourceId = 'extra';}, /identities.*required/);
invalid('missing subscriptionSources', p => {delete p.sources.subscriptionSources;}, /subscriptionSources.*required/);
invalid('arrays wrong type', p => {p.identities.entries = {};}, /arrays required/);
invalid('duplicate sourceId', p => {p.sources.subscriptionSources[1].sourceId = 'src-1';}, /sourceId must be unique/);
invalid('duplicate identityId', p => {p.identities.entries[1].id = 'id-primary';}, /id must be unique/);
invalid('missing default identity', p => {p.identities.defaultId = 'missing';}, /defaultId: not found/);
invalid('wrong source URL', p => {p.sources.subscriptionSources[1].url = 'https://evil.example.invalid/secret';}, /URL\/order mismatch/);
invalid('changed source order', p => {p.sources.subscriptionSources.reverse();}, /URL\/order mismatch/);
invalid('duplicate HTTP URL', p => {p.sources.mainInput = [U[0], U[0], U[2]].join('\n'); p.sources.subscriptionSources[1].url = U[0];}, /duplicate provider URL/);
invalid('unknown identity ref', p => {p.identities.providerBindings[1].identityId = 'missing';}, /unknown identity/);
invalid('duplicate bound source', p => {p.identities.providerBindings[1].sourceId = 'src-1';}, /duplicate source reference/);
invalid('missing binding', p => {p.identities.providerBindings.pop();}, /count mismatch/);
invalid('orphan identity', p => {p.identities.providerBindings[2].identityId = 'id-primary'; p.identities.providerBindings[1].identityId = 'id-primary';}, /unused identity/);
invalid('bad HWID', p => {p.identities.entries[1].hwid = 'secret/unsafe';}, /invalid HWID/);
invalid('bad label', p => {p.identities.entries[1].label = '  ';}, /invalid label/);
invalid('unknown source field', p => {p.sources.subscriptionSources[0].token = 'sensitive';}, /unknown field/);
invalid('unknown identity field', p => {p.identities.entries[0].secret = 'sensitive';}, /unknown field/);
invalid('unknown registry field', p => {p.identities.localStorage = 'bad';}, /unknown field/);
invalid('non Sub Mode with providers', p => {p.sources.subMode = false;}, /subscription count mismatch/);
invalid('too many entries', p => {p.identities.providerBindings = new Array(513).fill({sourceId:'src-1',identityId:'id-primary'});}, /exceeds limit/);

const v1WithIdentity = base();
v1WithIdentity.identities = portable().identities;
assert.match(parse(v1WithIdentity).error, /schemaVersion 2/, 'v1 must not silently discard new identities');
checks++;
const future = base(); future.schemaVersion = 99;
assert.equal(parse(future).ok, false, 'future schema must fail');
checks++;
const suspicious = JSON.stringify(portable()).replace('"identities":{', '"identities":{"__proto__":{},');
assert.match(api.rbParseProjectText(suspicious).error, /недопустимый ключ/, 'unsafe object keys must fail');
checks++;
assert.equal(api.rbParseProjectText(' '.repeat(4 * 1024 * 1024 + 1)).ok, false, 'bounded project size');
checks++;
const p2 = portable();
p2.sources.mainInput = 'https://user:pass@a.example.invalid/feed\n'+U.slice(1).join('\n');
assert.equal(parse(p2).ok, false, 'credentialed HTTP URL not mapped as provider');
checks++;
console.log('PASS project-identities-v2: ' + checks + ' synthetic read-only schema/legacy cases');
