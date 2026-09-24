/**
 * material-brief 惰性编排（Document Summary Index 摘要节点的确定性编排层）。
 *
 * 设计：brief 是「附加知识堆」的一次性结构化理解——**首次被消费时生成一次**，
 * 持久化到资料记录（MaterialRecord.brief），此后 goal/path 零成本复用。
 *
 * 关键行为：
 * - 惰性 + 在途去重：同资料的并发请求共享同一次生成；超时/失败不落盘（下次可重试）。
 * - 截断采样：输入正文上限 BRIEF_INPUT_CHARS，超长附截断标记（Prompt 侧声明只就所给部分理解）。
 * - fail-open：任何异常返回 null，调用方降级为元信息清单，绝不阻塞 goal 对话 / path 生成。
 * - deadline 语义：collectWithDeadline 让调用方限定等待预算；到点未完成的生成**继续在后台跑**，
 *   落盘后由下一次消费自然拾取（不会白烧 LLM）。
 */
import { logger } from '../../utils/logger';
import { generateMaterialBriefDraft } from '../../skills/material-brief';
import type { MaterialBrief } from '../../skills/material-brief/types';
import { readMaterial, updateRecord, type MaterialRecord } from './material-store';

/** brief 生成的输入正文上限（超出采样并附截断标记）。 */
const BRIEF_INPUT_CHARS = 24_000;
/** 单份 brief 生成的超时硬上限。 */
const BRIEF_TIMEOUT_MS = 45_000;

const inflight = new Map<string, Promise<MaterialBrief | null>>();

function inflightKey(userId: string, id: string): string {
  return `${userId}::${id}`;
}

function sleep(ms: number): Promise<null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), ms);
    // deadline 定时器不阻止进程退出（到点前进程要退就退，race 对端自然兜底）
    if (typeof timer.unref === 'function') timer.unref();
  });
}

/** 记录上已持久化的 brief（无则 null）。 */
export function readBriefFromRecord(record: MaterialRecord): MaterialBrief | null {
  return record.brief ?? null;
}

/**
 * 取资料的 brief：已持久化直接返回；否则生成一次并落盘。
 * 失败/超时返回 null（fail-open），调用方降级为元信息清单。
 */
export async function getOrGenerateMaterialBrief(record: MaterialRecord): Promise<MaterialBrief | null> {
  if (record.brief) return record.brief;
  const key = inflightKey(record.userId, record.id);
  const existing = inflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<MaterialBrief | null> => {
    try {
      const { markdown } = readMaterial(record.userId, record.id) ?? { markdown: '' };
      if (!markdown.trim()) return null;
      const truncated = markdown.length > BRIEF_INPUT_CHARS;
      const inputText = truncated
        ? `${markdown.slice(0, BRIEF_INPUT_CHARS)}\n\n（已截断：仅提供前 ${BRIEF_INPUT_CHARS} 字）`
        : markdown;
      const result = await Promise.race([
        generateMaterialBriefDraft({ name: record.name, markdown: inputText }),
        sleep(BRIEF_TIMEOUT_MS),
      ]);
      if (!result) {
        logger.warn('[material-brief] brief 生成超时（fail-open；在途任务继续，落盘后下次拾取）', {
          userId: record.userId,
          materialId: record.id,
        });
        return null;
      }
      if (result.status !== 'ok' || !result.brief) {
        logger.info('[material-brief] not_found，不生成 brief', {
          userId: record.userId,
          materialId: record.id,
          notes: result.notes,
        });
        return null;
      }
      updateRecordQuietly(record, result.brief);
      return result.brief;
    } catch (error) {
      logger.warn('[material-brief] brief 生成失败（fail-open，下次消费重试）', {
        userId: record.userId,
        materialId: record.id,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, task);
  return task;
}

function updateRecordQuietly(record: MaterialRecord, brief: MaterialBrief): void {
  try {
    updateRecord(record.userId, record.id, { brief, briefGeneratedAt: new Date().toISOString() });
  } catch (error) {
    logger.warn('[material-brief] brief 落盘失败（不影响本次消费）', {
      userId: record.userId,
      materialId: record.id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

/**
 * 为一组资料确保 brief，受总等待预算约束：
 * 所有缺失的 brief **同时开始生成**，调用方最多等 deadlineMs；
 * 到点未完成的返回 null（生成仍在后台继续并落盘，下次消费拾取）。
 */
export async function collectBriefsWithDeadline(
  records: MaterialRecord[],
  deadlineMs: number
): Promise<Array<MaterialBrief | null>> {
  if (!records.length) return [];
  const tasks = records.map((record) => getOrGenerateMaterialBrief(record));
  const deadline = sleep(deadlineMs);
  return Promise.all(tasks.map((task) => Promise.race([task, deadline])));
}
