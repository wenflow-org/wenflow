/**
 * 模拟时钟接线审计（源码级回归守卫）
 *
 * 目的：日期模拟依赖"写入点使用 simulatedNowOr()"这一约定。约定是**白名单**式的——
 * 有人新增写入点或用回裸 `new Date()` 时，模拟日数据会静默落到真实日期。此测试把该约定
 * 固化成可回归断言，防止退化（不追求全仓无 `new Date()`，只钉住已接线的关键路径）。
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const SRC = resolve(__dirname, '../../..'); // backend/src
const read = (rel: string) => readFileSync(resolve(SRC, rel), 'utf8');

/** 必须在写入点接入模拟时钟的模块 */
const WIRED_MODULES = [
  'services/memory/memory-trace.service.ts',
  'services/metrics/LearningMetricService.ts',
  'virtual-lab/learner-memory.ts',
  'services/ai-teaching/TeachingSessionRepository.ts',
  'services/ai-teaching/AITeachingCoordinator.ts',
  'coordinators/simulation.coordinator.ts',
];

describe('模拟时钟接线审计（防退化）', () => {
  it.each(WIRED_MODULES)('%s 已接入 simulation-clock-context', (rel) => {
    const text = read(rel);
    expect(text).toMatch(/from '[^']*virtual-lab\/simulation-clock-context'/);
    expect(text).toMatch(/simulatedNowOr\(/);
  });

  it('任务结算（task-completion.service）：台账/streak 接受 asOf（模拟日）', () => {
    const text = read('services/learning/tasks/task-completion.service.ts');
    expect(text).toMatch(/data\.asOf \?\? new Date\(\)/); // 台账与 streak 的基准时间
  });

  it('自动推进调度独立成文件，且在会话租约内推进（P0）', () => {
    const rel = 'services/virtual-lab/simulated-day-scheduler.ts';
    expect(existsSync(resolve(SRC, rel))).toBe(true);
    const text = read(rel);
    expect(text).toMatch(/resolveSimulationClock/);
    expect(text).toMatch(/planClockAdvance/);
    expect(text).toMatch(/runLeasedExclusive/); // 关键：不裸写 stageResults
  });

  it('simulated-day.service 不再承载调度（已迁出，避免循环依赖）', () => {
    const text = read('services/virtual-lab/simulated-day.service.ts');
    expect(text).not.toMatch(/startSimulatedDayScheduler/);
  });

  it('启动装配从 scheduler 模块注册自动推进（index.ts → bootstrap/schedulers.ts）', () => {
    // index.ts 拆分后调度启动收敛到 bootstrap/schedulers.ts，入口经 startMaintenanceSchedulers 传递注册
    const entry = read('index.ts');
    expect(entry).toMatch(/startMaintenanceSchedulers/);

    const schedulers = read('bootstrap/schedulers.ts');
    expect(schedulers).toMatch(/startSimulatedDayScheduler/);
    expect(schedulers).toMatch(/simulated-day-scheduler/);
  });

  it('评审为独立旁路：评审失败按 accept 处理，不阻断 Learn', () => {
    const text = read('coordinators/simulation.path-phase.ts');
    expect(text).toMatch(/review-failed-non-blocking/);
  });

  it('任务结算的业务时间戳走模拟时钟（不再落真墙钟）', () => {
    // learning.service：任务完成时间戳——驱动 subtasks.completedAt / 完成类 evidence /
    // 里程碑状态 / task:completed 事件（→ 学习指标 recordedAt/calculatedAt）
    expect(read('services/learning/tasks/task-completion.service.ts'))
      .toMatch(/const completedAt = data\.asOf \?\? new Date\(\)/);

    // 课堂结束时间：不得再出现真墙钟 endTime（含 finalize / timeout / fail / discard）
    for (const rel of [
      'services/ai-teaching/TeachingSessionRepository.ts',
      'services/ai-teaching/AITeachingCoordinator.ts',
    ]) {
      expect(read(rel)).not.toMatch(/endTime: new Date\(\)/);
    }

    // 课堂内事件时间线（classroomEventHistory）走模拟时钟
    expect(read('services/ai-teaching/teaching-classroom-flow.ts'))
      .toMatch(/occurredAt: simulatedNowOr\(\)\.toISOString\(\)/);
  });
});
