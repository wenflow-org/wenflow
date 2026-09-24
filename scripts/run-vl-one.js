import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const BASE = 'http://127.0.0.1:3001';
const DB_PATH = path.join(ROOT, 'backend', 'prisma', 'dev.db');
const KEY = process.argv[2] || 'shop-owner-inventory';

let cookie = '';
const sleep = ms => new Promise(r => setTimeout(r, ms));
const openDb = () => new DatabaseSync(DB_PATH, { readOnly: true });
const log = msg => console.log('[' + new Date().toISOString().slice(11, 19) + '] ' + msg);

async function login() {
  const env = fs.readFileSync(path.join(ROOT, 'backend', '.env'), 'utf8');
  const get = k => (env.match(new RegExp('^' + k + '=(.*)$', 'm')) || [])[1]?.trim() || '';
  const res = await fetch(BASE + '/api/admin-auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: 'http://localhost:5173' },
    body: JSON.stringify({ name: get('INIT_ADMIN_NAME'), password: get('INIT_ADMIN_PASSWORD'), remember: true }),
  });
  cookie = (res.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie) throw new Error('login failed');
}

async function api(method, urlPath, bodyObj, retries = 4) {
  const headers = { Cookie: cookie, Origin: 'http://localhost:5173' };
  if (bodyObj !== undefined) headers['Content-Type'] = 'application/json';
  let lastErr = null;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const res = await fetch(BASE + urlPath, { method, headers, body: bodyObj !== undefined ? JSON.stringify(bodyObj) : undefined, signal: AbortSignal.timeout(600000) });
      const text = await res.text();
      let json; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 300) }; }
      if (!res.ok || json?.success === false) {
        lastErr = (json?.error?.message || json?.error || text).slice(0, 200);
        if (res.status === 409 || res.status >= 500 || res.status === 429) {
          await sleep(15000 * (attempt + 1));
          continue;
        }
        throw new Error(method + ' ' + urlPath + ': ' + lastErr);
      }
      return json;
    } catch (e) {
      lastErr = (e.cause?.code ? e.cause.code + ' ' : '') + e.message;
      await sleep(10000 * (attempt + 1));
    }
  }
  throw new Error(method + ' ' + urlPath + ' failed: ' + lastErr);
}

function q(sql, params) {
  const db = openDb();
  const r = db.prepare(sql).get(...(params || []));
  db.close();
  return r;
}
function qa(sql, params) {
  const db = openDb();
  const r = db.prepare(sql).all(...(params || []));
  db.close();
  return r;
}

async function main() {
  await login();
  log('=== ' + KEY + ' ===');
  const profile = q('SELECT id, userId FROM virtual_learner_profiles WHERE presetKey=?', [KEY]);
  if (!profile) { log('no profile'); return; }
  log('profile=' + profile.id);

  // clear old sessions
  const oldSessions = qa('SELECT id FROM virtual_sessions WHERE virtualProfileId=?', [profile.id]);
  for (const s of oldSessions) {
    try { await api('DELETE', '/api/admin/virtual-learners/sessions/' + s.id); } catch {}
  }
  log('cleared ' + oldSessions.length + ' old sessions');

  // start session
  const detail = await api('GET', '/api/admin/virtual-learners/' + profile.id);
  const stories = detail?.data?.profile?.storyPool || [];
  if (!stories.length) { log('no story'); return; }
  const storyId = stories[0].id || stories[0].storyId;
  log('story: ' + (stories[0].title || 'untitled'));

  const started = await api('POST', '/api/admin/virtual-learners/' + profile.id + '/start-session', { storyId });
  const sessionId = started?.data?.id;
  if (!sessionId) throw new Error('start-session failed');
  log('session: ' + sessionId.slice(0, 8));

  // run-full Goal -> Path only
  log('running Goal -> Path ...');
  const t0 = Date.now();
  const result = await api('POST', '/api/admin/virtual-learners/sessions/' + sessionId + '/run-full', {
    maxRounds: 30, maxMilestones: 10, continueOnTaskComplete: false, autoAdvanceToPath: true, autoAdvanceToLearning: false,
  });
  const dt = ((Date.now() - t0) / 1000).toFixed(0);
  const d = result?.data || {};
  log('done (' + dt + 's) goalRounds=' + d.goalRounds + ' pathGenerated=' + d.pathGenerated + ' finalStage=' + d.finalStage);
  if (d.error) log('  error: ' + String(d.error).slice(0, 120));

  // wait for stage-designer subtasks
  let ms = 0, st = 0;
  for (let w = 0; w < 40; w++) {
    const lp = q('SELECT id FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [profile.userId]);
    if (lp) {
      ms = q('SELECT COUNT(*) c FROM milestones WHERE learningPathId=?', [lp.id])?.c || 0;
      st = q('SELECT COUNT(*) c FROM subtasks s JOIN milestones m ON m.id=s.milestoneId WHERE m.learningPathId=?', [lp.id])?.c || 0;
      if (st > 0) break;
    }
    await sleep(5000);
  }

  // read path details
  const lp = q('SELECT id, aiPromptTemplate FROM learning_paths WHERE userId=? ORDER BY updatedAt DESC LIMIT 1', [profile.userId]);
  if (!lp) { log('no path found'); return; }
  let scopeSize = null, targetM = null, targetS = null, milestoneRange = null, timeHorizon = null;
  try {
    const t = JSON.parse(lp.aiPromptTemplate);
    const ph = t.sceneFraming?.normalizedInput?.planningHints;
    scopeSize = ph?.scopeSize || null;
    targetM = ph?.targetMilestones ?? null;
    targetS = ph?.targetSubtasksPerStage ?? null;
    milestoneRange = ph?.milestoneRange || null;
    timeHorizon = t.sceneFraming?.normalizedInput?.resources?.timeHorizon || null;
  } catch {}

  const milestones = qa('SELECT stageNumber, title FROM milestones WHERE learningPathId=? ORDER BY stageNumber', [lp.id]);

  log('');
  log('=== RESULT ===');
  log('scope_size:  ' + scopeSize);
  log('milestones:  ' + ms + ' (target=' + targetM + ') range=' + JSON.stringify(milestoneRange));
  log('subtasks:    ' + st + ' (targetSubtaskPerStage=' + targetS + ')');
  log('timeHorizon: ' + timeHorizon);
  milestones.forEach(m => log('  M' + m.stageNumber + ': ' + m.title));
}

main().catch(e => { console.error('FATAL', e.message); process.exit(1); });
