import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

const browser = await chromium.connectOverCDP('http://127.0.0.1:9226');
const page = browser.contexts()[0].pages().find((page) => !page.url().includes('coachPrompt=1'));
assert(page, 'main Paper window must exist');
page.setDefaultTimeout(10000);
const out = 'output/playwright/pets';
await mkdir(out, { recursive: true });
const button = (name) => page.getByRole('button', { name, exact: true });
const checks = [];
const pass = (name) => { checks.push(name); console.log('PASS', name); };
const checkImage = async (selector, suffix) => {
  await page.waitForFunction(({selector,suffix}) => {
    const image = document.querySelector(selector);
    return image?.src.endsWith(suffix) && image.complete && image.naturalWidth > 0;
  }, {selector,suffix});
};
try {
  const status = await page.evaluate(() => window.__TAURI_INTERNALS__.invoke('get_paper_bridge_status'));
  assert(status.connectionFile.includes('pet-choice-test-data'));
  if (process.argv.includes('--restart')) {
    await checkImage('.pet-button img', 'cloud-bunny-app.png');
    await button('设置').click();
    assert.equal(await page.getByRole('button', {name: /抱月兔子/}).getAttribute('aria-pressed'), 'true');
    pass('Pet choice survives a full native app restart');
  } else {
    await button('设置').click();
    assert.equal(await page.locator('.pet-option').count(), 4);
    for (const [name, suffix] of [['小鱼 Inky','inky-paper-pet.png'], ['抱星水母','star-jelly-app.png'], ['蘑菇小灵','mushroom-spirit-app.png'], ['抱月兔子','cloud-bunny-app.png']]) {
      await page.getByRole('button', {name: new RegExp(name)}).click();
      assert.equal(await page.locator('.pet-option[aria-pressed="true"]').count(), 1);
      await button('返回任务页').click();
      await checkImage('.pet-button img', suffix);
      await button('进入迷你宠物').click();
      await checkImage('.mini-pet img', suffix);
      await page.waitForFunction(() => innerWidth === 160 && innerHeight === 160);
      await page.screenshot({path: `${out}/mini-${suffix}`, omitBackground: true});
      await button('返回 Inky Paper').click();
      await button('设置').click();
    }
    await page.screenshot({path: `${out}/settings.png`});
    pass('All four pets switch immediately in settings, home and the native 160px mini window');
    await button('返回任务页').click();
    const taskId = randomUUID();
    await page.evaluate(async ({taskId, requestId}) => {
      await window.__TAURI_INTERNALS__.invoke('paper_execute', {action:'create_task',input:{taskId,requestId,title:'检查小伙伴显示',nextAction:'确认各页使用选中的兔子'}});
    }, {taskId, requestId: randomUUID()});
    await button('只计时一轮').click();
    await checkImage('.focus-pet img', 'cloud-bunny-app.png');
    await page.screenshot({path: `${out}/focus.png`});
    await button('暂停').click();
    await button('这一轮先到这里').click();
    await button('这一步完成了').click();
    await checkImage('.completion-art > img', 'cloud-bunny-app.png');
    pass('Focus and step-completion pages use the selected pet');
    await button('回到任务页').click();
    await button('整个任务都完成了').click();
    await checkImage('.completion-art > img', 'cloud-bunny-app.png');
    await page.screenshot({path: `${out}/celebration.png`});
    pass('Whole-task celebration uses the selected pet');
    await page.evaluate(() => localStorage.setItem('paper-pet', JSON.stringify('removed-pet')));
    await page.reload();
    await button('设置').click();
    assert.equal(await page.getByRole('button', {name: /小鱼 Inky/}).getAttribute('aria-pressed'), 'true');
    await page.getByRole('button', {name: /抱月兔子/}).click();
    pass('Unknown saved pet safely falls back to the original fish');
  }
  await writeFile(`${out}/${process.argv.includes('--restart') ? 'restart' : 'verification'}.json`, JSON.stringify({result:'PASS',checks},null,2));
} finally { await browser.close(); }
