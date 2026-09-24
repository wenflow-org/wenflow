/**
 * 联网采集回填（活的 path 批次 B）：把后台采集完成的资料 pack 回填到
 * 刚生成的路径 template 里（原位替换 pending 占位）。
 *
 * 为什么在 service 层：回填要直查/直写 learning_paths，coordinator 保持无 DB 直连边界。
 *
 * 协议：占位 pack 的 notes 带 `__async_collect__:<归一标题>` marker；
 * 回填时等活跃 generation run 清空（生成链路会整体覆写 template，不能抢写），
 * 再扫时间窗内带 marker 的路径做 read-merge-write。幂等：替换后 marker 消失。
 * 重启丢任务=可接受（fail-open，下次生成经库优先命中，资料不丢）。
 */
import { prisma } from '../../config/database';
import { logger } from '../../utils/logger';
import type { MaterialPackResult } from '../../skills/material-collector/types';
import { normalizeTitleForMatch } from './material-web-ingest.service';

/** 等活跃 run 清空的轮询：5s × 最多 10 分钟。 */
const RUN_POLL_MS = 5_000;
const MAX_RUN_WAIT_MS = 10 * 60_000;
/** 回填扫描的路径时间窗（创建后 15 分钟内有效；过窗路径下次生成走库优先）。 */
const PATH_WINDOW_MS = 15 * 60_000;

/** 从占位 notes 里提取 marker（归一标题），非占位返回 null。 */
export function extractAsyncCollectMarker(notes: unknown): string | null {
  if (!Array.isArray(notes)) return null;
  for (const note of notes) {
    if (typeof note === 'string' && note.startsWith(`${ASYNC_COLLECT_MARKER_PREFIX}:`)) {
      return note.slice(ASYNC_COLLECT_MARKER_PREFIX.length + 1);
    }
  }
  return null;
}

const ASYNC_COLLECT_MARKER_PREFIX = '__async_collect__';

/**
 * 等活跃 generation run 进入终态，然后把 userId 名下（时间窗内、template 带 marker 的）
 * 路径里与 readyPacks 标题匹配的 pending 占位原位替换为真实 pack。
 *
 * 注意等待条件是「run 终态」而非「指针为 null」：成功完成后 activeGenerationRunId
 * 保留最后 run 引用不被清空（run-lifecycle 只在失败/回滚时动它）。
 */
export async function patchPathsWithAsyncMaterials(
  userId: string,
  readyPacks: MaterialPackResult[]
): Promise<number> {
  const since = new Date(Date.now() - PATH_WINDOW_MS);
  const candidates = await prisma.learning_paths.findMany({
    where: { userId, updatedAt: { gte: since }, aiPromptTemplate: { contains: ASYNC_COLLECT_MARKER_PREFIX } },
    select: { id: true, aiPromptTemplate: true, activeGenerationRunId: true },
  });
  if (candidates.length === 0) return 0;

  // 等各路径的活跃 run 进入终态（queued/processing = 生成链路仍可能整体覆写 template，不抢写）
  const pendingRunIds = Array.from(
    new Set(candidates.map((candidate) => candidate.activeGenerationRunId).filter((id): id is string => !!id))
  );
  for (let waited = 0; waited < MAX_RUN_WAIT_MS && pendingRunIds.length > 0; waited += RUN_POLL_MS) {
    const runs = await prisma.path_generation_runs.findMany({
      where: { id: { in: pendingRunIds } },
      select: { id: true, status: true },
    });
    const stillActive = runs
      .filter((run) => run.status === 'queued' || run.status === 'processing')
      .map((run) => run.id);
    if (stillActive.length === 0) break;
    pendingRunIds.splice(0, pendingRunIds.length, ...stillActive);
    await new Promise((resolve) => setTimeout(resolve, RUN_POLL_MS));
  }

  let patched = 0;
  for (const candidate of candidates) {
    try {
      const template = JSON.parse(candidate.aiPromptTemplate || '{}');
      const materials = template?.normalizedInput?.normalizedInput?.resources?.materials;
      if (!Array.isArray(materials)) continue;
      let changed = false;
      for (let index = 0; index < materials.length; index += 1) {
        const item = materials[index];
        const needTitle = extractAsyncCollectMarker(item?.notes);
        if (!needTitle) continue;
        const match = readyPacks.find(
          (pack) => pack.pack && normalizeTitleForMatch(String(pack.pack.title)) === needTitle
        );
        if (match) {
          materials[index] = match;
          changed = true;
        }
      }
      if (changed) {
        await prisma.learning_paths.update({
          where: { id: candidate.id },
          data: { aiPromptTemplate: JSON.stringify(template) },
        });
        patched += 1;
        logger.info('[material-async-collect] 后台联网资料已回填路径', { pathId: candidate.id, userId });
      }
    } catch (error) {
      logger.warn('[material-async-collect] 回填失败（fail-open）', {
        pathId: candidate.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return patched;
}
