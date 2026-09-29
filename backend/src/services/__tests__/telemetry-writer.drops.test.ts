// telemetry-writer 丢弃计数：缺行可证伪（区分「调用没发生」与「INSERT 被吞」）
jest.mock('../../config/database', () => ({
  __esModule: true,
  default: {
    agent_call_logs: { create: jest.fn() },
    prompt_call_logs: { create: jest.fn() },
    llm_execution_attempts: { create: jest.fn() }
  }
}));

jest.mock('../../utils/logger', () => ({
  logger: { warn: jest.fn(), error: jest.fn(), info: jest.fn(), debug: jest.fn() }
}));

import prisma from '../../config/database';
import { telemetryWriter } from '../telemetry-writer.service';

type MockedDelegate = { create: jest.Mock };
const db = prisma as unknown as Record<string, MockedDelegate | undefined>;
const agentCreate = db.agent_call_logs!.create;
const promptCreate = db.prompt_call_logs!.create;
const attemptCreate = db.llm_execution_attempts!.create;

describe('telemetry-writer 丢弃计数', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    telemetryWriter.resetDropStats();
    agentCreate.mockResolvedValue({});
    promptCreate.mockResolvedValue({});
    attemptCreate.mockResolvedValue({});
  });

  it('全部写入成功时计数为零', async () => {
    await telemetryWriter.createPromptCall({ traceId: 't1' });
    await telemetryWriter.createAgentCall({ traceId: 't2' });
    await telemetryWriter.flush();
    const stats = telemetryWriter.getDropStats();
    expect(stats.total).toBe(0);
    expect(stats.byTable).toEqual({});
    expect(stats.pending).toBe(0);
  });

  it('后台写失败：仍返回已受理，但 flush 后计数 +1（此前只有一行 warn，不可数）', async () => {
    promptCreate.mockRejectedValue(new Error('SQLITE_BUSY'));
    const accepted = await telemetryWriter.createPromptCall({ traceId: 't3' });
    // 后台语义：调用方拿到「已受理」，不因写入失败而失败
    expect(accepted).toBe(true);
    await telemetryWriter.flush();
    const stats = telemetryWriter.getDropStats();
    expect(stats.total).toBe(1);
    expect(stats.byTable).toEqual({ prompt_call_logs: 1 });
  });

  it('llm_execution_attempts 保持 await 语义：失败直接返回 false 并计数', async () => {
    attemptCreate.mockRejectedValue(new Error('disk I/O error'));
    const ok = await telemetryWriter.createLlmAttempt({ traceId: 't4' });
    expect(ok).toBe(false);
    expect(telemetryWriter.getDropStats().byTable).toEqual({ llm_execution_attempts: 1 });
  });

  it('按表累计且互不串台', async () => {
    promptCreate.mockRejectedValue(new Error('x'));
    agentCreate.mockRejectedValue(new Error('y'));
    await telemetryWriter.createPromptCall({});
    await telemetryWriter.createPromptCall({});
    await telemetryWriter.createAgentCall({});
    await telemetryWriter.flush();
    const stats = telemetryWriter.getDropStats();
    expect(stats.total).toBe(3);
    expect(stats.byTable).toEqual({ prompt_call_logs: 2, agent_call_logs: 1 });
  });

  it('delegate 缺失（适配器未提供）返回 false 且不计入丢弃——那是能力缺失，不是写失败', async () => {
    const saved = db.prompt_call_logs;
    db.prompt_call_logs = undefined;
    try {
      const ok = await telemetryWriter.createPromptCall({ traceId: 't5' });
      expect(ok).toBe(false);
      expect(telemetryWriter.getDropStats().total).toBe(0);
    } finally {
      db.prompt_call_logs = saved;
    }
  });
});
