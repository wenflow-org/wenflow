#!/usr/bin/env node
/**
 * UI 文案反模式门禁（基线化：只拦「相对基线的新增」，便于存量分批清理）
 *
 * 规则（详见 doc/local/copy-audit-2026-10-14/REPORT.md §6）：
 *   R1 分号拼接：一句塞两事
 *   R2 隔空指路：右上角 / 下方 / 左侧 / 切到 / 页头 …
 *   R3 交互说明书：点击…可 / 点此 / 悬停 / 再点一次 …
 *   R4 实现外露：内部词、英文枚举、下划线键名、点分路径、接口路径（词典见 ui-copy-terms.json）
 *   R5 emoji：界面文案不使用 emoji（替代=色块+字标 / 线性图标）
 *   R6 同文件重复：同一句文案在同一文件出现 ≥2 次（复读）
 *
 * 用法：
 *   node scripts/check-ui-copy.mjs            # 与基线比对，新增即失败
 *   node scripts/check-ui-copy.mjs --list     # 列出全部命中（含行号），用于改造
 *   node scripts/check-ui-copy.mjs --rule R1  # 只看某条规则
 *   node scripts/check-ui-copy.mjs --update   # 写入/刷新基线
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.resolve(HERE, '../src');
const BASELINE = path.join(HERE, 'ui-copy-baseline.json');
const TERMS = JSON.parse(fs.readFileSync(path.join(HERE, 'ui-copy-terms.json'), 'utf8'));

const ATTRS = 'title|hint|placeholder|label|meta|aria-label|empty|desc|sub|note|tip|help|ariaLabel';
/* 区分静态属性与绑定属性：静态值整体就是文案；绑定值是**表达式**，只取其中的字符串字面量，
   否则 `:title="s.storyCount > 0 ? '…' : '…'"` 里的属性访问会被 R4 误判成「点分路径」。 */
const ATTR_RE = new RegExp(`(v-bind:|:)?(?:${ATTRS})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|\`([^\`]*)\`)`, 'g');
const LITERAL_RE = /'([^'\\\n]{2,})'|"([^"\\\n]{2,})"|`([^`\\\n]{2,})`/g;
const RULES = {
  R1: (s) => (/；/.test(s) ? '含分号（一句两事，拆开）' : null),
  R2: (s) => {
    const m = s.match(/右上角|左上角|右下角|左下角|见下方|见上方|见下表|见上表|详见|参见|左上|右侧|左侧|顶栏|页头|下方|上方|切到|切换到/);
    return m ? `隔空指路「${m[0]}」` : null;
  },
  R3: (s) => {
    const m = s.match(/点击(?!率|量|总数)[^，。；：]{0,10}?(?:可|可以|即可|就能|后|进入|查看|直达)|点此|单击|双击|悬停|鼠标(?:移|放|悬)|再点一次|点开|点击切换|点击恢复/);
    return m ? `交互说明书「${m[0]}」` : null;
  },
  R4: (s) => {
    /* 先剔除 URL / 域名：`https://api.openai.com/v1`、`@test.local` 这类示例地址是正常文案，
       否则会被 forbiddenPatterns 的「点分路径」误判成实现外露。 */
    const t = s.replace(/https?:\/\/\S+/g, ' ').replace(/\b[a-z0-9-]+\.(?:com|cn|org|io|net|local|dev|top)\b/gi, ' ');
    const hit = TERMS.forbidden.find((f) => t.includes(f.term));
    if (hit) return `内部词「${hit.term}」→ ${hit.suggested}`;
    const en = t.match(new RegExp(`\\b(${TERMS.forbiddenEnums.join('|')})\\b`));
    if (en) return `英文枚举「${en[0]}」`;
    for (const p of TERMS.forbiddenPatterns) {
      if (new RegExp(p.re).test(t)) return `实现细节（${p.why}）`;
    }
    return null;
  },
  R5: (s) => (/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]/u.test(s) ? '文案含 emoji' : null)
};

