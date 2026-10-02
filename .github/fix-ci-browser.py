from pathlib import Path

p = Path('.github/workflows/generator-ci.yml')
s = p.read_text(encoding='utf-8')
old_channel = '          echo "BROWSER_CHANNEL=chromium" >> "$GITHUB_ENV"\n'
new_channel = '          echo "BROWSER_CHANNEL=chrome" >> "$GITHUB_ENV"\n          google-chrome --version\n'
old_install = '          "$deps/node_modules/.bin/playwright" install --with-deps chromium\n'
if s.count(old_channel) != 2:
    raise SystemExit(f'expected 2 chromium channel lines, found {s.count(old_channel)}')
if s.count(old_install) != 2:
    raise SystemExit(f'expected 2 playwright install lines, found {s.count(old_install)}')
s = s.replace(old_channel, new_channel).replace(old_install, '')
p.write_text(s, encoding='utf-8')
