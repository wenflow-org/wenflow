import prisma from '../config/database';
import { logger } from '../utils/logger';

type TelemetryDelegate = {
  create(args: { data: any }): Promise<any>;
};

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

  async createAgentCall(data: any): Promise<boolean> {
    return this.safeCreate('agent_call_logs', (prisma as any).agent_call_logs, data, { background: true });
  }

  async createPromptCall(data: any): Promise<boolean> {
    return this.safeCreate('prompt_call_logs', (prisma as any).prompt_call_logs, data, { background: true });
  }

  async createLlmAttempt(data: any): Promise<boolean> {
    return this.safeCreate('llm_execution_attempts', (prisma as any).llm_execution_attempts, data);
  }

  /** 等待全部在途后台写完成（优雅关闭 / 测试） */
  async flush(): Promise<void> {
    if (this.pending.size === 0) return;
    await Promise.allSettled([...this.pending]);
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
        logger.warn('[telemetry] 日志写入失败', {
          table: name,
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
