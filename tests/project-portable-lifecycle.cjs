'use strict';
// Pure project identity lifecycle (#280). All subscriptions/HWIDs synthetic.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const begin = html.indexOf('// === REVERSE BUILD CORE (OWNER-REVERSE-01, PR B) — RB-CORE-START ===');
const end = html.indexOf('// === REVERSE BUILD CORE — RB-CORE-END ===', begin);
assert.ok(begin >= 0 && end > begin);
const api = new Function(html.slice(begin, end) + '\nreturn {rbParseProjectText,rbPortableFromLegacy,rbPortableReorder,rbPortableAssign,rbPortableAddAndAssign,rbPortableEngineOptions};')();

const H1 = '11111111111111111111111111111111';
const H2 = '22222222222222222222222222222222';
const U = ['https://a.example.invalid/feed', 'https://b.example.invalid/feed', 'https://c.example.invalid/feed'];
const first = {id: 'dev-local', label: 'Local', hwid: H1, createdAt: '2026-10-19T00:00:00Z'};
const second = {id: 'dev-other', label: 'Other', hwid: H2};
const v1 = () => ({
  schemaVersion: 1,
  sources: {subMode: true, mainInput: U.join('\n'), fallbackInput:'',autoWhitelist:false},
  options: {profile:'vps-local'},wgProfiles:[],
  dialer: {name:'',members:'',providers:''},
  domainPolicy: {enabled:false,cards:[]},tiered:{enabled:false,cards:[]}
});
const snapshot = v => JSON.stringify(v);
const success = (res, context) => {
  assert.equal(res.ok, true, context + ': ' + (res.error || ''));
  return res.project;
};
const failure = (res, context) => {
  assert.equal(res.ok, false, context + ': unexpected success');
  assert.ok(res.error && typeof res.error === 'string', context + ': error missing');
  for (const secret of [H1,H2,...U,first.id,second.id])
    assert.equal(res.error.includes(secret), false, context + ': secret leaked');
};

const original = v1();
const originalHash = snapshot(original);
const v2 = success(api.rbPortableFromLegacy(original,first),'v1 → v2');
assert.equal(snapshot(original), originalHash, 'source v1 stays immutable');
assert.equal(v2.schemaVersion,2);
assert.deepEqual(v2.sources.subscriptionSources.map(x=>x.sourceId),['src-1','src-2','src-3']);
assert.deepEqual(v2.identities.entries,[{id:first.id,label:first.label,hwid:H1}]);
assert.equal('createdAt' in v2.identities.entries[0],false,'no unrelated browser registry metadata exported');
assert.equal(v2.identities.providerBindings.length,3);
assert.equal(api.rbParseProjectText(snapshot(v2)).ok,true,'v2 round-trip');

const two = success(api.rbPortableAddAndAssign(v2,'src-2',second),'assign second identity atomically');
const three = success(api.rbPortableAssign(two,'src-3',second.id),'share second identity');
const engine=api.rbPortableEngineOptions(three);
assert.equal(engine.ok,true);
assert.equal(engine.options.deviceHwid,H1);
assert.deepEqual(engine.options.providerOverrides.map(x=>x.hwid),[H1,H2,H2]);
assert.deepEqual(engine.options.providerOverrides.map(x=>x.sourceUrl),U);
assert.equal(snapshot(v2),snapshot(success(api.rbPortableFromLegacy(original,first),'repeat deterministic')),'v1 conversion deterministic');
assert.deepEqual(api.rbPortableEngineOptions(three),api.rbPortableEngineOptions(three),'stable rebuild');

const reorderedRaw = [U[2],'ss://synthetic-direct-link',U[0],U[1]].join('\n');
const reordered=success(api.rbPortableReorder(three,reorderedRaw),'reorder');
assert.deepEqual(reordered.sources.subscriptionSources.map(x=>x.sourceId),['src-3','src-1','src-2']);
assert.deepEqual(api.rbPortableEngineOptions(reordered).options.providerOverrides.map(x=>x.hwid),[H2,H1,H2]);
assert.equal(snapshot(three), snapshot(success(api.rbPortableAssign(three,'src-3',second.id),'unchanged')),
  'rebind same id is stable');
assert.equal(api.rbParseProjectText(snapshot(reordered)).ok,true,'reordered v2 round-trip');

failure(api.rbPortableReorder(three,U.slice(0,2).join('\n')),'deleted source must not silently reassign');
failure(api.rbPortableReorder(three,[U[0],U[0],U[2]].join('\n')),'duplicate URL ambiguity');
failure(api.rbPortableReorder(three,[U[0],'https://new.example.invalid/feed',U[2]].join('\n')),'new source needs explicit binding');
failure(api.rbPortableReorder(three,undefined),'nonstring');
failure(api.rbPortableAssign(three,'missing',second.id),'unknown source');
failure(api.rbPortableAssign(three,'src-1','missing'),'unknown identity');
failure(api.rbPortableAssign(two,'src-2',first.id),'orphan identity cannot be silently removed');
failure(api.rbPortableAddAndAssign(three,'src-2',second),'no duplicate identities');
failure(api.rbPortableAddAndAssign(three,'missing',{id:'dev-third',label:'Third',hwid:H2}),'new identity needs known source');
failure(api.rbPortableAddAndAssign(three,'src-2',{id:'dev-third',label:'Third',hwid:'too-short'}),'invalid HWID');
failure(api.rbPortableFromLegacy(original,{...first,extra:'private-from-local-registry'}),'do not export extra registry fields');
failure(api.rbPortableFromLegacy(original,{id:'dev-2',hwid:'short',label:'Bad'}),'invalid legacy hwid');
failure(api.rbPortableFromLegacy({...original,schemaVersion:99},first),'invalid version');
failure(api.rbPortableFromLegacy({...original,sources:{...original.sources,mainInput:[U[0],U[0]].join('\n')}},first),'duplicate source URL');
assert.equal(snapshot(three),snapshot(success(api.rbPortableAssign(three,'src-2',second.id),'idempotent')),
  'identity mutation must not occur from any negative op');
assert.equal(snapshot(v2),snapshot(api.rbParseProjectText(snapshot(v2)).project),'portable state round-trip byte-equivalent');
const emptyV1=v1();emptyV1.sources={...emptyV1.sources,subMode:false,mainInput:'ss://synthetic'};
const empty=success(api.rbPortableFromLegacy(emptyV1,first),'Sub OFF project');
assert.deepEqual(empty.sources.subscriptionSources,[]);
assert.deepEqual(api.rbPortableEngineOptions(empty).options.providerOverrides,[]);
assert.equal(api.rbPortableEngineOptions(empty).options.deviceHwid,H1);
console.log('PASS project-portable-lifecycle: explicit conversion, immutable identities, stable reorder, A=H1 B=C=H2, failures redacted');
