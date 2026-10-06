/* eslint-disable no-console */
/**
 * GUI-1 驾驶脚本（measurement-verify 第一轮，前端体验员）：
 * 以真实新学习者身份用 Playwright 走完一整节课（注册→onboarding→目标对话→路径→课堂→完课→反馈页）。
 * 分命令驱动（每命令独立浏览器进程，storageState 续登录态），给编排者（agent）留出逐轮拟稿空间。
 *
 * 用法（cwd=backend）：
 *   node scripts/measurement-verify/gui1-driver.mjs register
 *   node scripts/measurement-verify/gui1-driver.mjs onboarding
 *   node scripts/measurement-verify/gui1-driver.mjs goal-first "<目标文本>"
 *   node scripts/measurement-verify/gui1-driver.mjs goal-reply "<回复文本>"
 *   node scripts/measurement-verify/gui1-driver.mjs goal-confirm
 *   node scripts/measurement-verify/gui1-driver.mjs wait-path          （≤15min 轮询）
 *   node scripts/measurement-verify/gui1-driver.mjs path-open-first
 *   node scripts/measurement-verify/gui1-driver.mjs learn-open
 *   node scripts/measurement-verify/gui1-driver.mjs learn-send "<消息>"
 *   node scripts/measurement-verify/gui1-driver.mjs learn-state        （只读快照）
 *   node scripts/measurement-verify/gui1-driver.mjs cp-skip
 *   node scripts/measurement-verify/gui1-driver.mjs cp-answer --text "<简答>"
 *   node scripts/measurement-verify/gui1-driver.mjs cp-answer --pick "<选项文本子串>[|<子串2…>]"
 *   node scripts/measurement-verify/gui1-driver.mjs learn-complete
 *
 * 产物：out/gui-1/state.json（旅程状态）、out/gui-1/cmd-*.json（逐命令证据）、
 *       out/gui-shots/*.png（截图存档）。全程只读页面 DOM 断言，不改前端代码。
 */
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const BASE_UI = process.env.GUI1_UI || 'http://localhost:5174';
const OUT_DIR = path.resolve('scripts/measurement-verify/out/gui-1');
const SHOT_DIR = path.resolve('scripts/measurement-verify/out/gui-shots');
const STATE_PATH = path.join(OUT_DIR, 'state.json');

fs.mkdirSync(OUT_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_PATH, 'utf8')); } catch { return {}; }
}
function writeState(patch) {
  const s = { ...readState(), ...patch };
  fs.writeFileSync(STATE_PATH, JSON.stringify(s, null, 2));
  return s;
}

function slug(s) {
  return String(s).replace(/[^a-zA-Z0-9]+/g, '-').slice(0, 40).replace(/^-+|-+$/g, '') || 'x';
}

/* ---------------- browser plumbing ---------------- */

async function withPage(label, fn, opts = {}) {
  const state = readState();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    ...(state.storageStatePath && fs.existsSync(state.storageStatePath)
      ? { storageState: state.storageStatePath } : {}),
  });
  const page = await context.newPage();
  const evidence = {
    cmd: label,
    ts: new Date().toISOString(),
    ui: BASE_UI,
    consoleErrors: [],
    pageErrors: [],
    steps: [],
    ok: false,
  };
  const step = (name, detail) => {
    evidence.steps.push({ name, detail: detail === undefined ? null : detail, at: new Date().toISOString() });
    console.log(`[step] ${name}${detail !== undefined ? ` — ${typeof detail === 'string' ? detail.slice(0, 400) : JSON.stringify(detail).slice(0, 400)}` : ''}`);
  };
  page.on('console', (msg) => { if (msg.type() === 'error') evidence.consoleErrors.push(msg.text().slice(0, 500)); });
  page.on('pageerror', (err) => evidence.pageErrors.push(String(err).slice(0, 500)));

  const shot = async (name) => {
    const p = path.join(SHOT_DIR, `${label}-${name}-${Date.now()}.png`);
    await page.screenshot({ path: p, fullPage: false }).catch(() => {});
    return p;
  };

  try {
    await fn({ page, evidence, step, shot, state, context, browser });
    evidence.ok = true;
  } catch (err) {
    evidence.error = String(err && err.stack ? err.stack : err).slice(0, 2000);
    console.error('[FAIL]', String(err).slice(0, 800));
    await shot('fail').catch(() => {});
    await page.evaluate(() => document.body.innerText.slice(0, 3000)).then((t) => { evidence.failBodyText = t; }).catch(() => {});
  } finally {
    const evPath = path.join(OUT_DIR, `cmd-${label}-${Date.now()}.json`);
    fs.writeFileSync(evPath, JSON.stringify(evidence, null, 2));
    console.log(`[evidence] ${evPath}`);
    await context.close().catch(() => {});
    await browser.close().catch(() => {});
  }
  if (!evidence.ok) process.exitCode = 1;
  return evidence;
}

