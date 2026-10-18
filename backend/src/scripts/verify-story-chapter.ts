/* eslint-disable @typescript-eslint/no-explicit-any -- 真机验证脚本：storyPool 条目由模型产出，形状动态（对齐 verify-*.ts 先例） */
/**
 * 多故事续章真机验证（2026-10-11）：直接调 story-chapter.service.growStoryChapter，
 * 用真实 scenario-designer 生成一条承接学习成果的下一章，验证写入与生命周期字段。
 * 用法：npx ts-node src/scripts/verify-story-chapter.ts <presetKey> [predecessorStoryId]
 */
import { prisma } from '../config/database';
import { growStoryChapter } from '../services/virtual-lab/story-chapter.service';

async function main() {
  const presetKey = process.argv[2] || 'nurse-career-transition';
  const explicitStoryId = process.argv[3] || null;

  const profile = await prisma.virtual_learner_profiles.findFirst({ where: { presetKey } });
  if (!profile) throw new Error(`no profile for presetKey=${presetKey}`);
  const data = JSON.parse(profile.profile || '{}');
  const pool = Array.isArray(data.storyPool) ? data.storyPool : [];
  console.log(`[verify] profile=${profile.id} stories=${pool.length}`);
  for (const s of pool) console.log(`  - ${s.id} | ${s.title} | status=${s.status || 'legacy'} | progressesFrom=${s.progressesFrom || '-'}`);

  const predecessor = explicitStoryId
    ? pool.find((s: any) => s.id === explicitStoryId)
    : pool[0];
  if (!predecessor) throw new Error('predecessor not found');
  console.log(`[verify] growing successor for: ${predecessor.id} (${predecessor.title})`);
  console.log(`[verify] predecessor outline: ${String(predecessor.storyOutline || '').slice(0, 120)}`);

  const t0 = Date.now();
  const res = await growStoryChapter({
    profileId: profile.id,
    predecessorStoryId: predecessor.id,
    predecessorTitle: predecessor.title,
    predecessorOutline: predecessor.storyOutline,
    reason: 'manual-verify',
  });
  console.log(`[verify] result (${((Date.now() - t0) / 1000).toFixed(1)}s):`, JSON.stringify(res));

  const after = await prisma.virtual_learner_profiles.findUnique({ where: { id: profile.id } });
  const afterData = JSON.parse(after!.profile || '{}');
  const succ = (afterData.storyPool || []).find((s: any) => s.id === res.storyId);
  if (succ) {
    console.log('\n===== 续章全文 =====');
    console.log(JSON.stringify(succ, null, 2).slice(0, 2200));
  }
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exit(1); });
