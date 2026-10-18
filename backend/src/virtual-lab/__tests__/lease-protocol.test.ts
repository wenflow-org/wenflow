/**
 * 租约协议单源化单测（#106 第一批）。
 * 锁住：值与现状等价（TTL 10min / 续租 2min / 退避 25-50-100ms）、DB_BUSY 判定口径、
 * 以及黑盒 runner 不再复制一份常量（改一处漏一处的根因）。
 */
import { readFileSync } from 'fs';
import {
  LEASE_RETRY_DELAYS_MS,
  VIRTUAL_SESSION_LEASE_RENEW_MS,
  VIRTUAL_SESSION_LEASE_TTL_MS,
  isLeaseDatabaseBusyError,
  isPrismaErrorCode,
} from '../lease-protocol';

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
