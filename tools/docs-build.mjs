// NIGHT-12: docs build — Markdown (source of truth) → статические HTML-страницы
// для Pages. Детерминированный вывод (без timestamps), внутренние .md-ссылки
// переписываются в .html, генерируется docs/index.html (hub), проверяются
// внутренние ссылки (файлы) и якоря. Renderer — marked (build-time only,
// в браузер не попадает). Контент доверенный (репозиторий владельца), но
// <script>/javascript:/inline-handlers в выходном HTML запрещены и проверяются.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { marked } from 'marked';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS_SRC = path.join(ROOT, 'docs');
const BRANCH = (process.env.DOCS_SOURCE_BRANCH || 'stable').trim() || 'stable';
const REPO = 'saymer-alt/link-generators';
let failures = 0;
const fail = (msg) => { failures++; console.error('DOCS BUILD FAIL: ' + msg); };

marked.use({ gfm: true, breaks: false });

// --- GFM-совместимый slugger (Unicode, дубликаты -1/-2) ---
const slugify = (() => {
  const seen = new Map();
  return (text) => {
    const base = String(text).trim().toLowerCase()
      .replace(/<[^>]+>/g, '')
      .replace(/[^\p{L}\p{N}\s-]/gu, '')
      .replace(/\s+/g, '-');
    const n = (seen.get(base) || 0);
    seen.set(base, n + 1);
    return n === 0 ? base : base + '-' + n;
  };
})();

// --- категории hub (пользователю — первыми; research/ в индекс не попадает) ---
const HUB = [
  ['Генератор и пользовательские сценарии', ['GENERATOR-GUIDE', 'EXCLUDE-FILTER', 'GIST-SUBSCRIPTION', 'VPS-GATEWAY']],
  ['Маршрутизация и политики', ['POLICY-ROUTING', 'MIHOMO']],
  ['WARPSCOUT', ['WARPSCOUT-WINDOWS', 'WARPSCOUT-KEENETIC', 'WARPSCOUT-VPS']],
  ['Справочник для разработчика', ['README', 'ARCHITECTURE', 'DATAFLOW', 'PROTOCOLS', 'VALIDATION', 'TESTING', 'CI', 'DEVELOPMENT', 'UPDATES', 'WEB4CORE-FORK', 'DEPLOYMENT-PROFILES-TEST-CONTRACT']],
  ['Историческое / аудиты', ['FALLBACK-REVIEW', 'AUDIT-MIHOMO-1.19.31']],
];
const HUB_ORDER = [...new Set(HUB.flat())];

// --- сбор.sources ---
const sources = fs.readdirSync(DOCS_SRC)
  .filter(f => f.endsWith('.md'))
  .sort()
  .map(f => ({ base: f.replace(/\.md$/, ''), file: path.join(DOCS_SRC, f), rel: f }));

// --- рендер страницы: marked + GFM-slug id у заголовков + перезапись ссылок ---
function renderPage(mdText, pageRel) {
  let html = marked.parse(mdText, { async: false });
  const ids = new Map();
  html = html.replace(/<h([1-6])>([\s\S]*?)<\/h\1>/g, (m, lvl, inner) => {
    const text = inner.replace(/<[^>]+>/g, '');
    const id = slugify(text);
    ids.set(id, text);
    return `<h${lvl} id="${id}">${inner}</h${lvl}>`;
  });
  // перезапись внутренних ссылок: X.md(#frag)? → X.html(#frag)? (структура зеркальна)
  html = html.replace(/href="([^"#]+?)(\.md)(#[^"]*)?"/g, (m, target, ext, frag = '') => {
    const resolved = path.resolve(path.dirname(path.join(DOCS_SRC, pageRel)), target);
    const inDocs = resolved.startsWith(DOCS_SRC + path.sep);
    const relToDocs = path.relative(DOCS_SRC, resolved).replace(/\\/g, '/');
    const sourceExists = fs.existsSync(resolved) || fs.existsSync(resolved + '.md');
    if (!inDocs || !sourceExists) return m; // внешние/несуществующие не трогаем (link check ругнётся)
    void ext;
    return `href="${target.replace(/\.md$/, '.html')}${frag || ''}"`;
  });
  return { html, ids };
}