/* ---------------- shared waits / dumps ---------------- */

/** 生成中判定：stop 按钮在 or typing 气泡在 or goal 页流式泡在 */
async function busyState(page) {
  return page.evaluate(() => ({
    stopBtn: !!document.querySelector('.composer__send--stop'),
    typingBubble: !!document.querySelector('.msg__bubble--typing'),
    goalTyping: !!document.querySelector('.msg__bubble--typing'),
    // goal 页流式泡（无 --typing 类但有 --streaming）
    goalStreaming: !!document.querySelector('.msg__bubble--streaming'),
  }));
}

/** 等一轮生成彻底结束：连续 stablePolls 次「无 stop、无 typing、无 streaming」 */
async function waitTurnIdle(page, timeoutMs, stablePolls = 3, pollMs = 1500) {
  const t0 = Date.now();
  let stable = 0;
  let firstBusyAt = null;
  let firstIdleAt = null;
  for (;;) {
    const b = await busyState(page).catch(() => ({ stopBtn: true }));
    const isBusy = b.stopBtn || b.typingBubble || b.goalTyping || b.goalStreaming;
    if (isBusy) {
      if (firstBusyAt === null) firstBusyAt = Date.now();
      stable = 0;
    } else {
      if (firstIdleAt === null) firstIdleAt = Date.now();
      stable += 1;
      if (stable >= stablePolls) {
        return {
          ms: Date.now() - t0,
          firstDeltaMs: firstIdleAt && firstBusyAt ? firstIdleAt - firstBusyAt : null,
        };
      }
    }
    if (Date.now() - t0 > timeoutMs) throw new Error(`waitTurnIdle 超时 ${timeoutMs}ms（busy=${JSON.stringify(b)}）`);
    await sleep(pollMs);
  }
}

async function readBubbles(page) {
  return page.evaluate(() => {
    const pick = (el) => (el?.innerText || '').trim();
    const users = [...document.querySelectorAll('.msg--user .msg__bubble')].map(pick);
    const ais = [...document.querySelectorAll('.msg--ai .msg__bubble:not(.msg__bubble--typing)')]
      .map((el) => ({ text: pick(el), streaming: el.classList.contains('msg__bubble--streaming') }));
    return { users, ais };
  });
}

/** 课堂页检查点卡快照（DOM 断言口径） */
async function readCheckpoint(page) {
  return page.evaluate(() => {
    const card = document.querySelector('.checkpoint');
    if (!card) return null;
    const head = card.querySelector('.checkpoint__head');
    const options = [...card.querySelectorAll('.checkpoint__option')].map((o) => ({
      key: o.querySelector('.checkpoint__key')?.textContent?.trim() || '',
      text: o.querySelector('.checkpoint__text')?.textContent?.trim() || '',
      inputType: o.querySelector('input')?.type || null,
    }));
    const actions = [...card.querySelectorAll('.checkpoint__actions [role="button"], .checkpoint__actions span, .checkpoint__actions button')]
      .map((b) => (b.textContent || '').trim()).filter(Boolean);
    return {
      present: true,
      badge: head?.querySelector('.checkpoint__badge')?.textContent?.trim() || '',
      title: head?.querySelector('strong')?.textContent?.trim() || '',
      question: head?.querySelector('p')?.textContent?.trim() || '',
      type: options.length ? (card.querySelector('input[type="checkbox"]') ? 'multi_choice' : 'single_choice') : 'short_answer',
      options,
      hasTextarea: !!card.querySelector('.checkpoint__input'),
      actionLabels: actions,
      hasSkipButton: actions.includes('跳过'),
      hasSubmitButton: actions.some((a) => a === '提交' || a === '判定中…'),
      feedback: card.querySelector('.checkpoint__feedback')?.textContent?.trim() || '',
      streamingNote: card.querySelector('.checkpoint__streaming')?.textContent?.trim() || '',
    };
  });
}

async function classroomSnapshot(page) {
  const [bubbles, checkpoint] = await Promise.all([readBubbles(page), readCheckpoint(page)]);
  const extra = await page.evaluate(() => ({
    url: location.href,
    completedOverlay: document.querySelector('.finish__card')?.innerText?.trim() || null,
    lessonCtaVisible: !!document.querySelector('.lesson-cta'),
    lessonCtaText: document.querySelector('.lesson-cta')?.textContent?.trim() || null,
    replies: [...document.querySelectorAll('.replies__row .reply .reply__text')].map((e) => e.textContent.trim()),
    kpActions: [...document.querySelectorAll('.kp-actions .kp-act')].map((e) => e.textContent.trim()),
    typing: !!document.querySelector('.composer__send--stop'),
    bodyHead: document.body.innerText.slice(0, 600),
  })).catch(() => ({}));
  return { bubbles, checkpoint, ...extra };
}

