/**
 * 静态守护（174-3）：注释用「文件 + 行号」指向别处的实现，行号会随目标文件每次编辑漂移。
 *
 * 实例：伴学历史的三处注释都写死指向 teaching-session-ops 的同一段行号，而该文件几经搬迁后
 * 那段早就是别的内容（peer 历史在 processPeerMessage 的 peerHistory，标记消息写在
 * appendPeerMessages 那段）。读注释的人被引到错误代码上，而且没有任何检查会报错。
 *
 * 口径：注释应写**符号名**（processPeerMessage / peerHistory / collectPeerHistory），不写行号。
 * 扫描范围刻意收窄到 `teaching-session-ops` 这一个模块——它是伴学/会话主路径里被引用最多、
 * 也最容易因拆分而漂移的目标；仓库里其他「模块:行号」指针（多用于一次性审计留痕）不在本检查范围。
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const TARGET_MODULE = 'teaching-session-ops';
// 由片段拼出，避免本文件自己命中规则
const LINE_POINTER = new RegExp(`${TARGET_MODULE}\\.ts:\\d`);

function listTsFiles(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      listTsFiles(full, out);
      continue;
    }
    if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

describe('注释不写死行号（174-3）', () => {
  it('全仓没有指向 teaching-session-ops 的行号指针（应改用符号名）', () => {
    const srcRoot = join(__dirname, '..', '..', '..');
    const offenders = listTsFiles(srcRoot)
      .filter((file) => LINE_POINTER.test(readFileSync(file, 'utf8')))
      .map((file) => relative(srcRoot, file).replace(/\\/g, '/'));

    expect(offenders).toEqual([]);
  });
});
