/**
 * probe:teaching-semantic —— 直接调**生产函数** `resolveActiveTaskMaterialExcerpts`，
 * 验证「语义层有没有真的进课堂」，用真实账号的真实资料取证（不经 HTTP、不等跑批）。
 *
 * 两个分支各跑一遍：
 *   A. 任务**没有**任何资料引用 → 跨资料语义兜底（rerank）挑原文窗口；
 *   B. 任务有引用但标题/引文都命中不了 → 单资料语义兜底替换"全文开头"窗口。
 * 对照：同一输入在 `MATERIAL_SEMANTIC_DISABLED=1` 下的行为（应退回 anchor=none / 返回 null）。
 *
 * 用法：npm --prefix backend run probe:teaching-semantic
 *      npm --prefix backend run probe:teaching-semantic -- --user=<userId> --query="..."
 * 退出码：恒 0（这是取证探针，不是门禁）。
 */

import 'dotenv/config';
import { resolveActiveTaskMaterialExcerpts } from '../services/ai-teaching/TeachingContextBuilder';
import { listMaterials } from '../services/materials/material-store';

function argOf(name: string, fallback: string): string {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(hit.indexOf('=') + 1) : fallback;
}

/** ml-own-02（工作流建的「抱单位培训教材自学考证的车间安全员」）——有真实材料。 */
const DEFAULT_USER = 'a6cae859-f7c4-4f40-a54b-d3ba8d9e97d5';
const TASK_ID = 'probe-task-semantic';

function templateWithRef(materialId: string): string {
  // 标题/引文都故意写成资料里不存在的串 → 结构化取回必然退化到 anchor='none'
  return JSON.stringify({
    sceneFraming: { normalizedInput: { version: '1.0', resources: {} } },
    materialRefs: { byTask: { [TASK_ID]: [{ materialId, sectionTitle: '不存在的章节标题', quote: '不存在的逐字引文' }] } },
  });
}

function templateWithoutRef(): string {
  return JSON.stringify({
    sceneFraming: { normalizedInput: { version: '1.0', resources: {} } },
    materialRefs: { byTask: {} },
  });
}

async function main(): Promise<void> {
  const userId = argOf('user', DEFAULT_USER);
  const query = argOf('query', '动火作业分级与安全管理要求');

  const materials = listMaterials(userId);
  console.log(`[probe] user=${userId}｜该账号资料 ${materials.length} 份`);
  for (const m of materials.slice(0, 6)) {
    console.log(`  - ${m.id.slice(0, 8)} | ${String(m.name).slice(0, 40)} | ${m.origin || 'upload'} | ${m.charCount} 字 | brief=${m.brief ? '有' : '无'}`);
  }
  if (materials.length === 0) {
    console.log('[probe] 该账号没有资料 → 语义兜底无从召回（这本身就是 fail-open 的正确行为）');
  }

  // A. 无引用 → 跨资料语义兜底
  console.log('\n=== A｜任务无任何资料引用（应走跨资料语义兜底）===');
  const a = await resolveActiveTaskMaterialExcerpts({
    aiPromptTemplate: templateWithoutRef(),
    taskId: TASK_ID,
    userId,
    query,
  });
  if (!a) {
    console.log('  返回 null（无语料可兜底 / 语义层关停）');
  } else {
    for (const e of a) {
      console.log(`  anchor=${e.anchor}｜${String(e.materialName).slice(0, 30)}｜${String(e.sectionTitle).slice(0, 24)}`);
      console.log(`    摘录前 80 字：${String(e.excerpt).slice(0, 80).replace(/\s+/g, ' ')}`);
    }
  }

  // B. 有引用但命中不了 → 单资料语义兜底
  console.log('\n=== B｜引用存在但标题/引文都命中不了（应从"全文开头"换成语义选块）===');
  const target = materials[0];
  if (target) {
    const b = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: templateWithRef(target.id),
      taskId: TASK_ID,
      userId,
      query,
    });
    if (!b) {
      console.log('  返回 null');
    } else {
      for (const e of b) {
        console.log(`  anchor=${e.anchor}（semantic=语义兜底命中，none=退回头部窗口）｜${String(e.materialName).slice(0, 30)}`);
        console.log(`    摘录前 80 字：${String(e.excerpt).slice(0, 80).replace(/\s+/g, ' ')}`);
      }
    }
  } else {
    console.log('  （无资料，跳过）');
  }

  // C. 关停对照
  console.log('\n=== C｜对照：MATERIAL_SEMANTIC_DISABLED=1 ===');
  process.env.MATERIAL_SEMANTIC_DISABLED = '1';
  try {
    const c1 = await resolveActiveTaskMaterialExcerpts({
      aiPromptTemplate: templateWithoutRef(), taskId: TASK_ID, userId, query,
    });
    const c2 = target
      ? await resolveActiveTaskMaterialExcerpts({
          aiPromptTemplate: templateWithRef(target.id), taskId: TASK_ID, userId, query,
        })
      : null;
    console.log(`  无引用分支 → ${c1 === null ? 'null' : `${c1.length} 条`}（关停后应 null）`);
    console.log(`  有引用分支 → anchor=${c2?.[0]?.anchor ?? 'null'}（关停后应 none=退回头部窗口）`);
  } finally {
    delete process.env.MATERIAL_SEMANTIC_DISABLED;
  }
}

main().catch((error: unknown) => {
  console.error('[probe:teaching-semantic] 运行失败:', error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