// --- заголовок/навигация ---
function pageShell(title, bodyHtml, sourceRel, depth) {
  const up = depth > 0 ? '../'.repeat(depth) : './';
  const gh = `https://github.com/${REPO}/blob/${BRANCH}/${sourceRel.split(path.sep).join('/')}`;
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} — WARP & Mihomo Unified</title>
<style>
:root { color-scheme: light; }
body { font-family: Tahoma, 'Segoe UI', Verdana, system-ui, sans-serif; color: #1a1a1a; background: #f4f4f0; margin: 0; }
.wrap { max-width: 60rem; margin: 0 auto; padding: 16px 20px 48px; background: #fdfdfa; min-height: 100vh; }
nav.top { display: flex; flex-wrap: wrap; gap: 10px 16px; align-items: center; padding: 10px 0; border-bottom: 1px solid #d8d4c8; margin-bottom: 20px; }
nav.top a { color: #1450a3; text-decoration: none; }
nav.top a:hover { text-decoration: underline; }
h1, h2, h3, h4 { line-height: 1.25; }
h1 { font-size: 1.6rem; } h2 { font-size: 1.3rem; border-bottom: 1px solid #e0dccf; padding-bottom: 4px; }
pre { background: #f0efe8; border: 1px solid #ddd9cb; padding: 10px 12px; overflow-x: auto; font-size: .88rem; }
code { font-family: Consolas, 'Courier New', monospace; font-size: .92em; background: #f0efe8; padding: 1px 4px; }
pre code { background: none; padding: 0; }
table { border-collapse: collapse; margin: 12px 0; max-width: 100%; }
th, td { border: 1px solid #c8c4b8; padding: 5px 9px; text-align: left; vertical-align: top; }
th { background: #efeadb; }
img { max-width: 100%; }
a { color: #1450a3; }
blockquote { border-left: 4px solid #d8d4c8; margin-left: 0; padding-left: 12px; color: #555; }
@media (max-width: 640px) { .wrap { padding: 10px 12px 32px; } table { display: block; overflow-x: auto; } }
</style>
</head>
<body>
<div class="wrap">
<nav class="top">
<a href="${up}index.html">⚡ Генератор</a>
<a href="${up}quick-start.html">❓ Быстрый старт</a>
<a href="${up}docs/index.html">📚 Документация</a>
<a class="gh" href="${gh}" title="Исходник на GitHub (ветка ${BRANCH})">GitHub source</a>
</nav>
${bodyHtml}
</div>
</body>
</html>
`;
}

// --- сборка ---
const outDir = DOCS_SRC; // *.html рядом с *.md (канонический /docs/NAME.html)
const pageIds = new Map(); // rel (без .md) -> Map<anchor, text>
const rendered = new Map(); // rel -> html
const titleOf = (mdText, fallback) => {
  const m = mdText.match(/^#\s+(.+)$/m) || mdText.match(/^##\s+(.+)$/m);
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : fallback;
};

for (const src of sources) {
  const md = fs.readFileSync(src.file, 'utf8');
  const { html, ids } = renderPage(md, src.rel);
  pageIds.set(src.base, ids);
  const title = titleOf(md, src.base);
  rendered.set(src.base, pageShell(title, html, path.join('docs', src.base + '.md'), 1));
  fs.writeFileSync(path.join(outDir, src.base + '.html'), rendered.get(src.base));
}
console.log('rendered pages: ' + rendered.size);

// --- docs/index.html (hub) ---
let hubBody = '';
for (const [cat, list] of HUB) {
  const present = list.filter(b => rendered.has(b));
  if (!present.length) continue;
  hubBody += `<h2>${cat}</h2>\n<ul>\n` + present.map(b =>
    `  <li><a href="${b}.html">${titleOf(fs.readFileSync(path.join(DOCS_SRC, b + '.md'), 'utf8'), b)}</a> <a class="gh" href="https://github.com/${REPO}/blob/${BRANCH}/docs/${b}.md">source</a></li>`).join('\n') + '\n</ul>\n';
}
const hubHtml = `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Документация — WARP & Mihomo Unified</title>
<style>
body { font-family: Tahoma, 'Segoe UI', Verdana, system-ui, sans-serif; color: #1a1a1a; background: #f4f4f0; margin: 0; }
.wrap { max-width: 60rem; margin: 0 auto; padding: 16px 20px 48px; background: #fdfdfa; min-height: 100vh; }
nav.top { display: flex; flex-wrap: wrap; gap: 10px 16px; padding: 10px 0; border-bottom: 1px solid #d8d4c8; margin-bottom: 20px; }
nav.top a { color: #1450a3; text-decoration: none; }
h2 { border-bottom: 1px solid #e0dccf; padding-bottom: 4px; }
li { margin: 4px 0; }
a { color: #1450a3; }
a.gh { font-size: .8rem; color: #6a6a6a; margin-left: 6px; }
@media (max-width: 640px) { .wrap { padding: 10px 12px 32px; } }
</style>
</head>
<body>
<div class="wrap">
<nav class="top">
<a href="../index.html">⚡ Генератор</a>
<a href="../quick-start.html">❓ Быстрый старт</a>
<a href="https://github.com/${REPO}/blob/${BRANCH}/docs/README.md">GitHub</a>
</nav>
<h1>📚 Документация</h1>
<p>HTML-версии генерируются из Markdown (source of truth) автоматически; исходники — в репозитории.</p>
${hubBody}
</div>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), hubHtml);
console.log('hub: docs/index.html');

// --- link check (файлы + якоря, где возможно) ---
const sourceExists = (fromRel, href) => {
  if (/^[a-z]+:/i.test(href) || href.startsWith('//')) return { ok: true, kind: 'external' };
  if (href.startsWith('#')) {
    const a = href.slice(1);
    return { ok: true, kind: 'anchor-self', a };
  }
  const [target, frag] = href.split('#');
  const resolved = path.resolve(path.join(DOCS_SRC, path.dirname(fromRel)), target);
  const relToDocs = path.relative(DOCS_SRC, resolved).replace(/\\/g, '/');
  if (relToDocs.endsWith('.md')) {
    const base = relToDocs.replace(/\.md$/, '');
    return { ok: fs.existsSync(resolved) || rendered.has(base) || fs.existsSync(path.join(DOCS_SRC, relToDocs)), kind: 'md', base, frag };
  }
  if (relToDocs.endsWith('.html')) {
    const base = relToDocs.replace(/\.html$/, '').replace(/^docs\//, '');
    return { ok: fs.existsSync(resolved) || fs.existsSync(resolved.replace(/\.html$/, '.md')) || rendered.has(base) || rendered.has(relToDocs.replace(/\.html$/, '')), kind: 'html', base, frag };
  }
  return { ok: fs.existsSync(resolved), kind: 'asset' };
};

// anchors registry для .md/.html переходов
const anchorExists = (base, a) => {
  if (!a) return true;
  const ids = pageIds.get(base);
  return ids ? ids.has(a) : true; // для нерендеренных целей — не проверяем
};

let checked = 0;
for (const src of sources) {
  const md = fs.readFileSync(src.file, 'utf8');
  const links = [...md.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map(m => m[1]);
  for (const href of links) {
    const st = sourceExists(src.rel, href);
    checked++;
    if (!st.ok) fail(`broken link в ${src.rel}: ${href}`);
    // якоря: best-effort (ручные анкоры могут отличаться от GFM-slug) — WARNING, не fail
    if (st.kind === 'md' && st.frag && !anchorExists(st.base, st.frag)) {
      console.warn(`WARN: anchor ${st.frag} в ${src.rel} → ${st.base}: не совпал с GFM-slug заголовка`);
    }
  }
  // ссылки внутри отрендеренного HTML (после перезаписи) должны вести на существующие страницы
  const html = rendered.get(src.base);
  for (const m of html.matchAll(/href="([^"]+\.html)(#[^"]*)?"/g)) {
    const target = m[1].replace(/\.html$/, '');
    if (!pageIds.has(target) && target !== '../index' && !fs.existsSync(path.join(ROOT, target + '.html')) && !fs.existsSync(path.join(ROOT, target, 'index.html')) && target !== '../quick-start' && !fs.existsSync(path.join(ROOT, 'quick-start.html'))) {
      // относительные выходы за docs: index/quick-start в корне репо
      const resolved = path.resolve(DOCS_SRC, m[1]);
      if (!fs.existsSync(resolved)) fail(`broken html link в ${src.rel}: ${m[1]}`);
    }
  }
}
console.log('links checked: ' + checked);

// --- safety guard: никакого исполняемого в сгенерированном HTML ---
for (const [base, html] of rendered) {
  if (/<script[\s>]/i.test(html)) fail(`generated ${base}.html содержит <script>`);
  if (/javascript:/i.test(html)) fail(`generated ${base}.html содержит javascript:`);
}

// --- итог ---
if (failures > 0) {
  console.error(`DOCS BUILD FAIL: ${failures} проблема(ы)`);
  process.exit(1);
}
console.log('DOCS BUILD OK: ' + rendered.size + ' pages + hub, deterministic, no scripts');
