#!/usr/bin/env node
/**
 * measure-classroom-deslop.mjs —— 课堂「死板机械度」度量（只读，2026-11-07）。
 *
 * 用法：
 *   node backend/scripts/measure-classroom-deslop.mjs <outputs/e2e-longcourse-XXX/result.json>
 *
 * 输入：`scripts/test-live/teaching-longcourse-e2e.mjs` 落盘的 `result.json`
 *      （含 sessions[].turns[]：learner 输入 / aiResponse / checkpoint）。
 *
 * ⚠️ 口径声明（务必按这个读）：下面四个指标是**词汇层面的指针，不是结论**。
 * 「这一课是不是在考刚讲过的原话」「是不是机械复读」是**语义判断**，词汇相似度只能
 * 指出"该看哪几轮"。真正的判断由人（或模型评审）读 transcript 得出——本脚本同时把
 * 逐轮正文写成 transcript.md 就是为了这个。不要把这里的数字当验收结论。
 *
 * 指标：
 *  1. questionEndedTurns   AI 回合正文以问号结尾的数量（7 连问的代理指标）
 *  2. sameVerbStreak       连续回合命中同一个「直接指令动词」的最长连击（同形过堂的代理指标）
 *  3. quizEchoPrevTurn     检查点题面与上一回合 AI 正文的最长公共子串 ≥10 字 → 疑似「讲完立刻考原话」
 *  4. firstMessageMentions 首条 AI 消息是否把清单/样本摊开（含 ≥3 个编号、或一行内 ≥3 个「、」项）
 */
import fs from 'node:fs';
import path from 'node:path';

const target = process.argv[2] || findLatestResult();
if (!target) {
  console.error('用法: node backend/scripts/measure-classroom-deslop.mjs <outputs/e2e-longcourse-*/result.json>');
  process.exitCode = 1;
  process.exit();
}
if (!fs.existsSync(target)) {
  console.error(`找不到结果文件：${target}`);
  process.exitCode = 1;
  process.exit();
}

function findLatestResult() {
  const root = path.resolve(process.cwd(), 'outputs');
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root)
    .filter((d) => d.startsWith('e2e-longcourse-'))
    .sort();
  const last = dirs[dirs.length - 1];
  return last ? path.join(root, last, 'result.json') : null;
}

const DIRECTIVE_VERBS = ['列出', '说出', '写出', '指出', '判断', '还原', '各写', '各说', '挑出', '排成', '分类', '复述', '讲讲', '说说'];
const QUESTION_TAIL = /[？?]\s*$/;
const LIST_ITEM = /(^|\n)\s*(?:\d{1,2}\s*[.、)）]|[（(]\s*\d{1,2}\s*[)）]|[①-⑩]|[-*•])\s+/g;

function normalize(text) {
  return String(text || '')
    .replace(/[\s，。、；：！？「」『』（）()“”"']/g, '')
    .toLowerCase();
}

/** 最长公共子串长度（对归一化文本；只用于找"疑似原话复用"，序列长度都很短） */
function longestCommonSubstring(a, b) {
  if (!a || !b) return 0;
  a = normalize(a);
  b = normalize(b);
  if (!a.length || !b.length) return 0;
  let best = 0;
  let prev = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    const cur = new Array(b.length + 1).fill(0);
    for (let j = 1; j <= b.length; j += 1) {
      if (a[i - 1] === b[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

function directiveVerb(text) {
  for (const verb of DIRECTIVE_VERBS) {
    if (String(text || '').includes(verb)) return verb;
  }
  return null;
}

function listItemCount(text) {
  const matches = String(text || '').match(new RegExp(LIST_ITEM.source, 'g'));
  return matches ? matches.length : 0;
}

function maxSameVerbStreak(turns) {
  let best = 0;
  let run = 0;
  let current = null;
  for (const turn of turns) {
    const verb = directiveVerb(turn.aiResponse);
    if (verb && verb === current) {
      run += 1;
    } else if (verb) {
      current = verb;
      run = 1;
    } else {
      current = null;
      run = 0;
    }
    if (run > best) best = run;
  }
  return best;
}

const result = JSON.parse(fs.readFileSync(target, 'utf8'));
const outDir = path.dirname(target);
const sessions = Array.isArray(result.sessions) ? result.sessions : [];

const summary = [];
const transcript = ['# 课堂逐轮正文（供人读）', '', `来源：\`${target}\``, ''];

sessions.forEach((session, sIndex) => {
  const turns = Array.isArray(session.turns) ? session.turns : [];
  const questionEnded = turns.filter((t) => QUESTION_TAIL.test(String(t.aiResponse || '').trim())).length;
  const quizEchoes = [];
  turns.forEach((t, i) => {
    const question = String(t.checkpoint?.question || '');
    if (!question) return;
    const prev = i > 0 ? String(turns[i - 1].aiResponse || '') : '';
    const same = longestCommonSubstring(question, prev);
    if (same >= 10) quizEchoes.push({ turn: i + 1, overlap: same, question: question.slice(0, 60) });
  });
  const first = turns[0]?.aiResponse || '';
  const firstListItems = listItemCount(first);

  summary.push({
    session: session.sessionId,
    order: sIndex + 1,
    turns: turns.length,
    questionEndedTurns: `${questionEnded}/${turns.length}`,
    maxSameVerbStreak: maxSameVerbStreak(turns),
    quizEchoPrevTurn: quizEchoes.length,
    firstMessageListItems: firstListItems,
    firstMessageChars: String(first).length,
  });

  transcript.push(`## 第 ${sIndex + 1} 节课 session=${session.sessionId}`, '');
  turns.forEach((t, i) => {
    transcript.push(`### 回合 ${i + 1}`, '');
    transcript.push(`**学生**：${String(t.body?.message || '').slice(0, 400)}`, '');
    transcript.push(`**老师**：${String(t.aiResponse || '').slice(0, 2000)}`, '');
    if (t.checkpoint?.question) {
      transcript.push(`**[卡片]** ${String(t.checkpoint.question).slice(0, 400)}`, '');
      const options = Array.isArray(t.checkpoint.options) ? t.checkpoint.options : [];
      if (options.length) {
        transcript.push(`**[选项]** ${options.map((o) => `${o.id}. ${String(o.text).slice(0, 120)}`).join(' / ')}`, '');
      }
    }
  });
  if (quizEchoes.length) {
    transcript.push('### 疑似「讲完立刻考原话」（题面与上一回合正文重合 ≥10 字，需人读确认）', '');
    quizEchoes.forEach((e) => transcript.push(`- 回合 ${e.turn}（重合 ${e.overlap} 字）：${e.question}`));
    transcript.push('');
  }
});

console.log(JSON.stringify({ source: target, sessions: summary }, null, 1));
fs.writeFileSync(path.join(outDir, 'transcript.md'), `${transcript.join('\n')}\n`, 'utf8');
console.log(`\n逐轮正文已写出：${path.join(outDir, 'transcript.md')}`);
