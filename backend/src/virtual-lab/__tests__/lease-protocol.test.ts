/**
 * 租约协议单源化单测（#106 第一批）。
 * 锁住：值与现状等价（TTL 10min / 续租 2min / 退避 25-50-100ms）、DB_BUSY 判定口径、
 * 以及黑盒 runner 不再复制一份常量（改一处漏一处的根因）。
 */
import { readFileSync } from 'fs';
import {
  FINALIZATION_LEASE_MS,
  FINALIZATION_LEASE_RENEW_MS,
  LEASE_RETRY_DELAYS_MS,
  PATH_GENERATION_LEASE_MS as PATH_GENERATION_LEASE_MS_AUTHORITY,
  TEACHING_OPERATION_LEASE_MS,
  TEACHING_OPERATION_RENEW_MS,
  VIRTUAL_SESSION_LEASE_RENEW_MS,
  VIRTUAL_SESSION_LEASE_TTL_MS,
  isLeaseDatabaseBusyError,
  isPrismaErrorCode,
} from '../lease-protocol';
import { PATH_GENERATION_LEASE_MS as PATH_GENERATION_LEASE_MS_SOURCE } from '../../services/learning/path-generation-status';

describe('lease-protocol 常量', () => {
  it('TTL/续租/退避保持现状（行为等价改动，不改协议语义）', () => {
    expect(VIRTUAL_SESSION_LEASE_TTL_MS).toBe(10 * 60 * 1000);
    expect(VIRTUAL_SESSION_LEASE_RENEW_MS).toBe(2 * 60 * 1000);
    expect(LEASE_RETRY_DELAYS_MS).toEqual([25, 50, 100]);
    expect(VIRTUAL_SESSION_LEASE_RENEW_MS * 5).toBe(VIRTUAL_SESSION_LEASE_TTL_MS);
  });
});

describe('isLeaseDatabaseBusyError', () => {
  it('Prisma P1008 / SQLITE_BUSY / 锁表与超时文案判为 DB 忙', () => {
    expect(isLeaseDatabaseBusyError({ code: 'P1008' })).toBe(true);
    expect(isLeaseDatabaseBusyError({ code: 'SQLITE_BUSY' })).toBe(true);
    expect(isLeaseDatabaseBusyError(new Error('database is locked'))).toBe(true);
    expect(isLeaseDatabaseBusyError(new Error('SQLite database table is locked'))).toBe(true);
    expect(isLeaseDatabaseBusyError(new Error('operation timed out'))).toBe(true);
  });

  it('业务错误/空值不误判为 DB 忙', () => {
    expect(isLeaseDatabaseBusyError(new Error('TEACHING_SESSION_STALE'))).toBe(false);
    expect(isLeaseDatabaseBusyError({ code: 'P2002' })).toBe(false);
    expect(isLeaseDatabaseBusyError(null)).toBe(false);
    expect(isLeaseDatabaseBusyError(undefined)).toBe(false);
  });

  it('isPrismaErrorCode 仅按 code 精确匹配', () => {
    expect(isPrismaErrorCode({ code: 'P2002' }, 'P2002')).toBe(true);
    expect(isPrismaErrorCode({ code: 'P2002' }, 'P1008')).toBe(false);
    expect(isPrismaErrorCode(null, 'P2002')).toBe(false);
  });
});

describe('#106 单源化守卫（源码）', () => {
  const blackbox = readFileSync('src/virtual-lab/blackbox-runner.ts', 'utf8');
  const constants = readFileSync('src/coordinators/simulation.constants.ts', 'utf8');

  it('黑盒 runner 不再复制租约常量与 DB_BUSY 判定', () => {
    expect(blackbox).not.toContain('const COMMAND_LEASE_MS = 10 * 60 * 1000');
    expect(blackbox).not.toContain('const LEASE_RETRY_DELAYS_MS = [25, 50, 100]');
    expect(blackbox).not.toContain('function isLeaseDatabaseBusyError');
    expect(blackbox).toContain('COMMAND_LEASE_MS = VIRTUAL_SESSION_LEASE_TTL_MS');
    expect(blackbox).toContain("from './lease-protocol'");
  });

  it('assisted 常量改为 re-export（不再写字面量）', () => {
    expect(constants).not.toContain('ASSISTED_SESSION_LEASE_MS = 10 * 60 * 1000');
    expect(constants).toContain('VIRTUAL_SESSION_LEASE_TTL_MS as ASSISTED_SESSION_LEASE_MS');
  });
});

/**
 * #106 第二批：路径生成 run(5min)/教学操作(2min+续租30s)/finalization(3min+续租45s)
 * 三套 TTL 收进 lease-protocol，原模块只转出。行为等价（值不变），守卫防「又抄一份」。
 */
describe('#106② 三套租约 TTL 单源化', () => {
  const pathStatus = readFileSync('src/services/learning/path-generation-status.ts', 'utf8');
  const teachingRepo = readFileSync('src/services/ai-teaching/TeachingSessionRepository.ts', 'utf8');
  const runLifecycle = readFileSync('src/services/learning/generation/run-lifecycle.ts', 'utf8');

  it('TTL 值与收拢前逐一等价', () => {
    expect(PATH_GENERATION_LEASE_MS_AUTHORITY).toBe(5 * 60 * 1000);
    expect(TEACHING_OPERATION_LEASE_MS).toBe(2 * 60 * 1000);
    expect(TEACHING_OPERATION_RENEW_MS).toBe(30 * 1000);
    expect(FINALIZATION_LEASE_MS).toBe(3 * 60 * 1000);
    expect(FINALIZATION_LEASE_RENEW_MS).toBe(45 * 1000);
  });

  it('path-generation-status 由 lease-protocol 转出，且运行时值一致', () => {
    expect(pathStatus).toContain("from '../../virtual-lab/lease-protocol'");
    expect(pathStatus).not.toMatch(/PATH_GENERATION_LEASE_MS\s*=\s*[\d_]/);
    expect(PATH_GENERATION_LEASE_MS_SOURCE).toBe(PATH_GENERATION_LEASE_MS_AUTHORITY);
  });

  it('TeachingSessionRepository 不再定义教学操作/finalization TTL 字面量', () => {
    expect(teachingRepo).toContain("from '../../virtual-lab/lease-protocol'");
    expect(teachingRepo).not.toMatch(
      /(TEACHING_OPERATION_LEASE_MS|TEACHING_OPERATION_RENEW_MS|FINALIZATION_LEASE_MS|FINALIZATION_LEASE_RENEW_MS)\s*=\s*[\d_]/
    );
  });

  it('run-lifecycle 心跳只消费协议常量（TTL/3），不再自带 TTL', () => {
    expect(runLifecycle).toContain('PATH_GENERATION_LEASE_MS / 3');
    expect(runLifecycle).not.toMatch(/LEASE_MS\s*=\s*[\d_]/);
  });
});
