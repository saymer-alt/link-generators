// Browser regression for #340: поля имён URL-подписок («🏷️ Подписка №N») пропадают
// при смене профиля / восстановлении проекта. cfgSubMode.checked присваивается
// программно (applyProfileUiState, rbWriteProject) — событие change не возникает,
// редакторы имён должны синхронизироваться явно. Внешний Playwright, js-yaml 4.1.0;
// same setup as browser.cjs / submode-clarity.cjs.
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const pw = require('playwright');
const yaml = require(process.env.JS_YAML_PATH);
const root = process.env.TEST_ROOT || path.resolve(__dirname, '..');
const SUB = 'https://example.invalid/sub';
const NAME = 'Поле Имя';
const NAMED = '# provider-name: ' + NAME + '\n' + SUB;
(async () => {
  for (const engine of (process.env.TEST_ENGINES || 'chromium').split(',')) {
    const browser = await pw[engine].launch({ headless: true });
    try {
      const page = await browser.newPage();
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      page.on('dialog', d => d.accept());
      await page.route('https://cdn.jsdelivr.net/**', r => r.fulfill({ path: process.env.JS_YAML_PATH, contentType: 'text/javascript' }));
      await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
      await page.waitForFunction(() => !!globalThis.web4core && !!globalThis.jsyaml);
      await page.locator('button.tab').filter({ hasText: 'Mihomo' }).click();
      const rows = page.locator('#providerNameRows input[type=text]');
      const reserveRows = page.locator('#providerNameReserveRows input[type=text]');
      // Реальный путь восстановления проекта (confirm + установка Undo-снимка).
      const load = text => page.evaluate(async t => {
        await rbLoadProject(new File([t], 'project.json', { type: 'application/json' }));
      }, text);
      const build = async () => {
        await page.locator('button[onclick="buildMihomo()"]').click();
        await page.waitForFunction(() => MIHOMO_VALIDATION_STATE.state === 'VALID');
        return page.locator('#mihomoOutput').inputValue();
      };

      // Панель резерва скрыта при выключенном БС (контракт UI) — fill/inputValue
      // требуют видимости, поэтому значение ставим и читаем через evaluate
      // с тем же input-событием, что и при ручном вводе.
      const setWhitelist = v => page.evaluate(t => {
        const el = document.getElementById('whitelistInput');
        el.value = t;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, v);
      const whitelistValue = () => page.evaluate(() => document.getElementById('whitelistInput').value);
      // Сценарий 1 (#340): Sub Mode OFF в Router, URL с ручным именем уже введён;
      // переход на ранее не настроенный VPS-профиль (Sub Mode по умолчанию ON).
      await page.locator('#cfgSubMode').uncheck();
      await page.locator('#mihomoInput').fill(NAMED);
      await setWhitelist(NAMED);
      assert.equal(await rows.count(), 0, 'OFF: редакторов имён нет');
      assert.equal(await reserveRows.count(), 0, 'OFF: в резерве редакторов нет');
      await page.locator('#cfgProfile').selectOption('vps-local');
      assert.equal(await page.locator('#cfgSubMode').isChecked(), true, 'свежий VPS-профиль: Sub Mode ON');
      assert.equal(await rows.count(), 1, '#340: поле имени видно сразу после смены профиля, без F5');
      assert.equal(await reserveRows.count(), 1, 'резерв ведёт себя так же');
      assert.equal(await rows.first().inputValue(), NAME, 'имя прочитано из # provider-name:');

      // Сценарий 2 (#340): round-trip Router ON ↔ VPS OFF без редактирования URL.
      // Каждая проверка — сразу после программного .checked из applyProfileUiState.
      await page.locator('#cfgSubMode').uncheck(); // VPS: OFF
      await page.locator('#cfgProfile').selectOption('router');
      assert.equal(await rows.count(), 0, 'router-снимок OFF: полей нет');
      await page.locator('#cfgSubMode').check(); // Router: ON
      await page.locator('#cfgProfile').selectOption('vps-local');
      assert.equal(await page.locator('#cfgSubMode').isChecked(), false, 'VPS-снимок OFF');
      assert.equal(await rows.count(), 0, 'OFF: полей нет (лишние тоже не остаются)');
      await page.locator('#cfgProfile').selectOption('router');
      assert.equal(await page.locator('#cfgSubMode').isChecked(), true, 'router-снимок ON');
      assert.equal(await rows.count(), 1, '#340: поля возвращаются сразу при ON');
      assert.equal(await rows.first().inputValue(), NAME, 'имя сохраняется при переключениях');

      // Сценарий 3 (#340): восстановление проекта с sources.subMode=true из текущего OFF.
      const projectTrue = await page.evaluate(() => JSON.parse(JSON.stringify(rbCollectProject())));
      assert.equal(projectTrue.sources.subMode, true);
      await page.locator('#cfgSubMode').uncheck();
      assert.equal(await rows.count(), 0);
      await load(JSON.stringify(projectTrue));
      assert.equal(await page.locator('#cfgSubMode').isChecked(), true, 'проект восстановил Sub Mode ON');
      assert.equal(await rows.count(), 1, '#340: поля видны сразу после rbWriteProject');
      assert.equal(await rows.first().inputValue(), NAME, 'имя не потерялось при restore');
      // Обратный вариант: restore subMode=false из текущего ON.
      const projectFalse = await page.evaluate(() => JSON.parse(JSON.stringify(rbCollectProject())));
      projectFalse.sources.subMode = false;
      await load(JSON.stringify(projectFalse));
      assert.equal(await page.locator('#cfgSubMode').isChecked(), false);
      assert.equal(await rows.count(), 0, '#340: restore OFF из ON скрывает поля');
      // rbUndoRestore возвращает снимок до последнего восстановления (ON).
      await page.evaluate(() => rbUndoRestore());
      assert.equal(await page.locator('#cfgSubMode').isChecked(), true);
      assert.equal(await rows.count(), 1, '#340: Undo синхронизирует редакторы');

      // Сценарий 4: имена, URL, HWID и ручной ввод не искажаются переключениями.
      assert.equal(await page.locator('#mihomoInput').inputValue(), NAMED, 'URL и директива не изменились');
      assert.equal(await whitelistValue(), NAMED, 'резерв: URL и директива не изменились');
      await rows.first().fill('Имя 2');
      await rows.first().evaluate(el => el.blur()); // blur коммитит change в textarea
      assert.equal(await page.locator('#mihomoInput').inputValue(), '# provider-name: Имя 2\n' + SUB, 'ввод имени попал в текст');
      await page.locator('#cfgProfile').selectOption('vps-local');
      await page.locator('#cfgProfile').selectOption('router');
      assert.equal(await rows.first().inputValue(), 'Имя 2', 'переименованное имя переживает round-trip');
      assert.equal(await page.locator('#mihomoInput').inputValue(), '# provider-name: Имя 2\n' + SUB, 'textarea не изменилась');
      const built = await build();
      const doc = yaml.load(built);
      const provider = doc['proxy-providers']['Имя 2'];
      assert.ok(provider, 'имя подписки — ключ провайдера в YAML');
      assert.equal(provider.url, SUB, 'URL подписки не изменился');
      assert.ok(Array.isArray(provider.header && provider.header['x-hwid']), 'x-hwid присутствует');
      assert.deepEqual(errors, [], 'без ошибок страницы');
    } finally {
      await browser.close();
    }
    console.log('PASS provider-name-editors (#340):', engine);
  }
})().catch(e => { console.error(e); process.exit(1); });
