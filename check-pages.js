const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = 'http://localhost:5173';
const OUT_DIR = path.resolve(__dirname, 'screenshots');
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const pages = [
  { name: 'overview', url: '/admin' },
  { name: 'agent-registry', url: '/admin/agents' },
  { name: 'orchestrator-definitions', url: '/admin/orchestrators' },
  { name: 'api-config', url: '/admin/api-config' },
  { name: 'skill-model-config', url: '/admin/skill-model-config' },
  { name: 'teaching-sessions', url: '/admin/teaching-sessions' },
  { name: 'learner-models', url: '/admin/learner-models' },
  { name: 'virtual-learners', url: '/admin/virtual-learners' },
  { name: 'prompt-call-logs', url: '/admin/prompt-call-logs' },
];

async function run() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  // Collect console errors
  const errors = [];
  page.on('console', msg => {
    if (msg.type() === 'error') errors.push(`[${msg.type()}] ${msg.text()}`);
  });
  page.on('pageerror', err => errors.push(`[PAGE] ${err.message}`));

  const results = [];

  for (const { name, url } of pages) {
    console.log(`\n=== Checking: ${name} (${url}) ===`);
    errors.length = 0;
    try {
      await page.goto(BASE + url, { waitUntil: 'networkidle', timeout: 30000 });
      await page.waitForTimeout(2000);

      if (errors.length > 0) {
        console.log(`  ERRORS:`);
        errors.forEach(e => console.log(`    ${e}`));
      }

      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
      console.log(`  Screenshot saved: ${name}.png`);

      // Check for empty-state text patterns
      const hasWhyEmpty = await page.$$eval('*', els => 
        els.some(el => el.textContent?.includes('为什么会为空'))
      ).catch(() => false);
      const hasSuggestNext = await page.$$eval('*', els =>
        els.some(el => el.textContent?.includes('建议下一步'))
      ).catch(() => false);
      const hasClickRight = await page.$$eval('*', els =>
        els.some(el => el.textContent?.includes('点击右侧'))
      ).catch(() => false);
      const hasFileAsTruth = await page.$$eval('*', els =>
        els.some(el => el.textContent?.includes('File-as-Truth'))
      ).catch(() => false);
      const hasOverlongPlaceholder = await page.$$eval('*', els => {
        const inputs = els.filter(el => el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');
        return inputs.some(el => (el.placeholder || '').length > 30);
      }).catch(() => false);

      const warnings = [];
      if (hasWhyEmpty) warnings.push('Found "为什么会为空" (should be removed)');
      if (hasSuggestNext) warnings.push('Found "建议下一步" (should be removed)');
      if (hasClickRight) warnings.push('Found "点击右侧" (should be shortened)');
      if (hasFileAsTruth) warnings.push('Found "File-as-Truth" (should be removed)');
      if (hasOverlongPlaceholder) warnings.push('Found overlong placeholder (>30 chars)');

      results.push({ name, errors: [...errors], warnings });
      if (warnings.length) {
        console.log(`  WARNINGS:`);
        warnings.forEach(w => console.log(`    ⚠ ${w}`));
      }
    } catch (err) {
      console.log(`  FAILED: ${err.message}`);
      results.push({ name, error: err.message });
    }
  }

  console.log('\n\n=== SUMMARY ===');
  let ok = true;
  for (const r of results) {
    const status = r.error ? '❌ FAIL' : (r.warnings?.length ? '⚠ WARN' : '✅ OK');
    console.log(`  ${status} ${r.name}`);
    if (r.warnings?.length) {
      r.warnings.forEach(w => console.log(`      ${w}`));
    }
    if (r.error) {
      console.log(`      ${r.error}`);
      ok = false;
    }
  }

  await browser.close();
  process.exit(ok ? 0 : 1);
}

run().catch(err => { console.error(err); process.exit(1); });