from pathlib import Path

p = Path('tests/wg-dialer-selector.cjs')
s = p.read_text(encoding='utf-8')
old = "  // 9b. Legacy/ADVANCED provider-backed group остаётся совместимым.\n  await page.locator('.wg-mode').first().selectOption('direct');\n"
new = "  // 9b. Legacy/ADVANCED provider-backed group остаётся совместимым.\n  // Группа существует только когда хотя бы один WG реально использует dialer.\n  await page.locator('.wg-mode').first().selectOption('proxy');\n"
if s.count(old) != 1:
    raise SystemExit(f'expected exactly one legacy snippet, found {s.count(old)}')
p.write_text(s.replace(old, new), encoding='utf-8')
