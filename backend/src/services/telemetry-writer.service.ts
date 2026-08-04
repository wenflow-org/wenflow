import prisma from '../config/database';
import { logger } from '../utils/logger';

type TelemetryDelegate = {
  create(args: { data: any }): Promise<any>;
};

class TelemetryWriter {
  async createAgentCall(data: any): Promise<boolean> {
    return this.safeCreate('agent_call_logs', (prisma as any).agent_call_logs, data);
  }

  async createPromptCall(data: any): Promise<boolean> {
    return this.safeCreate('prompt_call_logs', (prisma as any).prompt_call_logs, data);
  }

  async createLlmAttempt(data: any): Promise<boolean> {
    return this.safeCreate('llm_execution_attempts', (prisma as any).llm_execution_attempts, data);
  }

  private async safeCreate(name: string, delegate: TelemetryDelegate | undefined, data: any): Promise<boolean> {
    try {
      if (!delegate?.create) return false;
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
  }
}

export const telemetryWriter = new TelemetryWriter();
