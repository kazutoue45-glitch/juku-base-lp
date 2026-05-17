import { mkdir, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const BASE_URL = process.env.SCREENSHOT_BASE_URL ?? 'http://localhost:3000';
const OUTPUT_DIR = resolve(
  fileURLToPath(new URL('..', import.meta.url)),
  'public/images/app-screenshots',
);
const VIEWPORT = { width: 1440, height: 900 };
const SLEEP_MS = 1500;

const pages = [
  ['/schedule', '01-schedule.png'],
  ['/templates', '02-templates.png'],
  ['/students', '03-students.png'],
  ['/instructors', '04-instructors.png'],
  ['/invoices', '05-invoices.png'],
  ['/scores', '06-scores.png'],
];

const sleep = (ms) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

async function waitUntilSettled(page, label) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 30_000 });
  } catch (error) {
    throw new Error(`${label}: networkidle timeout: ${error.message}`);
  }
  await sleep(SLEEP_MS);
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    headless: true,
    args: ['--single-process', '--disable-gpu', '--no-zygote'],
  });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    locale: 'ja-JP',
    timezoneId: 'Asia/Tokyo',
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();

  try {
    // 先に /schedule を叩いて、ログインに飛ばされたらボタン押す、飛ばされなければそのまま
    const initialResponse = await page.goto(`${BASE_URL}/schedule`, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    if (!initialResponse) {
      throw new Error(`/schedule: no response from ${BASE_URL}/schedule`);
    }

    const currentUrl = page.url();
    if (currentUrl.includes('/login')) {
      console.log('Login page detected, clicking 開発用ログイン...');
      const devLoginButton = page.locator('button:has-text("開発用ログイン")');
      try {
        await devLoginButton.waitFor({ state: 'visible', timeout: 10_000 });
      } catch (error) {
        throw new Error(`login: 開発用ログイン button not found: ${error.message}`);
      }
      await Promise.all([
        page.waitForURL('**/schedule', { timeout: 30_000 }),
        devLoginButton.click(),
      ]);
    } else {
      console.log(`Already authenticated at ${currentUrl}`);
    }
    await waitUntilSettled(page, '/schedule initial');

    const results = [];
    for (const [path, filename] of pages) {
      const url = `${BASE_URL}${path}`;
      const response = await page.goto(url, {
        waitUntil: 'domcontentloaded',
        timeout: 30_000,
      });

      if (!response) {
        throw new Error(`${path}: no response from ${url}`);
      }
      if (response.status() === 404) {
        throw new Error(`${path}: page returned 404`);
      }
      if (response.status() >= 400) {
        throw new Error(`${path}: HTTP ${response.status()}`);
      }

      await waitUntilSettled(page, path);

      // 生徒/講師ページは初期状態が「左から選んでください」。
      // sidebar nav と区別するため、ロール名「先生」「様」を含むテキストの最初を狙う
      if (path === '/instructors') {
        try {
          // 講師名は「○○先生」表記
          const item = page.locator('button:has-text("先生"), [role="button"]:has-text("先生")').first();
          await item.waitFor({ state: 'visible', timeout: 5_000 });
          await item.click({ timeout: 5_000 });
          await sleep(2500);
        } catch (e) {
          console.log(`${path}: 講師選択失敗 ${e.message.slice(0, 80)}`);
        }
      } else if (path === '/students') {
        try {
          // 生徒名は人名表記。「中学」「高校」を含む生徒情報ラベルから推測、もしくは生徒一覧の最初のリストアイテム
          const item = page.locator('button:has-text("中学"), button:has-text("高校"), button:has-text("小学"), [role="listitem"] button').first();
          await item.waitFor({ state: 'visible', timeout: 5_000 });
          await item.click({ timeout: 5_000 });
          await sleep(2500);
        } catch (e) {
          console.log(`${path}: 生徒選択失敗 ${e.message.slice(0, 80)}`);
        }
      }

      const outputPath = resolve(OUTPUT_DIR, filename);
      await page.screenshot({
        path: outputPath,
        fullPage: false,
        type: 'png',
      });

      const file = await stat(outputPath);
      results.push({
        file: outputPath,
        width: VIEWPORT.width,
        height: VIEWPORT.height,
        bytes: file.size,
      });
    }

    console.log('Screenshots saved:');
    for (const result of results) {
      console.log(
        `- ${result.file} | ${result.width}x${result.height}px | ${formatBytes(result.bytes)} (${result.bytes} bytes)`,
      );
    }
  } catch (error) {
    console.error(`Screenshot capture failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
}

main().catch((error) => {
  console.error(`Screenshot capture failed: ${error.message}`);
  process.exitCode = 1;
});
