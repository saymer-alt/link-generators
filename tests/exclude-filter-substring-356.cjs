'use strict';
// #356: test ONLY the current Builder's Exclude Filter semantics.
// This is Node + synthetic fixtures: no network, no user subscriptions, no Mihomo
// execution and no change to routing/defaults. Sub ON emulation below checks the
// emitted filter using JS RegExp; Mihomo's real exclude/override ordering remains
// NOT TESTED until a pinned runtime proof (#312).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runtime = fs.readFileSync(path.join(root, 'web4core.runtime.js'), 'utf8');

function exactSourceBetween(start, end) {
  const at = html.indexOf(start);
  assert.ok(at !== -1, 'Missing Builder source start: ' + start);
  assert.equal(html.indexOf(start, at + 1), -1, 'Ambiguous Builder source start: ' + start);
  const last = html.indexOf(end, at + start.length);
  assert.ok(last > at, 'Missing Builder source end: ' + end);
  return html.slice(at, last);
}

let manualInput = '';
const context = {
  document: {
    getElementById(id) {
      assert.equal(id, 'excludeFilterInput');
      return { value: manualInput };
    }
  }
};
vm.createContext(context);
vm.runInContext(
  'let subscriptionSelection = new Set();\n' +
  exactSourceBetween('function compileSubscriptionExcludeFilter(raw) {', 'function subscriptionLinkName(api, link) {') +
  exactSourceBetween('function escapeRegExpText(text) {', 'function renderServerList() {') +
  '\nfunction __setSubscriptionSelection(values) { subscriptionSelection = new Set(values); }\n',
  context, { timeout: 1500 }
);

function combined(selected, manual = '') {
  manualInput = manual;
  context.__setSubscriptionSelection(selected);
  const result = context.buildCombinedExcludeFilter(manual);
  assert.equal(result.error, '', 'unexpected invalid synthetic manual regex');
  return result.filter;
}

function regexForMode(mode, filter) {
  // Source contract: ON emits the raw filter for provider exclude-filter,
  // OFF applies the JS RegExp before subscription nodes are inlined.
  if (mode === 'ON') return context.compileCombinedExcludeFilter(filter);
  const parsed = context.compileSubscriptionExcludeFilter(filter);
  assert.equal(parsed.error, '');
  return parsed.regex;
}

assert.match(html, /excludeFilter:\s*\(subMode && combinedExclude\.filter\)\s*\?\s*combinedExclude\.filter\s*:\s*undefined/);
assert.match(html, /inspectSubscriptionInput\(api,\s*raw,\s*{\s*expand:\s*true,\s*filterRegex:\s*combinedExcludeRegex\s*}/);
assert.match(html, /const combinedExcludeRegex = combinedExclude\.filter \? compileSubscriptionExcludeFilter\(combinedExclude\.filter\)\.regex : null/);

// These are source-level presence checks, NOT evidence that Mihomo applies
// exclude-filter before or after override.additional-prefix at runtime.
assert.match(runtime, /providers\[providerName\]\["exclude-filter"\]\s*=\s*excludeFilter/);
assert.match(runtime, /"additional-prefix"\s*:\s*providerName\s*\+\s*": "/);

assert.equal(combined([], ''), '', 'no filter stays OFF');
assert.equal(combined([], '  ^A$  '), '^A$', 'manual-only regex is preserved after trimming');
assert.equal(combined(['A'], ''), '(?:A)', 'selected literal is intentionally UNANCHORED');
assert.equal(combined(['A[1]'], ''), '(?:A\\[1\\])', 'regex brackets must be escaped');
assert.equal(combined(['A+B'], ''), '(?:A\\+B)', 'regex plus must be escaped');
assert.equal(combined(['Hysteria 2 | Германия'], ''), '(?:Hysteria 2 \\| Германия)', 'pipe must be literal');
assert.equal(combined(['A'], '^B$'), '(?:^B$)|(?:A)', 'manual OR selected stays intact');
assert.equal(combined(['A'], '(?i)ger'), '(?i)(?:ger)|(?:A)', 'manual flags apply to combined regex');
context.__setSubscriptionSelection(['A']);
assert.match(context.buildCombinedExcludeFilter('[').error, /Exclude Filter/);

const cases = [
  { selected: 'A', name: 'A', expected: true, note: 'selected exact name' },
  { selected: 'A', name: 'A-extra', expected: true, note: 'UNINTENDED substring overmatch' },
  { selected: 'A', name: 'provider: A', expected: true, note: 'prefixed name still matches A substring' },
  { selected: 'A', name: 'B', expected: false, note: 'unrelated name' },
  { selected: 'Hysteria 2 | Германия', name: 'Hysteria 2 | Германия', expected: true, note: 'Unicode + literal pipe' },
  { selected: 'Hysteria 2 | Германия', name: 'Hysteria 2 x Германия', expected: false, note: 'literal pipe not regex OR' },
  { selected: 'A[1]', name: 'A[1]', expected: true, note: 'literal brackets' },
  { selected: 'A[1]', name: 'A1', expected: false, note: 'brackets not regex class' },
  { selected: 'A[1]', name: 'A[1]-extra', expected: true, note: 'meta literal is still substring' },
  { selected: 'A+B', name: 'A+B', expected: true, note: 'literal plus' },
  { selected: 'A+B', name: 'AAAB', expected: false, note: 'plus not regex quantifier' },
  { selected: 'A+B', name: 'prefix A+B', expected: true, note: 'literal in prefixed name' }
];
let assertions = 0;
for (const mode of ['ON', 'OFF']) {
  for (const t of cases) {
    const filter = combined([t.selected]);
    const rx = regexForMode(mode, filter);
    assert.equal(rx.test(t.name), t.expected, 'Sub ' + mode + ': ' + t.note + ' [' + t.name + ']');
    assertions++;
  }
  const mixed = regexForMode(mode, combined(['A'], '^B$'));
  assert.equal(mixed.test('B'), true, 'manual branch survives in Sub ' + mode);
  assert.equal(mixed.test('A-extra'), true, 'selection branch survives in Sub ' + mode);
  assert.equal(mixed.test('C'), false);
  assertions += 3;
  const caseInsensitive = regexForMode(mode, combined(['A'], '(?i)ger'));
  assert.equal(caseInsensitive.test('GER'), true);
  assert.equal(caseInsensitive.test('a-extra'), true, 'manual (?i) flags also affect selected alternatives');
  assertions += 2;
}

// Preview must count actual regex hits (including overmatches), with no
// duplicate node count and no double-count between manual and selection.
combined(['A'], 'extra');
const stats = context.serverListExclusionBreakdown(['A', 'A-extra', 'provider: A', 'B-extra', 'B', 'A']);
assert.equal(stats.unique, 5);
assert.equal(stats.selected, 3);
assert.equal(stats.manual, 2);
assert.equal(stats.overlap, 1);
assert.equal(stats.total, 4);
assert.equal(context.serverListCountExcluded(['A', 'A-extra', 'provider: A', 'B-extra', 'B', 'A']), 4);
assertions += 6;

console.log('exclude-filter #356: PASS (' + assertions + ' mode/fixture/preview assertions + source contracts)');
console.log('Semantic verdict: selected names are regex LITERAL SUBSTRINGS, not ^name$ exact matches.');
console.log('Mihomo provider override.additional-prefix ordering: NOT TESTED (needs runtime #312).');
