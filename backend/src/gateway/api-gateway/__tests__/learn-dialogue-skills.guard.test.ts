/**
 * LEARN_DIALOGUE_SKILLS 白名单守卫（2026-10-22 机械过滤审计 B 类）。
 *
 * 事故背景（router.ts 注释记载）：session-wrapup 曾不在集合内 → 用户绑定链上技能行
 * ds 落到无 ds 通道分组，「No available channel」8/8 全灭、整晚课总结全退 fallback。
 * 白名单漏配/条目失效都是静默的——这里做两向机械对账：
 *   ① 关键成员钉扎：学习对话链的承重技能必须在集合里（防误删/改名后漏补）；
 *   ② 条目活性：集合里每个 id 都必须能解析到一个真实存在的 skill 定义（独立目录或
 *      聚合实现里的 id 字符串）——改名/下线后留下的死条目即时可见。
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { LEARN_DIALOGUE_SKILLS } from '../router';

// ts-jest CJS 编译产物里 __dirname 可用（仓库其他 backend 测试同款）
declare const __dirname: string;
const here = __dirname;
const SKILLS_DIR = join(here, '..', '..', '..', 'skills');

/** 白名单承重成员：学习对话链主链（漏任何一条即复现 wrapup 8/8 全灭级事故） */
const CRITICAL_MEMBERS = [
  'teaching-turn',
  'session-wrapup',
  'goal-conversation',
  'teaching-opening-generator',
  'virtual-learner-learn-turn-simulator',
  'virtual-learner-goal-dialogue-simulator',
];

describe('LEARN_DIALOGUE_SKILLS 白名单守卫', () => {
  it('承重成员必须在集合里（session-wrapup 漏配曾致整晚总结全灭）', () => {
    const missing = CRITICAL_MEMBERS.filter(id => !LEARN_DIALOGUE_SKILLS.has(id));
    if (missing.length > 0) {
      throw new Error(`学习对话链技能不在 LEARN_DIALOGUE_SKILLS 白名单里：${missing.join(', ')}`);
    }
    expect(missing).toEqual([]);
  });

  it('集合里每个 id 都能解析到真实 skill 定义（无死条目）', () => {
    const dead: string[] = [];
    for (const id of LEARN_DIALOGUE_SKILLS) {
      const hasOwnDir = existsSync(join(SKILLS_DIR, id, 'index.ts'));
      // 聚合实现（如 v4-aux-skills）没有独立目录：在 skills 源码树里找 id 字符串兜底
      const referencedSomewhere = hasOwnDir || skillsSourceTree().includes(`'${id}'`);
      if (!referencedSomewhere) dead.push(id);
    }
    if (dead.length > 0) {
      throw new Error(`白名单存在解析不到 skill 定义的死条目：${dead.join(', ')}`);
    }
    expect(dead).toEqual([]);
  });
});

/** 读 skills 源码树（少量文件，缓存一次性拼接）用于聚合实现的 id 兜底查找。 */
let cachedTree: string | null = null;
function skillsSourceTree(): string {
  if (cachedTree !== null) return cachedTree;
  const files = [
    join(SKILLS_DIR, 'v4-aux-skills', 'index.ts'),
    join(SKILLS_DIR, 'index.ts'),
    join(SKILLS_DIR, 'executor.ts'),
  ];
  cachedTree = files
    .filter(f => existsSync(f))
    .map(f => readFileSync(f, 'utf8'))
    .join('\n');
  return cachedTree;
}
