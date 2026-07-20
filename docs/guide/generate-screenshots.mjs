// Regenerates the screenshots in docs/guide/images/ for USER_GUIDE.md.
//
// Prereqs: backend on :8000 and frontend on :5173 (see the verify skill), and the
// `playwright` package available (e.g. `npm i playwright` in a scratch dir). Chromium is
// pre-installed at PLAYWRIGHT_BROWSERS_PATH; adjust `executablePath` below if your build
// number differs. It uploads docs/guide/sample.csv through the mapping wizard.
//
//   node docs/guide/generate-screenshots.mjs
import { chromium } from 'playwright';

const BASE = 'http://localhost:5173';
const OUT = '/home/user/sts-deeppocket-budgetting/docs/guide/images';
const SAMPLE = 'docs/guide/sample.csv';

const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push(`OK   ${name}`);
  } catch (e) {
    results.push(`FAIL ${name}: ${e.message.split('\n')[0]}`);
  }
}

const browser = await chromium.launch({
  executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 1360, height: 900 }, deviceScaleFactor: 1.5 });

async function goto(path) {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  // Wait past the "Loading fixtures…" splash.
  await page.waitForFunction(() => !document.body.innerText.includes('Loading fixtures'), { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(600);
}
const shot = (f, opts = {}) => page.screenshot({ path: `${OUT}/${f}`, ...opts });

await step('01 dashboard', async () => { await goto('/'); await shot('01-dashboard.png', { fullPage: true }); });

await step('02 transactions', async () => { await goto('/transactions'); await shot('02-transactions.png'); });

await step('03 add-transaction form', async () => {
  await page.getByRole('button', { name: 'Add transaction' }).click();
  await page.waitForTimeout(400);
  await shot('03-add-transaction.png');
});

await step('04 bulk select action bar', async () => {
  // Close the add form first so the table is visible.
  await page.getByRole('button', { name: 'Close' }).click().catch(() => {});
  await page.waitForTimeout(300);
  const boxes = page.locator('table tbody input[type="checkbox"]');
  await boxes.nth(0).check();
  await boxes.nth(1).check();
  await boxes.nth(2).check();
  await page.waitForTimeout(300);
  await shot('04-bulk-select.png');
});

await step('05 budgets', async () => { await goto('/budgets'); await shot('05-budgets.png', { fullPage: true }); });

await step('06 budget inline cap edit', async () => {
  await page.locator('button.underline.decoration-dotted').first().click();
  await page.waitForTimeout(300);
  await shot('06-budget-edit-cap.png');
});

await step('07 settings categories', async () => {
  await goto('/settings');
  const heading = page.getByText('Categories', { exact: false }).first();
  await heading.scrollIntoViewIfNeeded().catch(() => {});
  await page.waitForTimeout(300);
  await shot('07-settings-categories.png', { fullPage: true });
});

await step('08 import page overview', async () => { await goto('/import'); await shot('08-import-overview.png', { fullPage: true }); });

await step('09 import wizard preview', async () => {
  const fileInputs = page.locator('input[type="file"]');
  await fileInputs.last().setInputFiles(SAMPLE);
  await page.getByText('Import with this mapping', { exact: false }).waitFor({ timeout: 8000 });
  await page.waitForTimeout(500);
  // switch to debit/credit + account-from-column so the guessed columns apply
  await page.getByText('Debit / credit', { exact: false }).click().catch(() => {});
  await page.getByText('From column', { exact: false }).click().catch(() => {});
  await page.waitForTimeout(300);
  await page.getByText('Import any CSV', { exact: false }).scrollIntoViewIfNeeded().catch(() => {});
  await shot('09-import-wizard-mapping.png', { fullPage: true });
});

await step('10 import wizard result', async () => {
  await page.getByRole('button', { name: /Import with this mapping/ }).click();
  await page.getByText(/Created \d+/, { exact: false }).first().waitFor({ timeout: 8000 });
  await page.waitForTimeout(400);
  await shot('10-import-wizard-result.png', { fullPage: true });
});

await step('11 networth', async () => { await goto('/networth'); await shot('11-networth.png', { fullPage: true }); });

await browser.close();
console.log(results.join('\n'));
