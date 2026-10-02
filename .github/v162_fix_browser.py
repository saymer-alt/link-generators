from pathlib import Path
p = Path('tests/browser.cjs')
s = p.read_text(encoding='utf-8')
old = """    // dialer-proxy поля: заполняются и переживают mini round trip
    await page.locator('#wgDialerInput').fill(INDEP.dialer);"""
new = """    // dialer-proxy поля теперь находятся в закрытом ADVANCED-блоке;
    // явно раскрываем его перед legacy/state-preservation проверкой.
    await page.locator('#wgDialerAdvanced').evaluate(el => { el.open = true; });
    await page.locator('#wgDialerInput').fill(INDEP.dialer);"""
if s.count(old) != 1:
    raise SystemExit(f'anchor mismatch: {s.count(old)}')
p.write_text(s.replace(old, new, 1), encoding='utf-8')
