/**
 * 从 0 新建 Skill 的 CLI 入口（2026-09 拍板：scaffold 迁出管理台，管理台只做轻运营调整）
 *
 * 为什么不在管理台：scaffold 只生成骨架片段（core.yaml + skills.yaml 条目 + 编排契约 +
 * handler 占位），真正可运行还差三处代码级接线（manifest 登记 / skills/index.ts 注册 /
 * coordinator steps 挂接）——必须在仓库里由开发者完成，UI 给「新建」按钮是假门。
 * 本脚本与 POST /api/admin/skills/scaffold 调用同一服务层（scaffoldSkill），幂等：
 * 条目齐备 → already-exists；条目在但缺生成物 → 补齐缺失。
 * 审计口径：CLI 不写 node_config_changes（那是 admin 路由的 DB 配置审计），
 * 生成物均为 git 跟踪文件，以 git 提交为记录。
 *
 * 用法（backend/ 下）：
 *   npx ts-node --transpile-only scripts/scaffold-skill.ts \
 *     --skill-id=my-new-skill --kind=mainline --stage=goal --parent-agent=goal-agent \
 *     [--display-name=中文名] [--description=一句话职责]
 *   kind ∈ mainline | aux | handler-only（mainline 必填 --stage 与 --parent-agent）
 *
 * 生成后（doc/SKILL_DEVELOPMENT_GUIDE.md §4）：
 *   1. 按输出的「注册片段」完成三处接线
 *   2. npm run prompts:compile-all && npm run prompts:sync
 *   3. 提交 git
 */
import dotenv from 'dotenv';
import {
  scaffoldSkill,
  ScaffoldInputError,
  ScaffoldConflictError,
} from '../src/services/skill-registry/skill-scaffold.service';

dotenv.config();

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : undefined;
}

async function main() {
  const skillId = arg('skill-id');
  const kind = arg('kind') as 'mainline' | 'aux' | 'handler-only' | undefined;
  if (!skillId || !kind) {
    console.error(
      '用法：npx ts-node --transpile-only scripts/scaffold-skill.ts ' +
        '--skill-id=<kebab-case> --kind=mainline|aux|handler-only ' +
        '[--stage=goal|path|teaching|profile|simulation] [--parent-agent=<agentId>] ' +
        '[--display-name=中文名] [--description=一句话职责]',
    );
    process.exit(1);
  }

  const outcome = await scaffoldSkill({
    skillId,
    kind,
    stage: arg('stage'),
    parentAgent: arg('parent-agent'),
    displayName: arg('display-name'),
    description: arg('description'),
  });

  if (outcome.status === 'already-exists') {
    console.log(`[跳过] skillId "${outcome.skillId}" 已存在（skills.yaml 有条目且生成物齐备）；若有生成物缺失，重放本命令会自动补齐。`);
    return;
  }

  console.log(`[完成] Skill 骨架已${outcome.status === 'created' ? '生成' : '补齐'}：${outcome.skillId}（${outcome.kind}）`);
  console.log(`\n生成文件（${outcome.generated.length}）：`);
  for (const f of outcome.generated) console.log(`  - ${f}`);
  if (outcome.snippets.length) {
    console.log('\n注册片段（复制后手工粘贴，scaffold 不自动改写 TS）：');
    for (const s of outcome.snippets) {
      console.log(`\n  【${s.title}】`);
      console.log(s.content.split('\n').map((l) => `  ${l}`).join('\n'));
    }
  }
  console.log('\n接下来（doc/SKILL_DEVELOPMENT_GUIDE.md §4）：');
  console.log('  1. 完成上方注册片段的三处接线（manifest / skills/index.ts / coordinator steps）');
  console.log('  2. cd backend && npm run prompts:compile-all && npm run prompts:sync');
  console.log('  3. 提交 git（生成物均为 git 跟踪文件，git 提交即审计记录）');
}

main().catch((e) => {
  if (e instanceof ScaffoldInputError) console.error(`输入非法：${e.message}`);
  else if (e instanceof ScaffoldConflictError) console.error(`冲突：${e.message}`);
  else console.error(e?.message || e);
  process.exit(1);
});
