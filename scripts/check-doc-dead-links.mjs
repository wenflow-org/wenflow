// 死链扫描（进 CI）：扫描 doc/ 下全部 tracked md 的仓库内相对链接，目标不存在 → 非零退出
// 只校验 [text](相对路径.md) 形态；http(s) 与纯锚点 # 跳过
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const files = execSync('git ls-files doc', { encoding: 'utf8' })
  .split('\n')
  .filter((f) => f.endsWith('.md'));

const broken = [];
let checked = 0;
for (const file of files) {
  const src = fs.readFileSync(file, 'utf8');
  const re = /\[[^\]]*\]\(([^)\s]+)\)/g;
  let m;
  while ((m = re.exec(src))) {
    const target = m[1];
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (!clean.endsWith('.md') && !clean.endsWith('.yaml') && !clean.endsWith('.json')) continue;
    checked += 1;
    const resolved = path.resolve(path.dirname(file), clean);
    if (!fs.existsSync(resolved)) {
      broken.push({ file, link: target });
    }
  }
}
console.log(`[check-doc-dead-links] 扫描 ${files.length} 篇 / 校验仓库内链接 ${checked} 条`);
if (broken.length) {
  console.error(`[check-doc-dead-links] 死链 ${broken.length} 条：`);
  for (const b of broken) console.error(`  ${b.file} → ${b.link}`);
  process.exit(1);
}
console.log('[check-doc-dead-links] 全部有效');
