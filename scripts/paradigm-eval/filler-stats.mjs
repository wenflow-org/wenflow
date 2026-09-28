#!/usr/bin/env node
/**
 * 离线 filler 统计（R6-1 观测面）：对 rw-* 路径逐阶段跑 stage-filler 检测器算法副本，
 * 输出每路径 duplicatePairs/repeatedObjects 计数。纯读 DB，不碰后端。
 * 用法：node filler-stats.mjs [--ids=results/xxx.txt] [--since=epochMs]
 */
import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (n, d) => { const h = process.argv.find((a) => a.startsWith(`--${n}=`)); return h ? h.split('=').slice(1).join('=') : d; };

const STOP = ['回补', '重推', '重做', '验证', '梳理', '整理', '对照', '盘点', '合上书', '基础题',
  '前置概念', '综合', '闭环', '复现', '自查', '形成', '输出', '制定', '明确', '例题'];
const VOCAB = ['三角函数', '数列', '立体几何', '平面向量', '解三角形', '导数', '函数', '不等式',
  '解析几何', '统计概率', '复数', '算法', '集合', '逻辑用语', '力学', '电磁学', '电学', '欧姆定律',
  '错位清单', '错题', '长投', '增值税', '申论', '资料分析', '数量关系', '听力', '词汇', '口语',
  '写作', '阅读', '分录', '民法', '刑法', '行政法', '挣值', '敏捷', 'SQL', 'Python', 'RAG', 'Zotero', '回归', '问卷'];

const norm = (t) => { let s = String(t || ''); for (const w of STOP) s = s.split(w).join(''); return s.replace(/[\s，。、；：:；,.;/／·\-—－()（）[\]【】"'“”‘’]/g, ''); };
const bigrams = (s) => { const o = new Set(); for (let i = 0; i < s.length - 1; i++) o.add(s.slice(i, i + 2)); if (s.length === 1) o.add(s); return o; };
const sim = (a, b) => { const na = norm(a), nb = norm(b); if (!na || !nb) return 0; if (na === nb) return 1; const A = bigrams(na), B = bigrams(nb); let i = 0; for (const g of A) if (B.has(g)) i++; return i / (A.size + B.size - i); };
const objects = (t) => { const n = norm(t); return VOCAB.filter((v) => n.includes(v)); };

const db = new DatabaseSync(`file:${path.resolve(HERE, '../../backend/prisma/dev.db')}?mode=ro`, { readOnly: true });
let users;
const idsFile = arg('ids', '');
if (idsFile) {
  const ids = fs.readFileSync(path.join(HERE, idsFile), 'utf8').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  users = ids.map((id) => 'pe-' + id.replace(/^pe-/, ''));
} else {
  users = db.prepare("SELECT name FROM users WHERE name LIKE 'pe-rw-%'").all().map((r) => r.name);
}
const since = Number(arg('since', '0'));

let totalPaths = 0;
let flaggedPaths = 0;
let totalDupPairs = 0;
let totalRepeatObjects = 0;
const detail = [];
for (const u of users) {
  const paths = db.prepare('SELECT p.id FROM learning_paths p JOIN users us ON p.userId=us.id WHERE us.name=? AND p.createdAt>? ORDER BY p.createdAt').all(u, since);
  for (const p of paths) {
    const ms = db.prepare('SELECT id, stageNumber FROM milestones WHERE learningPathId=? ORDER BY stageNumber').all(p.id);
    let dupPairs = 0;
    let repeatObjects = 0;
    const examples = [];
    for (const m of ms) {
      const titles = db.prepare('SELECT title FROM subtasks WHERE milestoneId=? ORDER BY "order"').all(m.id).map((r) => r.title);
      for (let i = 0; i < titles.length; i++) {
        for (let j = i + 1; j < titles.length; j++) {
          if (sim(titles[i], titles[j]) >= 0.7) { dupPairs++; examples.push(`M${m.stageNumber} 复读: ${titles[i].slice(0, 18)}`); }
        }
      }
      const byObj = new Map();
      for (const t of titles) for (const o of objects(t)) { const arr = byObj.get(o) || []; if (!arr.includes(t)) arr.push(t); byObj.set(o, arr); }
      for (const [o, hits] of byObj) {
        if (hits.length >= 3) { repeatObjects++; examples.push(`M${m.stageNumber} 「${o}」×${hits.length}`); }
      }
    }
    totalPaths++;
    if (dupPairs + repeatObjects > 0) {
      flaggedPaths++;
      totalDupPairs += dupPairs;
      totalRepeatObjects += repeatObjects;
      detail.push(`${u.replace('pe-', '')}: 复读对${dupPairs} 对象复现${repeatObjects} | ${examples.slice(0, 4).join(' ; ')}`);
    }
  }
}
console.log(`paths=${totalPaths} flagged=${flaggedPaths} (${((flaggedPaths / Math.max(1, totalPaths)) * 100).toFixed(0)}%) 复读对合计=${totalDupPairs} 对象复现合计=${totalRepeatObjects}`);
for (const d of detail) console.log(' ', d);