/* 免检文件：开发者文档 **有意**展示目录树 / 命令 / 字段名，是内容不是文案缺陷。 */
const SKIP_FILES = new Set(['views/DeveloperDocs.vue']);

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      /* 工具产物目录（.zcode workflow 草稿/运行记录、.mimosa 钩子快照）不进构建，不是产品文案。 */
      if (e.name === '__tests__' || e.name === 'test' || e.name.startsWith('.')) continue;
      walk(p, out);
    } else if (e.name.endsWith('.vue') || e.name.endsWith('.ts') || e.name.endsWith('.js')) {
      if (e.name.endsWith('.d.ts')) continue;
      out.push(p);
    }
  }
  return out;
}

/** 取出一行里所有「用户可见文案」候选 */
function candidates(line, isVue) {
  const out = [];
  if (isVue) {
    /* 先在**整行**剥离插值，再切文本节点：行内箭头函数 `(c) => …` 里的 `>` 会把文本节点切碎，
       残片会带出 c.tone 之类的属性访问（误报），也会让真文案被切掉（漏报）。
       注：跨行的文本节点由 scan() 的整块扫描负责，这里只兜本行的。 */
    const clean = line.replace(/\{\{(?:[^{}]|\{[^{}]*\})*\}\}/g, ' ');
    for (const m of clean.matchAll(/>([^<>]{2,})</g)) out.push(m[1]);
    ATTR_RE.lastIndex = 0;
    for (const m of line.matchAll(ATTR_RE)) {
      const bound = !!m[1];
      const v = m[2] ?? m[3] ?? m[4];
      if (!v || !v.trim()) continue;
      if (!bound) {
        out.push(v);
        continue;
      }
      LITERAL_RE.lastIndex = 0;
      for (const lit of v.matchAll(LITERAL_RE)) {
        const s = lit[1] ?? lit[2] ?? lit[3];
        if (s && s.trim()) out.push(s);
      }
    }
  } else {
    for (const m of line.matchAll(/'([^'\\\n]{2,})'|"([^"\\\n]{2,})"|`([^`\\\n]{2,})`/g)) {
      const v = m[1] ?? m[2] ?? m[3];
      if (v && v.trim()) out.push(v);
    }
  }
  return out
    /* 剥离模板插值与模板字面量表达式：`{{ a.b }}` / `${x.y}` 里的点分与下划线是**代码**不是文案，
       否则 R4 会把 material.name、runStats.abandoned 这类属性访问当成「实现外露」误报。
       允许一层嵌套花括号（`${x ? \`…${y}…\` : ''}`），否则嵌套三元里的属性访问仍会漏出。 */
    .map((s) => s.replace(/\{\{(?:[^{}]|\{[^{}]*\})*\}\}/g, ' ').replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' '))
    /* 剥离后仍残留 `${` / `{{` 说明是嵌套更深的表达式片段（不是完整文案），整条丢弃，
       否则会把 `日${c.minutes ? …` 这类当文案判 R4。
       同理丢弃含 `}}` / `=>` / `);` 的碎片——行内箭头函数里的 `>` 会把文本节点切碎，
       残片会带出 `c.tone` 这种属性访问，属误报。 */
    .filter((s) => !s.includes('${') && !s.includes('{{') && !s.includes('}}'))
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s && /[\u4e00-\u9fff]/.test(s) && !/^\{\{?\s*[\w.$]*\s*\}?\}$/.test(s));
}

