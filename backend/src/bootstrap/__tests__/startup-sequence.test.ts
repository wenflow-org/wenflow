/**
 * 启动序列编排单测（#143）：端口绑定必须先于一切写库副作用；
 * 绑定失败时零初始化调用；初始化失败时抛给调用方关服退出。
 */
import { runStartupSequence, type StartupHandles, type StartupSequenceDeps } from '../startup-sequence';

function makeHandles(): StartupHandles {
  return { instanceLock: null, httpServer: null, gateway: null, outboxWorker: null, stopEnrichmentRetry: null };
}

function makeDeps(order: string[], overrides: Partial<StartupSequenceDeps> = {}): StartupSequenceDeps {
  const record = (name: string) => () => { order.push(name); };
  const asyncRecord = (name: string) => async () => { order.push(name); };
  return {
    assertStartupActive: record('assertStartupActive'),
    acquireLock: () => {
      order.push('acquireLock');
      return { release: record('releaseLock') };
    },
    connectDatabases: asyncRecord('connectDatabases'),
    bindHttpServer: async () => {
      order.push('bindHttpServer');
      return { } as never;
    },
    startMaintenanceSchedulers: record('startMaintenanceSchedulers'),
    runVirtualLabStartupRecovery: asyncRecord('runVirtualLabStartupRecovery'),
    refreshAppTimeZone: async () => { order.push('refreshAppTimeZone'); return 'Asia/Shanghai'; },
    auditSensitiveStoragePermissions: asyncRecord('auditSensitiveStoragePermissions'),
    refreshNetworkPolicyBootstrap: asyncRecord('refreshNetworkPolicyBootstrap'),
    runPromptFileSeed: asyncRecord('runPromptFileSeed'),
    runFieldRoutingSeed: asyncRecord('runFieldRoutingSeed'),
    runAdminSeed: asyncRecord('runAdminSeed'),
    runLearnerCardsSeed: asyncRecord('runLearnerCardsSeed'),
    purgeRetiredSkills: asyncRecord('purgeRetiredSkills'),
    runSkillModelConfigSeed: asyncRecord('runSkillModelConfigSeed'),
    initializeGateway: (async () => {
      order.push('initializeGateway');
      return { close: async () => undefined } as never;
    }),
    startOutboxWorker: (() => {
      order.push('startOutboxWorker');
      return { stop: async () => undefined } as never;
    }),
    runLearningStartupRecovery: asyncRecord('runLearningStartupRecovery'),
    startEnrichmentRetryLoop: (() => {
      order.push('startEnrichmentRetryLoop');
      return () => undefined;
    }),
    runDashboardGuidanceBackfill: record('runDashboardGuidanceBackfill'),
    runTokenCostCacheWarmup: record('runTokenCostCacheWarmup'),
    runOverviewStatsCacheWarmup: record('runOverviewStatsCacheWarmup'),
    runAdminPageColdWarmup: record('runAdminPageColdWarmup'),
    markReady: record('markReady'),
    ...overrides,
  };
}

/** #143 的核心断言口径：绑定端口之后才允许出现任何初始化/写副作用步骤。 */
const INIT_STEPS = [
  'startMaintenanceSchedulers',
  'runVirtualLabStartupRecovery',
  'refreshAppTimeZone',
  'auditSensitiveStoragePermissions',
  'refreshNetworkPolicyBootstrap',
  'runPromptFileSeed',
  'runFieldRoutingSeed',
  'runAdminSeed',
  'runLearnerCardsSeed',
  'purgeRetiredSkills',
  'runSkillModelConfigSeed',
  'initializeGateway',
  'startOutboxWorker',
  'runLearningStartupRecovery',
  'startEnrichmentRetryLoop',
  'runDashboardGuidanceBackfill',
  'runTokenCostCacheWarmup',
  'runOverviewStatsCacheWarmup',
  'runAdminPageColdWarmup',
];

describe('startup-sequence（#143 端口先绑定，零写库副作用失败）', () => {
  it('正常路径：先锁→连库→绑定端口，之后才执行初始化；markReady 最后；句柄全部写入', async () => {
    const order: string[] = [];
    const handles = makeHandles();
    await runStartupSequence(makeDeps(order), handles);

    expect(order.indexOf('bindHttpServer'))
      .toBeGreaterThan(order.indexOf('connectDatabases'));
    for (const step of INIT_STEPS) {
      expect(order.indexOf(step)).toBeGreaterThan(order.indexOf('bindHttpServer'));
    }
    // 连接双库不产生数据写入，但锁必须在连接前持有
    expect(order.indexOf('acquireLock')).toBeLessThan(order.indexOf('connectDatabases'));
    expect(order[order.length - 1]).toBe('markReady');

    expect(handles.instanceLock).not.toBeNull();
    expect(handles.httpServer).not.toBeNull();
    expect(handles.gateway).not.toBeNull();
    expect(handles.outboxWorker).not.toBeNull();
    expect(typeof handles.stopEnrichmentRetry).toBe('function');
  });

  it('端口不可用（EADDRINUSE）：绑定点失败 → 任何 seed/调度/outbox 都不执行（零写库副作用）', async () => {
    const order: string[] = [];
    const handles = makeHandles();
    const eaddrinuse = Object.assign(new Error('listen EADDRINUSE: address already in use :::3001'), { code: 'EADDRINUSE' });

    await expect(runStartupSequence(makeDeps(order, {
      bindHttpServer: async () => { order.push('bindHttpServer'); throw eaddrinuse; },
    }), handles)).rejects.toBe(eaddrinuse);

    expect(order).toEqual([
      'assertStartupActive', 'acquireLock', 'connectDatabases', 'assertStartupActive', 'bindHttpServer'
    ]);
    expect(order).not.toContain('runPromptFileSeed');
    expect(order).not.toContain('runAdminSeed');
    expect(order).not.toContain('runLearnerCardsSeed');
    expect(order).not.toContain('startOutboxWorker');
    expect(order).not.toContain('startMaintenanceSchedulers');
    expect(order).not.toContain('markReady');
    // 锁已持有没有释放——句柄留给调用方 shutdown 兜底释放
    expect(handles.instanceLock).not.toBeNull();
    expect(handles.httpServer).toBeNull();
  });

  it('绑定成功后初始化失败（runAdminSeed 抛错）：错误上抛、后续步骤不再执行，已建句柄保留给 shutdown 清理', async () => {
    const order: string[] = [];
    const handles = makeHandles();
    const seedFailure = new Error('admin seed failed');

    await expect(runStartupSequence(makeDeps(order, {
      runAdminSeed: async () => { order.push('runAdminSeed'); throw seedFailure; },
    }), handles)).rejects.toBe(seedFailure);

    expect(order.indexOf('runAdminSeed')).toBeGreaterThan(order.indexOf('bindHttpServer'));
    expect(order).not.toContain('purgeRetiredSkills');
    expect(order).not.toContain('startOutboxWorker');
    expect(order).not.toContain('markReady');
    expect(handles.httpServer).not.toBeNull();
    expect(handles.gateway).toBeNull();
  });

  it('进入关闭流程（draining）后第一步即终止：不持锁、不连库、不绑端口', async () => {
    const order: string[] = [];
    const handles = makeHandles();

    await expect(runStartupSequence(makeDeps(order, {
      assertStartupActive: () => { order.push('assertStartupActive'); throw new Error('服务已进入关闭流程，终止后续启动'); },
    }), handles)).rejects.toThrow('服务已进入关闭流程');

    expect(order).toEqual(['assertStartupActive']);
    expect(handles.instanceLock).toBeNull();
  });
});
