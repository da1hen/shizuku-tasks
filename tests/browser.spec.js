import { expect, test } from '@playwright/test';

async function add(page, label) {
  await page.getByLabel('クイックメモ').fill(label);
  await page.getByRole('button', { name: '追加', exact: true }).click();
  return page.locator('.task').filter({ hasText: label });
}

test('初期画面からすぐ入力でき、下書きとタスクがリロード後も残る', async ({ page }) => {
  await page.route('**/app.js', async (route) => {
    await expect(page.locator('#launch')).toBeVisible();
    await route.continue();
  });
  await page.goto('/');
  const field = page.getByLabel('クイックメモ');
  await expect(field).toBeFocused();
  await expect(page.locator('#launch')).toBeHidden();
  await expect(page.getByText('タスクはまだありません')).toBeVisible();
  await field.fill('会議の準備と資料の配布');
  await page.reload();
  await expect(field).toHaveValue('会議の準備と資料の配布');
  await field.press('Control+Enter');
  await expect(page.getByText('会議の準備と資料の配布')).toBeVisible();
  await expect(field).toHaveValue('');
  await page.reload();
  await expect(page.getByText('会議の準備と資料の配布')).toBeVisible();
  await expect(page.getByText('0 / 1 件完了')).toBeVisible();
});

test('ステータスのボタン変更、絞り込み、取り消しができる', async ({ page }) => {
  await page.goto('/');
  const row = await add(page, '提出する');
  await row.getByRole('button', { name: '提出するを進行中にする' }).click();
  await expect(row).toHaveAttribute('data-status', 'doing');
  await page.getByRole('button', { name: /^未着手/ }).click();
  await expect(page.getByText('未着手のタスクはありません')).toBeVisible();
  await page.getByRole('button', { name: /^進行中/ }).click();
  await row.getByRole('button', { name: '提出するを完了にする' }).click();
  await expect(page.getByText('1 / 1 件完了')).toBeVisible();
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(row).toHaveAttribute('data-status', 'doing');
});

test('フリックを左で進め、右で戻し、短い移動では変更しない', async ({ page, isMobile }) => {
  await page.goto('/');
  const row = await add(page, 'フリックを試す');
  await expect(row).toHaveAttribute('data-status', 'todo');
  const touch = isMobile ? await page.context().newCDPSession(page) : null;
  async function swipe(distance) {
    const bounds = await row.locator('.task-text').boundingBox();
    const x = Math.round(bounds.x + bounds.width / 2);
    const y = Math.round(bounds.y + bounds.height / 2);
    if (touch) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
      for (let step = 1; step <= 8; step++) {
        await touch.send('Input.dispatchTouchEvent', {
          type: 'touchMove', touchPoints: [{ x: Math.round(x + distance * step / 8), y }],
        });
      }
      await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    } else {
      await page.mouse.move(x, y);
      await page.mouse.down();
      await page.mouse.move(x + distance, y, { steps: 8 });
      await page.mouse.up();
    }
  }
  await swipe(-20);
  await expect(row).toHaveAttribute('data-status', 'todo');
  await swipe(-105);
  await expect(row).toHaveAttribute('data-status', 'doing');
  await swipe(-105);
  await expect(row).toHaveAttribute('data-status', 'done');
  await swipe(105);
  await expect(row).toHaveAttribute('data-status', 'doing');
  await swipe(105);
  await expect(row).toHaveAttribute('data-status', 'todo');
  await swipe(105);
  await expect(row).toHaveAttribute('data-status', 'todo');
});

test('編集、削除、削除の取り消しができる', async ({ page }) => {
  await page.goto('/');
  const initial = await add(page, 'タイトルを変える');
  await initial.getByRole('button', { name: 'タイトルを変えるを編集' }).click();
  await page.getByLabel('タスク名').fill('修正後のタイトル');
  await page.getByLabel('ステータス', { exact: true }).selectOption('doing');
  await page.getByRole('button', { name: '保存', exact: true }).click();
  const row = page.locator('.task').filter({ hasText: '修正後のタイトル' });
  await expect(row).toHaveAttribute('data-status', 'doing');
  await row.getByRole('button', { name: '修正後のタイトルを編集' }).click();
  await page.getByRole('button', { name: '削除', exact: true }).click();
  await expect(row).toHaveCount(0);
  await page.getByRole('button', { name: '元に戻す' }).click();
  await expect(row).toBeVisible();
});

test('AI分割を押すとGoogleログインだけを案内し、入力は保持する', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('クイックメモ').fill('買い物を先に済ませる');
  await page.getByRole('button', { name: 'AIで分ける' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link')).toHaveCount(1);
  await expect(dialog.getByRole('link', { name: 'Googleでログイン' })).toHaveAttribute('href', '/auth/google');
  await dialog.getByRole('button', { name: '閉じる' }).click();
  await expect(page.getByLabel('クイックメモ')).toHaveValue('買い物を先に済ませる');
});

test('320px幅と動きを減らす設定で操作できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 740 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const row = await add(page, '長いメモ'.repeat(35));
  await expect(row).toBeVisible();
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth, content: document.documentElement.scrollWidth,
    duration: getComputedStyle(document.querySelector('.task')).animationDuration,
  }));
  expect(dimensions.content).toBe(dimensions.viewport);
  expect(Number.parseFloat(dimensions.duration)).toBeLessThan(.01);
});