function scan() {
  const findings = [];
  /* R6 用：同一文件内同一句文案出现的行号（AP8「同页复读」的机械代理） */
  const perFile = new Map();
  for (const file of walk(SRC)) {
    const rel = path.relative(SRC, file).replace(/\\/g, '/');
    if (SKIP_FILES.has(rel)) continue;
    const isVue = file.endsWith('.vue');
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
    const raw = lines.join('\n');
    const recorded = new Set(); // 去重：整块扫描与逐行扫描会命中同一处
    const emit = (text, line) => {
      const key = line + '\u0000' + text;
      if (recorded.has(key)) return;
      recorded.add(key);
      if (!perFile.has(rel)) perFile.set(rel, new Map());
      const m = perFile.get(rel);
      if (!m.has(text)) m.set(text, []);
      m.get(text).push(line);
      for (const [rule, fn] of Object.entries(RULES)) {
        const why = fn(text);
        if (why) findings.push({ file: rel, line, rule, why, text: text.slice(0, 120) });
      }
    };
    let mode = null; // 跳过 style / script 区块（仅 .vue）
    lines.forEach((line, i) => {
      if (isVue) {
        if (/<style[\s>]/.test(line)) mode = 'style';
        else if (/<\/style>/.test(line)) mode = null;
        else if (/<script[\s>]/.test(line)) mode = 'script';
        else if (/<\/script>/.test(line)) mode = null;
        if (mode) return;
      }
      /* 注释行不是文案：ts 的 // 与块注释、模板里 // 开头的行都跳过。 */
      if (/^\s*(\/\/|\/\*|\*)/.test(line)) return;
      const seen = new Set();
      for (const text of candidates(line, isVue)) {
        if (seen.has(text)) continue;
        seen.add(text);
        emit(text, i + 1);
      }
    });
    /* 整块模板扫描：补「跨行文本节点」——`>` 在上一行时逐行扫描取不到，属取词盲区。
       先把模板里的注释/style/script 与插值都去掉，再按偏移折算行号。 */
    if (isVue) {
      const stripped = raw
        .replace(/<style[\s\S]*?<\/style>/g, (m2) => m2.replace(/[^\n]/g, ' '))
        .replace(/<script[\s\S]*?<\/script>/g, (m2) => m2.replace(/[^\n]/g, ' '))
        .replace(/<!--[\s\S]*?-->/g, (m2) => m2.replace(/[^\n]/g, ' '))
        .replace(/\{\{(?:[^{}]|\{[^{}]*\})*\}\}/g, ' ')
        .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ');
      const lineAt = (idx) => stripped.slice(0, idx).split('\n').length;
      for (const m of stripped.matchAll(/>([^<>]{2,})</g)) {
        const t = m[1].replace(/\s+/g, ' ').trim();
        if (t && /[\u4e00-\u9fff]/.test(t)) emit(t, lineAt(m.index));
      }
      /* script 块的字符串字面量：toast / 空态 / 错误提示 / 状态标签 / KPI title 等**会被渲染到界面**
         的字符串也住在 <script> 里，此前不扫 → 是最大的取词盲区（实测漏 190 处）。
         取字面量前先抹掉正则字面量与注释：`[*`~#>]` 这类含反引号的正则会把匹配起点带偏，
         把两把反引号之间的整段代码/注释吞成「模板字符串」（实测在 V2LearningHistory 等文件
         造出成片假阳性）；注释里的中文不是文案，一并抹掉。 */
      const sm = raw.match(/<script[\s\S]*?<\/script>/);
      if (sm) {
        /* 剥离顺序有讲究：先 ${…}（模板表达式常含正则/斜杠，先抹掉可免得正则剥离器
           把 `a/${x}/b` 里的斜杠误判成正则定界符），再正则字面量（`[*`~#>]` 这类含反引号
           的正则会把反引号配对带偏），最后注释（注释里的中文不是文案）。 */
        const code = sm[0]
          .replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, (m2) => m2.replace(/[^\n]/g, ' '))
          .replace(/\/(?![/*])(?:\\.|\[(?:[^\]\\]|\\.)*\]|[^/\\\n])+\/[gimsuy]*(?![a-zA-Z0-9_$])/g, (m2) => m2.replace(/[^\n]/g, ' '))
          .replace(/(?<!:)\/\/[^\n]*/g, (m2) => m2.replace(/[^\n]/g, ' '))
          .replace(/\/\*[\s\S]*?\*\//g, (m2) => m2.replace(/[^\n]/g, ' '));
        const scriptStart = raw.slice(0, sm.index).split('\n').length - 1;
        for (const lit of code.matchAll(/'((?:[^'\\\n]|\\.){4,})'|`((?:[^`\\]|\\.){4,})`/g)) {
          const t = (lit[1] ?? lit[2] ?? '').replace(/\$\{(?:[^{}]|\{[^{}]*\})*\}/g, ' ').replace(/\s+/g, ' ').trim();
          if (!t || !/[\u4e00-\u9fff]/.test(t)) continue;
          if (t.includes('${') || t.includes('{{')) continue;
          /* 兜底滤网：嵌套模板/未剥净的引号会让配对错位，把代码吞成「文案」。
             真文案不会含 const/function/return/=> 这类代码标记，命中即丢。 */
          if (/\b(const|let|var|function|return|typeof|await)\b|=>|\)\s*\{|;\s*\}/.test(t)) continue;
          /* 行号按原始 sm[0] 折算：lit.index 是抹除后文本里的下标，好在抹除只把字符换成空格、
             不增删换行，偏移一致。+1 折成 1-based（scriptStart 是 `<script>` 行的 0-based 下标）。 */
          emit(t, scriptStart + sm[0].slice(0, lit.index).split('\n').length);
        }
      }
    }
  }
  /* R6：同文件内同一句（≥10 字、含中文）出现 ≥2 次 → 复读嫌疑，取第二次出现处报一条 */
  for (const [rel, m] of perFile) {
    for (const [text, lines] of m) {
      if (lines.length < 2 || text.length < 10) continue;
      findings.push({ file: rel, line: lines[1], rule: 'R6', why: `同文件重复 ${lines.length} 次（行 ${lines.join(' / ')}）`, text: text.slice(0, 120) });
    }
  }
  return findings;
}

