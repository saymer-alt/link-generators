from pathlib import Path

path = Path('index.html')
text = path.read_text()

# One-shot patcher could be triggered again by its own push. Normalize the two
# mechanical artifacts before any semantic repairs.
while 'async async function buildMihomo()' in text:
    text = text.replace('async async function buildMihomo()', 'async function buildMihomo()', 1)

mode_block = '''  const subMode = document.getElementById('cfgSubMode').checked;
  const excludeFilterRaw = document.getElementById('excludeFilterInput').value.trim();
  const filterCompiled = compileSubscriptionExcludeFilter(excludeFilterRaw);
  if (!subMode && filterCompiled.error) {
    return showToast('❌ Exclude Filter: некорректное регулярное выражение для статического разворачивания: ' + filterCompiled.error, true);
  }
'''
doubled = mode_block + mode_block
while doubled in text:
    text = text.replace(doubled, mode_block, 1)

# Preflight dialer registry must keep using DOM state; build-local variables do not exist there.
preflight_bad = '''        urlTest: document.getElementById('pingSelect').value || 'https://google.com/generate_204',
        mihomoSubscriptionMode: subMode,
        excludeFilter: subMode ? excludeFilterRaw : undefined,
        deviceModel: subMode ? document.getElementById('deviceModelInput').value : undefined,
        mihomoPerProxyTun: false,
'''
preflight_good = '''        urlTest: document.getElementById('pingSelect').value || 'https://google.com/generate_204',
        mihomoSubscriptionMode: document.getElementById('cfgSubMode').checked,
        excludeFilter: document.getElementById('excludeFilterInput').value,
        deviceModel: document.getElementById('deviceModelInput').value,
        mihomoPerProxyTun: false,
'''
if preflight_bad in text:
    text = text.replace(preflight_bad, preflight_good, 1)
elif preflight_good not in text:
    raise SystemExit('preflight scope anchor not found')

# Final Build must use the already-resolved local mode/filter values and avoid provider-only fields in static mode.
final_old = '''        webUI: webUiEnabled,
        urlTest: urlTest,
        mihomoSubscriptionMode: document.getElementById('cfgSubMode').checked,
        excludeFilter: document.getElementById('excludeFilterInput').value,
        deviceModel: document.getElementById('deviceModelInput').value,
        webUiDashboard: webUiEnabled ? webUiChoice : undefined,
'''
final_new = '''        webUI: webUiEnabled,
        urlTest: urlTest,
        mihomoSubscriptionMode: subMode,
        excludeFilter: subMode ? excludeFilterRaw : undefined,
        deviceModel: subMode ? document.getElementById('deviceModelInput').value : undefined,
        webUiDashboard: webUiEnabled ? webUiChoice : undefined,
'''
if final_old in text:
    text = text.replace(final_old, final_new, 1)
elif final_new not in text:
    raise SystemExit('final build scope anchor not found')

# Comment now reflects that browser inspection may preview provider nodes while final provider remains dynamic.
text = text.replace(
    '''    // URL-подписки — виртуальные UI-targets. dialer-proxy не может ссылаться
    // прямо на proxy-provider, поэтому при Build для выбранной подписки ниже
    // создаётся отдельная select-группа с use:[provider]. Содержимое подписки
    // браузер не скачивает и не разворачивает.
''',
    '''    // URL-подписки — виртуальные UI-targets. dialer-proxy не может ссылаться
    // прямо на proxy-provider, поэтому при Build для выбранной подписки ниже
    // создаётся отдельная select-группа с use:[provider]. Browser preview может
    // прочитать имена узлов, но provider в итоговом YAML остаётся динамическим.
''',
    1,
)
path.write_text(text)