/** 上一个用户消息之后到稳定的老师回合完成（课堂页口径：等 .composer__send--stop 消失后气泡数增加） */
async function sendClassroomMessage(page, text, evidence, step) {
  const before = await readBubbles(page);
  const aiBefore = before.ais.length;
  const ta = page.locator('.composer .composer__textarea');
  await ta.click();
  await ta.fill('');
  await ta.pressSequentially(text, { delay: 5 });
  const tSend = Date.now();
  // Enter 发送（@keydown.enter.exact.prevent="send"）
  await ta.press('Enter');
  step('sent', { text, tSend });
  // 等 typing 出现（请求已受理）
  let firstTypingMs = null;
  for (let i = 0; i < 40; i += 1) {
    if (await page.locator('.composer__send--stop, .msg__bubble--typing').count() > 0) { firstTypingMs = Date.now() - tSend; break; }
    await sleep(500);
  }
  // 等回合结束（3 次连续 idle）
  const idle = await waitTurnIdle(page, 420_000, 3, 1500);
  const after = await readBubbles(page);
  const lastAi = after.ais[after.ais.length - 1] || null;
  const turn = {
    tSend,
    firstTypingMs,
    totalMs: Date.now() - tSend,
    aiBubbleCountBefore: aiBefore,
    aiBubbleCountAfter: after.ais.length,
    lastAiText: lastAi?.text || '',
    newBubbleAppeared: after.ais.length > aiBefore,
  };
  evidence.turn = turn;
  step('turn done', { totalMs: turn.totalMs, firstTypingMs, newBubble: turn.newBubbleAppeared });
  return turn;
}

/* ---------------- commands ---------------- */