const argv = process.argv.slice(2);
const only = argv.includes('--rule') ? argv[argv.indexOf('--rule') + 1] : null;
let findings = scan();
if (only) findings = findings.filter((f) => f.rule === only.toUpperCase());

const byRule = {};
const byFile = {};
for (const f of findings) {
  byRule[f.rule] = (byRule[f.rule] || 0) + 1;
  byFile[f.file] = byFile[f.file] || {};
  byFile[f.file][f.rule] = (byFile[f.file][f.rule] || 0) + 1;
}

if (argv.includes('--update')) {
  fs.writeFileSync(BASELINE, JSON.stringify({ generatedAt: new Date().toISOString(), rules: byRule, files: byFile }, null, 2) + '\n');
  console.log(`已写入基线 ${path.relative(process.cwd(), BASELINE)}`);
  console.log(`规则计数：${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join('  ')}  （合计 ${findings.length}）`);
  process.exit(0);
}

if (argv.includes('--list')) {
  for (const f of findings) console.log(`${f.file}:${f.line}\t[${f.rule}] ${f.why}\n    ${f.text}`);
  console.log(`\n合计 ${findings.length}：${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  process.exit(0);
}

if (!fs.existsSync(BASELINE)) {
  console.error('缺少基线文件，先跑 node scripts/check-ui-copy.mjs --update');
  process.exit(1);
}
const base = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
const added = [];
for (const f of findings) {
  const cap = base.files?.[f.file]?.[f.rule] || 0;
  const now = byFile[f.file][f.rule];
  if (now > cap) {
    const already = added.filter((a) => a.file === f.file && a.rule === f.rule).length;
    if (already < now - cap) added.push(f);
  }
}
if (added.length) {
  console.error(`✖ UI 文案新增反模式 ${added.length} 处（基线：${Object.entries(base.rules).map(([k, v]) => `${k}=${v}`).join(' ')}）\n`);
  for (const f of added) console.error(`  ${f.file}:${f.line}  [${f.rule}] ${f.why}\n    ${f.text}`);
  console.error('\n按 doc/local/copy-audit-2026-10-14/REPORT.md §6 的三种改法处理：删 / 变控件 / 收 tooltip。');
  process.exit(1);
}
const improved = [];
for (const [file, rules] of Object.entries(base.files || {})) {
  for (const [rule, cap] of Object.entries(rules)) {
    const now = byFile[file]?.[rule] || 0;
    if (now < cap) improved.push(`${file} [${rule}] ${cap}→${now}`);
  }
}
console.log(`✓ 无新增。当前计数：${Object.entries(byRule).map(([k, v]) => `${k}=${v}`).join('  ')}（合计 ${findings.length}）`);
if (improved.length) console.log(`  已改善 ${improved.length} 处（可用 --update 下调基线）：\n    ` + improved.slice(0, 20).join('\n    '));
