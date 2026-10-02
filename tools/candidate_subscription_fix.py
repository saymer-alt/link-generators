from pathlib import Path

path = Path('index.html')
text = path.read_text()
old = '''        urlTest: document.getElementById('pingSelect').value || 'https://google.com/generate_204',
        mihomoSubscriptionMode: subMode,
        excludeFilter: subMode ? excludeFilterRaw : undefined,
        deviceModel: subMode ? document.getElementById('deviceModelInput').value : undefined,
        mihomoPerProxyTun: false,
'''
new = '''        urlTest: document.getElementById('pingSelect').value || 'https://google.com/generate_204',
        mihomoSubscriptionMode: document.getElementById('cfgSubMode').checked,
        excludeFilter: document.getElementById('excludeFilterInput').value,
        deviceModel: document.getElementById('deviceModelInput').value,
        mihomoPerProxyTun: false,
'''
if old in text:
    text = text.replace(old, new, 1)
elif new not in text:
    raise SystemExit('dialer preflight option-scope anchor not found')
path.write_text(text)
