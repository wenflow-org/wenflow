/* 从 git diff 中筛选 hunk：只保留正文命中 keep 正则的 hunk，其余丢弃（用于并行会话同文件的切分提交） */
const { execSync } = require('child_process');
const fs = require('fs');

const [file, keepPattern, dropPattern] = process.argv.slice(2);
if (!file || !keepPattern) {
  console.error('用法: node stage-hunks.cjs <file> <keepRegex> [dropRegex]');
  process.exit(1);
}
const keep = new RegExp(keepPattern);
const drop = dropPattern ? new RegExp(dropPattern) : null;

const diff = execSync(`git diff -- "${file}"`, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
const lines = diff.split('\n');

const header = [];
const hunks = [];
let current = null;
for (const line of lines) {
  if (line.startsWith('@@')) {
    if (current) hunks.push(current);
    current = { headerLine: line, body: [] };
  } else if (current) {
    current.body.push(line);
  } else {
    header.push(line);
  }
}
if (current) hunks.push(current);

const kept = hunks.filter((h) => {
  const text = h.body.join('\n');
  if (drop && drop.test(text)) return false;
  return keep.test(text);
});

if (kept.length === 0) {
  console.error(`[stage-hunks] 没有命中任何 hunk：${file}`);
  process.exit(2);
}

/**
 * 丢掉了中间的 hunk → 后续 hunk 的**新侧起始行号**要重算。
 * 旧侧起始行号不变（打的还是同一份 pre-image），新侧 = 旧侧 + 前面保留 hunk 的累计净增。
 * 不重算的话 git apply 会报 "corrupt patch"（新侧行号与内容对不上）。
 */
let delta = 0;
const rebased = kept.map((h) => {
  const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(.*)$/.exec(h.headerLine);
  if (!m) {
    console.error(`[stage-hunks] 无法解析 hunk 头：${h.headerLine}`);
    process.exit(3);
  }
  const [, oldStart, oldCount, , newCount, tail] = m;
  const rebasedHeader = `@@ -${oldStart}${oldCount ? `,${oldCount}` : ''} +${Number(oldStart) + delta}${newCount ? `,${newCount}` : ''} @@${tail}`;
  delta += Number(newCount || 1) - Number(oldCount || 1);
  return [rebasedHeader, ...h.body];
});

const out = `${[...header, ...rebased.flat()].join('\n')}\n`;
fs.writeFileSync('C:/tmp/stage-hunks.patch', out);
console.log(`[stage-hunks] ${file}: 保留 ${kept.length}/${hunks.length} 个 hunk（已重算新侧行号）→ C:/tmp/stage-hunks.patch`);
