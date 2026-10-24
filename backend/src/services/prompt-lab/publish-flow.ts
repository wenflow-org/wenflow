/**
 * Prompt Lab 发布流助手（2026-10-24 架构优化批 1：routes/prompt-lab.ts 拆分迁出）。
 *
 * 发布/变体/回滚共用的：发布互斥串行化、coreVersion/version 号段、核心文件原文读取、
 * 含义冻结守门入口与备份目录。纯业务助手，不感知 HTTP。
 */
import fs from 'fs/promises';
import path from 'path';
import { PROMPTS_DIR } from '../../composers/prompt-files/loader';
import { CORE_FILES_DIR } from './core-file-loader';
import {
  judgeSemanticFreeze,
  type SemanticFreezeJudgement,
} from './semantic-freeze-judge';
import {
  findLatestCoreVersionRow,
  listActivePromptRows,
  findPromptRowById,
} from './prompt-lab-versions.repo';
import { withSystemTransaction } from '../../utils/with-transaction';

// 发布备份与 prompts 同级存放（prompts/backups/<skillId>/），不再跨目录到 prompt-lab
export const BACKUPS_DIR = path.join(PROMPTS_DIR, 'backups');

export const VARIANT_KEY_RE = /^[A-Za-z0-9_-]{1,8}$/;

/** v4：查询某 agentId 的下一个 coreVersion（无历史则从 1 起） */
export async function nextCoreVersion(agentId: string): Promise<number> {
  const latest = await findLatestCoreVersionRow(agentId);
  return (latest?.coreVersion ?? 0) + 1;
}

/**
 * H2：按 agentId 串行化同 skill 的发布（进程内互斥）。
 * 并发 publish-core 会算出相同的 coreVersion/version，撞 @@unique([agentId, version]) 返回 500；
 * 串行后后发请求能看到前一发布写入的 ACTIVE 版本，再算出递增的版本号。
 * 发布失败（reject）同样释放锁，不会死锁后续发布。
 */
const publishLocks = new Map<string, Promise<unknown>>();

export function serializePublish<T>(agentId: string, task: () => Promise<T>): Promise<T> {
  const prev = publishLocks.get(agentId) ?? Promise.resolve();
  const run = prev.catch(() => undefined).then(task);
  publishLocks.set(agentId, run);
  run.then(
    () => {
      if (publishLocks.get(agentId) === run) publishLocks.delete(agentId);
    },
    () => {
      if (publishLocks.get(agentId) === run) publishLocks.delete(agentId);
    }
  );
  return run;
}

/** v4：读取核心文件原文（judge 对账用 SSOT 文本） */
export async function readCoreText(skillId: string): Promise<string> {
  return fs.readFile(path.join(CORE_FILES_DIR, `${skillId}.yaml`), 'utf-8');
}

/** v4：守门第三查（含义冻结）。skip 时返回 null；判定失败按 uncertain 处理 */
export async function runSemanticGate(
  skillId: string,
  candidateText: string,
  skip: boolean
): Promise<SemanticFreezeJudgement | null> {
  if (skip) return null;
  const coreText = await readCoreText(skillId);
  return judgeSemanticFreeze({ skillId, coreText, candidateText });
}

/** 当前基线的完整行（变体克隆源默认值） */
export async function findActivePromptBriefFull(agentId: string) {
  const rows = await listActivePromptRows(agentId);
  const baselineBrief = rows.filter((r) => !r.variant).sort((a, b) => b.version - a.version)[0];
  if (!baselineBrief) return null;
  return findPromptRowById(baselineBrief.id);
}

/** 下一个可用 version 号（全量行 max+1，变体与基线共用号池） */
export async function nextPromptVersionNumber(agentId: string): Promise<number> {
  return withSystemTransaction(async (tx) => {
    const latest = await tx.agent_prompts.findFirst({
      where: { agentId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    return (latest?.version ?? 0) + 1;
  });
}
