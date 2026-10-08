import prisma from '../config/database';
import { createHash } from 'crypto';
import { logger } from '../utils/logger';

type TelemetryDelegate = {
  create(args: { data: any }): Promise<any>;
};

/** 成功行大文本的瘦身阈值与 head 截断（字符） */
const PROMPT_CALL_SLIM_THRESHOLD_CHARS = 4096;
const PROMPT_CALL_SLIM_HEAD_CHARS = 400;

/**
 * 成功行写前瘦身：userPayload/rawModelOutput/extractedJson 超 4K 即替换为
 * `{__slim,bytes,sha256,head}` 标记（normalizedOutput 保留但上限 256K 防离群）。
 * 失败行原样保留。纯函数，便于单测。
 */
export function slimPromptCallRow(data: any): any {
  if (!data || data.success !== true) return data;
  const slim = (value: unknown): unknown => {
    if (typeof value !== 'string' || value.length <= PROMPT_CALL_SLIM_THRESHOLD_CHARS) return value;
    return JSON.stringify({
      __slim: true,
      bytes: Buffer.byteLength(value),
      sha256: createHash('sha256').update(value).digest('hex').slice(0, 16),
      head: value.slice(0, PROMPT_CALL_SLIM_HEAD_CHARS)
    });
  };
  const next: any = { ...data };
  next.userPayload = slim(data.userPayload);
  next.rawModelOutput = slim(data.rawModelOutput) ?? null;
  next.extractedJson = slim(data.extractedJson) ?? null;
  const normalized = data.normalizedOutput;
  if (typeof normalized === 'string' && normalized.length > 262144) {
    next.normalizedOutput = normalized.slice(0, 262144);
  }
  return next;
}

/**
 * 遥测写入器。
 *
 * 写入耗时分类（2026-09 性能整改）：
 * - createAgentCall / createPromptCall → **后台写**：调用时同步发起底层 INSERT
 *   （mock 断言与写入顺序语义不变），但调用方不等待完成。这两类行携带全量
 *   userPayload / rawModelOutput 大文本，await 内联在 LLM 响应关键路径上；
 *   SQLite 单写者竞争时（虚拟学习者并发、长会话）会直接放大 SSE 完成延迟。
 *   返回值仅表示「已受理」，失败语义不变（仅 warn，不影响业务结果）。
 * - createLlmAttempt → 保持 await 语义：其成败经 attemptTelemetryComplete 汇总
 *   写入 agent_call_logs.metadata，管理端执行日志据此标注 dataCompleteness，
 *   不能乐观化。
 *
 * flush() 供优雅关闭 / 测试等待在途后台写落盘。
 */
class TelemetryWriter {
  private pending = new Set<Promise<unknown>>();
  /**
   * 丢弃计数（按表）。缺行的遥测此前只留一行 logger.warn——审计侧无法区分
   * 「这次调用没发生」与「INSERT 失败被吞」。计数让前者可证伪，并由管理端读走。
   */
  private drops = new Map<string, number>();

  async createAgentCall(data: any): Promise<boolean> {
    return this.safeCreate('agent_call_logs', (prisma as any).agent_call_logs, data, { background: true });
  }

  async createPromptCall(data: any): Promise<boolean> {
    // 写前瘦身（2026-10-08 数据还债 B2）：成功行不再存全文——userPayload 2.65GB +
    // raw/extracted 双冗余 0.57GB，90 天稳态预期 25GB+（12GB 主库的下一波翻倍主犯）。
    // 失败行保留全量（排障价值高、占比低）；成功行留 normalizedOutput + 瘦身标记
    // （bytes/sha256/head 仍可对账前缀稳定性），raw 全文走 llm_execution_attempts 侧证。
    return this.safeCreate('prompt_call_logs', (prisma as any).prompt_call_logs, slimPromptCallRow(data), { background: true });
  }

  async createLlmAttempt(data: any): Promise<boolean> {
    return this.safeCreate('llm_execution_attempts', (prisma as any).llm_execution_attempts, data);
  }

  /** 等待全部在途后台写完成（优雅关闭 / 测试） */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled([...this.pending]);
  }

  /** 丢弃计数快照（管理端 / 审计用；进程内累计，重启归零） */
  getDropStats(): { total: number; byTable: Record<string, number>; pending: number } {
    const byTable = Object.fromEntries(this.drops);
    return {
      total: [...this.drops.values()].reduce((sum, n) => sum + n, 0),
      byTable,
      pending: this.pending.size
    };
  }

  /** 清空丢弃计数（测试用） */
  resetDropStats(): void {
    this.drops.clear();
  }

  private async safeCreate(
    name: string,
    delegate: TelemetryDelegate | undefined,
    data: any,
    options: { background?: boolean } = {}
  ): Promise<boolean> {
    if (!delegate?.create) return false;
    // async IIFE 同步执行到首个 await：底层 create 在调用现场即发起
    const write = (async () => {
      try {
        await delegate.create({ data });
        return true;
      } catch (error) {
        this.drops.set(name, (this.drops.get(name) || 0) + 1);
        logger.warn('[telemetry] 日志写入失败', {
          table: name,
          droppedTotal: this.drops.get(name),
          traceId: data?.traceId || null,
          error: error instanceof Error ? error.message : String(error)
        });
        return false;
      }
    })();
    if (!options.background) return write;
    this.pending.add(write);
    void write.finally(() => {
      this.pending.delete(write);
    });
    return true;
  }
}

export const telemetryWriter = new TelemetryWriter();