const commands = {
  async register({ page, evidence, step, shot, state }) {
    const name = state.name || `gu-r1-${Date.now().toString(36)}`;
    const password = state.password || `Wf${Math.random().toString(36).slice(2, 10)}1`;
    step('goto /register');
    await page.goto(`${BASE_UI}/register`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('form.form', { timeout: 30_000 });
    // 注册页表单只有 用户名/密码/确认密码 三字段（V2Register.vue:38/45/62），无邮箱输入
    const fieldLabels = await page.$$eval('.field', (els) => els.map((e) => e.textContent.trim().slice(0, 30)));
    evidence.registerFormFields = fieldLabels;
    step('form fields', fieldLabels);
    await page.fill('input[autocomplete="username"]', name);
    await page.fill('input[autocomplete="new-password"] >> nth=0', password);
    await page.fill('input[autocomplete="new-password"] >> nth=1', password);
    evidence.account = { name, passwordNote: '随机密码，存 state.json', email: 'UI 无邮箱字段：注册仅用户名+密码（V2Register.vue form），@test.local 用户名不合法（auth.ts USERNAME_PATTERN 禁 @）' };
    await page.click('.btn-primary--block');
    // 注册成功 → toast「注册成功」+ router.replace('/onboarding')
    await page.waitForURL(/\/onboarding/, { timeout: 30_000 });
    evidence.afterRegisterUrl = page.url();
    step('registered', evidence.afterRegisterUrl);
    await shot('onboarding-landed');
    const storageStatePath = path.join(OUT_DIR, 'storage-state.json');
    await page.context().storageState({ path: storageStatePath });
    writeState({ name, password, storageStatePath, registeredAt: new Date().toISOString() });
  },

  async onboarding({ page, evidence, step, shot }) {
    await page.goto(`${BASE_UI}/onboarding`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // 引导共 4 步（V2Onboarding totalSteps=4）：前 3 步点 .ob__cta 前进，第 4 步点「也可以直接去规划第一个目标 ›」
    for (let i = 1; i <= 3; i += 1) {
      await page.waitForSelector('.ob__page', { timeout: 20_000 });
      const title = await page.textContent('.ob__title');
      const cta = await page.textContent('.ob__cta');
      evidence[`step${i}`] = { title: title?.trim(), cta: cta?.trim() };
      step(`onboarding step ${i}`, `${title?.trim()} [${cta?.trim()}]`);
      if (i < 3) await page.click('.ob__cta');
      else break;
    }
    await shot('ob-step3');
    // 第 4 步（从 step3 点下一步进入）
    await page.click('.ob__cta');
    await page.waitForSelector('.ob__goal', { timeout: 20_000 });
    const step4 = await page.evaluate(() => ({
      title: document.querySelector('.ob__title')?.textContent?.trim(),
      goalLink: document.querySelector('.ob__goal')?.textContent?.trim(),
    }));
    evidence.step4 = step4;
    step('onboarding step 4', JSON.stringify(step4));
    await shot('ob-step4');
    await page.click('.ob__goal'); // markDone + 去 /goal-conversation
    await page.waitForURL(/\/goal-conversation/, { timeout: 30_000 });
    evidence.afterOnboardingUrl = page.url();
    step('onboarding done → goal-conversation', evidence.afterOnboardingUrl);
    await shot('goal-entry');
    // 顺便记录目标页初始态文本
    evidence.goalEntryText = await page.evaluate(() => document.querySelector('.entry__hero')?.innerText?.slice(0, 300) || document.body.innerText.slice(0, 300));
  },

  async 'goal-first'({ page, evidence, step, shot }, text) {
    await page.goto(`${BASE_UI}/goal-conversation`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('#goal-entry-input', { timeout: 30_000 });
    await page.fill('#goal-entry-input', text);
    step('goal filled', text);
    await page.click('.composer--entry .composer__send');
    const idle = await waitTurnIdle(page, 420_000, 3, 1500);
    evidence.turnMs = idle.ms;
    const bubbles = await readBubbles(page);
    evidence.bubbles = bubbles;
    evidence.url = page.url();
    const cid = (page.url().match(/goal-conversation\/([^/?#]+)/) || [])[1] || null;
    if (cid) writeState({ conversationId: cid });
    step('first reply done', { conversationId: cid, aiCount: bubbles.ais.length });
    await shot('goal-first-reply');
    evidence.lastAi = bubbles.ais[bubbles.ais.length - 1]?.text || '';
  },

  async 'goal-reply'({ page, evidence, step, shot, state }, text) {
    const cid = state.conversationId;
    if (!cid) throw new Error('state.conversationId 缺失');
    await page.goto(`${BASE_UI}/goal-conversation/${cid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // 等 work 态输入框（resume 拉历史）
    await page.waitForSelector('#goal-chat-input', { timeout: 60_000 });
    await sleep(2000);
    const before = await readBubbles(page);
    evidence.bubbleCountBefore = { user: before.users.length, ai: before.ais.length };
    await page.fill('#goal-chat-input', text);
    await page.press('#goal-chat-input', 'Enter');
    step('reply sent', text);
    const idle = await waitTurnIdle(page, 420_000, 3, 1500);
    evidence.turnMs = idle.ms;
    const bubbles = await readBubbles(page);
    evidence.bubbles = { userLast: bubbles.users[bubbles.users.length - 1], aiLast: bubbles.ais[bubbles.ais.length - 1]?.text || '', aiCount: bubbles.ais.length };
    // 方案弹层检测
    const proposal = await page.evaluate(() => {
      const ov = document.querySelector('.overlay[aria-label="方案确认"]');
      if (!ov) return null;
      return {
        eyebrow: ov.querySelector('.proposal__eyebrow')?.textContent?.trim() || '',
        title: ov.querySelector('.proposal__title')?.textContent?.trim() || '',
        bodyText: ov.querySelector('.proposal__body')?.innerText?.slice(0, 1500) || '',
        footButtons: [...ov.querySelectorAll('.proposal__foot button')].map((b) => b.textContent.trim()),
      };
    });
    evidence.proposal = proposal;
    step('reply done', { proposal: proposal ? proposal.eyebrow : 'none' });
    await shot('goal-reply');
  },

  async 'goal-confirm'({ page, evidence, step, shot, state }) {
    const cid = state.conversationId;
    await page.goto(`${BASE_UI}/goal-conversation/${cid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    // 等方案浮层（preview 态）
    await page.waitForSelector('.overlay[aria-label="方案确认"] .proposal__foot', { timeout: 120_000 });
    const preview = await page.evaluate(() => document.querySelector('.overlay')?.innerText?.slice(0, 1200));
    evidence.previewText = preview;
    step('proposal preview open');
    await shot('proposal-preview');
    await page.click('.proposal__foot .btn-primary'); // 确认，生成我的路径
    step('confirm clicked');
    // phase generating → done：等「路径已生成」
    await page.waitForFunction(() => {
      const t = document.querySelector('.overlay .proposal__title');
      return t && t.textContent.includes('路径已生成');
    }, { timeout: 600_000 });
    evidence.doneText = await page.evaluate(() => document.querySelector('.overlay')?.innerText?.slice(0, 600));
    step('path generated');
    await shot('proposal-done');
    await page.click('.proposal__actions .btn-primary--lg'); // 查看我的路径
    await page.waitForURL(/\/learning-paths/, { timeout: 30_000 });
    evidence.pathsUrl = page.url();
    await page.waitForSelector('.pcard', { timeout: 60_000 });
    const cards = await page.$$eval('.pcard', (els) => els.map((e) => ({
      badge: e.querySelector('.pcard__badge')?.textContent?.trim() || '(生成中卡无徽章)',
      title: e.querySelector('.pcard__title')?.textContent?.trim() || '',
      href: e.querySelector('a')?.getAttribute('href') || null,
      hasRefreshBtn: !!e.querySelector('.pcard__actions button'),
    })));
    evidence.pathCards = cards;
    const link = cards.map((c) => c.href).find(Boolean);
    if (link) writeState({ pathId: link.split('/').pop() });
    step('paths page', JSON.stringify(cards));
    await shot('paths-after-generate');
  },

  async 'wait-path'({ page, evidence, step, shot, state }) {
    const deadline = Date.now() + 15 * 60 * 1000;
    let poll = 0;
    for (;;) {
      poll += 1;
      await page.goto(`${BASE_UI}/learning-paths`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForTimeout(2500);
      const cards = await page.$$eval('.pcard', (els) => els.map((e) => ({
        badge: e.querySelector('.pcard__badge')?.textContent?.trim() || null,
        title: e.querySelector('.pcard__title')?.textContent?.trim() || '',
        href: e.querySelector('a')?.getAttribute('href') || null,
        generating: !!e.querySelector('.pcard__generating'),
        sub: e.querySelector('.pcard__sub')?.textContent?.trim() || null,
      }))).catch(() => []);
      evidence[`poll${poll}`] = { at: new Date().toISOString(), cards };
      const ready = cards.find((c) => c.href && !c.generating);
      step(`poll ${poll}`, JSON.stringify(cards));
      if (ready) {
        writeState({ pathId: ready.href.split('/').pop(), pathReadyAt: new Date().toISOString() });
        evidence.readyCard = ready;
        await shot('path-ready');
        step('path ready', ready.href);
        return;
      }
      // 生成中卡：点一次「刷新状态」帮后端推进 UI 视图
      const refresh = page.locator('.pcard__actions button', { hasText: '刷新状态' });
      if (await refresh.count() > 0) { await refresh.first().click().catch(() => {}); }
      if (Date.now() > deadline) throw new Error(`wait-path 15 分钟超时：${JSON.stringify(cards)}`);
      await sleep(25_000);
    }
  },

  async 'path-open-first'({ page, evidence, step, shot, state }) {
    const pid = state.pathId;
    if (!pid) throw new Error('state.pathId 缺失');
    await page.goto(`${BASE_UI}/learning-path/${pid}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.task', { timeout: 60_000 });
    const tasks = await page.$$eval('.task', (els) => els.map((e) => e.innerText.replace(/\n+/g, ' | ').slice(0, 200)));
    evidence.tasks = tasks;
    evidence.heroText = await page.evaluate(() => document.querySelector('.hero')?.innerText?.slice(0, 500) || '');
    step('path detail', `${tasks.length} tasks`);
    await shot('path-detail');
    const cta = page.locator('.hero__actions .btn-primary', { hasText: /开始学习|继续当前任务/ });
    if (await cta.count() === 0) throw new Error(`hero 无开始学习按钮：${evidence.heroText}`);
    await cta.first().click();
    await page.waitForURL(/\/learn\//, { timeout: 30_000 });
    const taskId = (page.url().match(/\/learn\/([^/?#]+)/) || [])[1];
    writeState({ taskId, taskOpenedAt: new Date().toISOString() });
    evidence.taskId = taskId;
    evidence.learnUrl = page.url();
    step('entered classroom', taskId);
    // 顺势等开场（开场 LLM 生成，给 300s）
    const t0 = Date.now();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('.msg--ai .msg__bubble:not(.msg__bubble--typing)')];
      return b.length > 0 && b[b.length - 1].textContent.trim().length > 30;
    }, { timeout: 300_000 });
    evidence.openingMs = Date.now() - t0;
    const snap = await classroomSnapshot(page);
    evidence.opening = snap;
    await shot('classroom-opening');
    step('opening arrived', { openingMs: evidence.openingMs, aiCount: snap.bubbles.ais.length });
  },

  async 'learn-open'({ page, evidence, step, shot, state }) {
    const taskId = state.taskId;
    await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    for (let r = 0; r < 2 && page.url().includes('/login'); r += 1) {
      await sleep(2500);
      await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    const t0 = Date.now();
    await page.waitForFunction(() => {
      const b = [...document.querySelectorAll('.msg--ai .msg__bubble:not(.msg__bubble--typing)')];
      return b.length > 0 && b[b.length - 1].textContent.trim().length > 30;
    }, { timeout: 300_000 });
    const idle = await waitTurnIdle(page, 300_000, 3, 1500);
    const snap = await classroomSnapshot(page);
    evidence.snapshot = snap;
    evidence.waitMs = Date.now() - t0;
    evidence.idleMs = idle.ms;
    await shot('classroom-state');
    step('classroom ready', { aiCount: snap.bubbles.ais.length, checkpoint: !!snap.checkpoint });
  },

  async 'learn-state'({ page, evidence, step, shot, state }) {
    const taskId = state.taskId;
    await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.composer', { timeout: 60_000 });
    await waitTurnIdle(page, 120_000, 2, 1500).catch(() => {});
    const snap = await classroomSnapshot(page);
    evidence.snapshot = snap;
    await shot('classroom-state');
    step('state dumped', { aiCount: snap.bubbles.ais.length, checkpoint: snap.checkpoint?.title || null });
  },

  async 'learn-send'({ page, evidence, step, shot, state }, text) {
    const taskId = state.taskId;
    await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.composer .composer__textarea', { timeout: 60_000 });
    // 若回程页带一场在途生成，先等完
    await waitTurnIdle(page, 180_000, 2, 1500).catch(() => {});
    const turn = await sendClassroomMessage(page, text, evidence, step);
    // 回合结束后：检查点卡可能已出现
    await sleep(2000);
    const checkpoint = await readCheckpoint(page);
    const snap = await classroomSnapshot(page);
    evidence.checkpoint = checkpoint;
    evidence.lastAiFull = snap.bubbles.ais[snap.bubbles.ais.length - 1]?.text || '';
    await shot(checkpoint ? 'checkpoint-appeared' : 'turn-end');
    step('post-turn', { checkpoint: checkpoint ? `${checkpoint.type}:${checkpoint.title}` : 'none' });
  },

  async 'cp-skip'({ page, evidence, step, shot, state }) {
    const taskId = state.taskId;
    await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.checkpoint', { timeout: 60_000 });
    const before = await readCheckpoint(page);
    evidence.before = before;
    if (!before.hasSkipButton) throw new Error(`该检查点没有「跳过」按钮：${JSON.stringify(before.actionLabels)}`);
    await shot('cp-skip-before');
    await page.locator('.checkpoint__actions span.btn-ghost', { hasText: '跳过' }).click();
    step('skip clicked', before.actionLabels);
    // 观察窗 10s：有无二次确认弹层 / 报错 toast / 卡片消失
    const watch = { confirmDialog: null, toast: [], cardGoneAtMs: null };
    const t0 = Date.now();
    for (let i = 0; i < 20; i += 1) {
      const st = await page.evaluate(() => ({
        confirm: document.querySelector('.mk-confirm') ? {
          title: document.querySelector('.mk-confirm__title')?.textContent?.trim(),
          msg: document.querySelector('.mk-confirm__msg')?.textContent?.trim(),
          buttons: [...document.querySelectorAll('.mk-confirm__actions button')].map((b) => b.textContent.trim()),
        } : null,
        toasts: [...document.querySelectorAll('[class*="toast"]')].map((e) => e.textContent.trim()).filter(Boolean),
        card: !!document.querySelector('.checkpoint'),
      })).catch(() => ({ confirm: null, toasts: [], card: true }));
      if (st.confirm && !watch.confirmDialog) watch.confirmDialog = st.confirm;
      if (st.toasts.length) watch.toast = [...new Set([...watch.toast, ...st.toasts])];
      if (!st.card && watch.cardGoneAtMs === null) watch.cardGoneAtMs = Date.now() - t0;
      if (!st.card && i > 4) break;
      await sleep(500);
    }
    evidence.skipWatch = watch;
    await shot('cp-skip-after');
    step('skip done', JSON.stringify(watch));
    // skip 不触发教学回合（teaching-session-ops.ts:118 注释）：等 3s 记录页面终态
    await sleep(3000);
    evidence.after = await classroomSnapshot(page);
    await shot('cp-skip-settled');
  },

  async 'cp-answer'({ page, evidence, step, shot, state }, opts = {}) {
    const taskId = state.taskId;
    await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.checkpoint', { timeout: 60_000 });
    const cp = await readCheckpoint(page);
    evidence.before = cp;
    await shot('cp-before');
    if (opts.pick) {
      const subs = String(opts.pick).split('|').map((s) => s.trim());
      for (const sub of subs) {
        const opt = page.locator('.checkpoint__option', { hasText: sub }).first();
        if (await opt.count() === 0) throw new Error(`找不到含「${sub}」的选项：${JSON.stringify(cp.options)}`);
        await opt.click();
        step('option picked', sub);
      }
    } else if (opts.text) {
      await page.fill('.checkpoint__input', opts.text);
      step('answer filled', opts.text.slice(0, 80));
    } else {
      throw new Error('cp-answer 需要 --text 或 --pick');
    }
    await shot('cp-filled');
    const tSubmit = Date.now();
    await page.locator('.checkpoint__actions [role="button"]', { hasText: /提交|判定中/ }).first().click();
    step('submitted');
    // 流式判定：等 feedback 出现（judgement 秒判），再等流式讲解结束
    let judgeMs = null;
    let judgeText = '';
    for (let i = 0; i < 120; i += 1) {
      const fb = await page.evaluate(() => document.querySelector('.checkpoint__feedback')?.textContent?.trim() || '');
      if (fb) { judgeMs = Date.now() - tSubmit; judgeText = fb; break; }
      await sleep(500);
    }
    evidence.judgeMs = judgeMs;
    evidence.judgeFirstText = judgeText;
    step('judgement visible', { judgeMs, judgeText: judgeText.slice(0, 120) });
    await shot('cp-judged');
    // 等讲解流结束：feedback 文本稳定 + 无 stop 按钮，连续 3 次
    let stableText = judgeText;
    let stable = 0;
    const tStream = Date.now();
    for (let i = 0; i < 240; i += 1) {
      await sleep(1000);
      const st = await page.evaluate(() => ({
        fb: document.querySelector('.checkpoint__feedback')?.textContent?.trim() || '',
        stop: !!document.querySelector('.composer__send--stop'),
        card: !!document.querySelector('.checkpoint'),
      }));
      if (st.fb && st.fb === stableText && !st.stop) { stable += 1; } else { stable = 0; stableText = st.fb || stableText; }
      if (stable >= 3) break;
      if (st.fb) stableText = st.fb;
      if (!st.card) { evidence.cardClosedDuringStream = true; break; }
    }
    evidence.streamSettledMs = Date.now() - tStream;
    evidence.finalFeedback = stableText;
    step('stream settled', { ms: evidence.streamSettledMs, fb: stableText.slice(0, 200) });
    await shot('cp-explained');
    // 答对 3s 自动收起；等卡片消失/或「继续 ›」在（答错）
    await sleep(4500);
    const after = await classroomSnapshot(page);
    evidence.checkpointAfter = after.checkpoint;
    evidence.lastAiFull = after.bubbles.ais[after.bubbles.ais.length - 1]?.text || '';
    await shot('cp-settled');
    step('settled', { cardStill: !!after.checkpoint, aiCount: after.bubbles.ais.length });
  },

  async 'learn-complete'({ page, evidence, step, shot, state }) {
    const taskId = state.taskId;
    await page.goto(`${BASE_UI}/learn/${taskId}`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('.lesson-cta', { timeout: 60_000 });
    await waitTurnIdle(page, 180_000, 2, 1500).catch(() => {});
    await page.locator('.lesson-cta').click();
    step('完成本课 clicked');
    await page.waitForSelector('.mk-confirm', { timeout: 20_000 });
    evidence.confirmDialog = await page.evaluate(() => ({
      title: document.querySelector('.mk-confirm__title')?.textContent?.trim(),
      msg: document.querySelector('.mk-confirm__msg')?.textContent?.trim(),
      buttons: [...document.querySelectorAll('.mk-confirm__actions button')].map((b) => b.textContent.trim()),
    }));
    step('confirm dialog', JSON.stringify(evidence.confirmDialog));
    await shot('complete-confirm');
    await page.locator('.mk-confirm__actions .mk-btn--primary').click();
    step('confirmed 完成并结算');
    // 等 .finish 完成浮层（finalize：revision 同步 + 202 pollUntilSettled + wrapup）
    const t0 = Date.now();
    await page.waitForSelector('.finish__card', { timeout: 600_000 });
    // 等浮层数据齐（wrapupText/stats）：文本稳定 3 次
    let stable = 0; let last = '';
    for (let i = 0; i < 120; i += 1) {
      const t = await page.evaluate(() => document.querySelector('.finish__card')?.innerText?.trim() || '');
      if (t && t === last) { stable += 1; } else { stable = 0; last = t; }
      if (stable >= 3 && t.length > 20) break;
      await sleep(1000);
    }
    evidence.settleMs = Date.now() - t0;
    evidence.finishCard = last;
    step('finish card', { settleMs: evidence.settleMs, text: last.slice(0, 300) });
    await shot('finish-card');
    // 进课后反馈页
    const evalBtn = page.locator('.finish__actions .btn-ghost', { hasText: '查看学习反馈' });
    if (await evalBtn.count() > 0) {
      await evalBtn.click();
      await page.waitForURL(/\/evaluation\//, { timeout: 30_000 });
      evidence.evaluationUrl = page.url();
      writeState({ evaluationUrl: page.url() });
      step('evaluation page', evidence.evaluationUrl);
      await page.waitForTimeout(6000);
      evidence.evaluationText = await page.evaluate(() => document.body.innerText.slice(0, 4000));
      await shot('evaluation-page');
    } else {
      evidence.evaluationNote = '完成浮层上没有「查看学习反馈」按钮（evaluationUrl 为空？）';
      step('no evaluation button');
    }
  },

  async login({ page, evidence, step, shot, state }) {
    if (!state.name || !state.password) throw new Error('state 缺账号');
    await page.goto(`${BASE_UI}/login`, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.fill('input[type="text"], input[autocomplete="username"]', state.name);
    await page.fill('input[type="password"]', state.password);
    await page.click('button[type="submit"], .btn-primary');
    await page.waitForURL((u) => !String(u).includes('/login'), { timeout: 30_000 });
    evidence.afterLoginUrl = page.url();
    step('logged in', evidence.afterLoginUrl);
    const storageStatePath = state.storageStatePath;
    await page.context().storageState({ path: storageStatePath });
    step('storageState refreshed', storageStatePath);
  },

  async 'eval-dump'({ page, evidence, step, shot, state }) {
    const url = state.evaluationUrl
      || `${BASE_UI}/learn/${state.taskId}/evaluation/${state.sessionId}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForSelector('main, body', { timeout: 30_000 });
    await page.waitForTimeout(6000);
    evidence.url = page.url();
    // 结构化取证：分区标题 + 回放（当堂对话）气泡数 + replan 卡
    evidence.structure = await page.evaluate(() => {
      const headings = [...document.querySelectorAll('h1,h2,h3')].map((h) => h.textContent.trim()).filter(Boolean);
      const items = [...document.querySelectorAll('.evaluation-transcript-item')].map((el) => ({
        role: el.className.includes('--user') ? 'user' : (el.className.includes('--assistant') || el.className.includes('--ai') ? 'assistant' : el.className),
        text: (el.querySelector('.evaluation-transcript-item__body')?.textContent || '').trim().slice(0, 80),
      }));
      const meta = document.querySelector('.evaluation-transcript-card__meta')?.textContent?.trim() || '';
      const body = document.body.innerText;
      return {
        headings,
        transcriptMeta: meta,
        replayItems: items,
        replayRenderedCount: items.length,
        hasReplaySection: body.includes('当堂对话'),
        hasThemeSummary: body.includes('主题总结'),
        hasFourDim: /KTL|LSB|LF|LSS/.test(body),
        hasKnowledgePoints: body.includes('知识点掌握'),
        hasNextSteps: body.includes('下一步建议'),
        hasReplanCard: body.includes('确认调整后续阶段') || body.includes('保持原计划'),
        exportButtons: ['导出图片', '打印或另存为 PDF'].filter((t) => body.includes(t)),
      };
    });
    // 回放默认只展示最近若干条：点「展开更早的 N 条消息」补全
    const expand = page.locator('.evaluation-transcript-toggle');
    if (await expand.count() > 0) {
      const label = (await expand.first().textContent() || '').trim();
      if (label.includes('展开更早')) {
        await expand.first().click();
        await page.waitForTimeout(1500);
        evidence.transcriptExpanded = await page.evaluate(() =>
          [...document.querySelectorAll('.evaluation-transcript-item')].length);
        step('transcript expanded', `${evidence.transcriptExpanded} items`);
      }
    }
    step('eval structure', JSON.stringify(evidence.structure));
    await shot('evaluation-page');
    evidence.text = await page.evaluate(() => document.body.innerText.slice(0, 6000));
    // replan 建议卡：以学习者身份点「保持原计划」（拒绝调整，路径不动）
    const keep = page.locator('button', { hasText: '保持原计划' });
    if (await keep.count() > 0) {
      await keep.first().click();
      await page.waitForTimeout(2500);
      evidence.replanAfter = await page.evaluate(() => ({
        cardStill: document.body.innerText.includes('保持原计划'),
        bodyHead: document.body.innerText.slice(0, 400),
      }));
      evidence.replanAction = 'clicked 保持原计划';
      await shot('replan-declined');
      step('replan declined', JSON.stringify(evidence.replanAfter));
    }
  },
};

/* ---------------- main ---------------- */

const [cmd, ...rest] = process.argv.slice(2);
if (!cmd || !commands[cmd]) {
  console.error(`用法: node scripts/measurement-verify/gui1-driver.mjs <${Object.keys(commands).join('|')}> [args...]`);
  process.exit(2);
}
const rawArg = rest.join(' ');
// --text "..." / --pick "..." 形式解析
const opts = {};
let posArg = rawArg;
for (const key of ['text', 'pick']) {
  const m = rawArg.match(new RegExp(`--${key}\\s+"([^"]*)"`));
  if (m) { opts[key] = m[1]; posArg = posArg.replace(m[0], '').trim(); }
}
await withPage(cmd, async (ctx) => { await commands[cmd](ctx, opts.text ?? opts.pick ?? posArg, opts); });
