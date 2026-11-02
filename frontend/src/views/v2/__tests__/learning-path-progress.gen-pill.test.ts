/**
 * 目标页 gen-pill 的「status → 文案」映射（走查 2026-11-02 P22 三缺陷）。
 *
 * 病根：确认后约 1.5s 会话就 isCompleted（任务受理），但阶段/课时生成还在后端跑约 7 分钟。
 * 目标页此前只看会话 phase——pill 提前跳平静终态「路径已创建」、刷新即消失、完成弹层
 * 永远说「还在生成中」。修法：与 /learning-paths 同源，轮询 generation-status，
 * 文案映射收在 learningPathProgress 的纯函数里，本文件锁定：
 *  - 生成中 → run「正在生成路径 · {真实阶段}」（阶段计数口径同列表页 phaseTextOf）；
 *  - 完成 → done「路径已创建 · 生成完成」；
 *  - 失败/stale → fail「生成失败」；
 *  - 状态接口尚未应答 → run 过渡「路径已创建 · 生成中」，**不得**给平静终态（P22 红线）。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genPillCopy, genStageLabel, isGenerationSettled } from '../learningPathProgress';

const goalSource = readFileSync(resolve(__dirname, '../V2GoalConversation.vue'), 'utf8');

describe('genPillCopy：generation-status → pill 文案', () => {
  it('状态未应答（短暂窗口）→ 进行态过渡，不给平静终态', () => {
    expect(genPillCopy(null)).toEqual({ tone: 'run', text: '路径已创建 · 生成中' });
    expect(genPillCopy(undefined)).toEqual({ tone: 'run', text: '路径已创建 · 生成中' });
  });

  it('生成中 → 「正在生成路径 · {真实阶段}」', () => {
    expect(genPillCopy({ phase: 'core', status: 'processing', completedStages: 0, totalStages: 4 }))
      .toEqual({ tone: 'run', text: '正在生成路径 · 规划阶段与课时' });
    expect(genPillCopy({ phase: 'stage_design', status: 'processing', completedStages: 1, totalStages: 4 }))
      .toEqual({ tone: 'run', text: '正在生成路径 · 课程准备中（1/4）' });
    expect(genPillCopy({ phase: 'stage_design', status: 'processing', completedStages: 4, totalStages: 4 }))
      .toEqual({ tone: 'run', text: '正在生成路径 · 课时正在写入' });
  });

  it('完成 → done 终态（点击去路径详情）', () => {
    expect(genPillCopy({ phase: 'ready', status: 'ready' }))
      .toEqual({ tone: 'done', text: '路径已创建 · 生成完成' });
  });

  it('失败 / stale → fail「生成失败」', () => {
    expect(genPillCopy({ phase: 'core', status: 'failed' })).toEqual({ tone: 'fail', text: '生成失败' });
    expect(genPillCopy({ phase: 'stage_design', status: 'stale' })).toEqual({ tone: 'fail', text: '生成失败' });
  });

  it('阶段计数夹紧：脏数据 done>total 不产「7/4」，缺计数不产空括号', () => {
    expect(genStageLabel({ phase: 'stage_design', completedStages: 7, totalStages: 4 })).toBe('课时正在写入');
    expect(genStageLabel({ phase: 'stage_design', completedStages: 0, totalStages: 0 })).toBe('课程准备中');
  });

  it('终态判据与列表页同口径：phase=ready 或 failed/stale', () => {
    expect(isGenerationSettled({ phase: 'ready', status: 'ready' })).toBe(true);
    expect(isGenerationSettled({ phase: 'core', status: 'failed' })).toBe(true);
    expect(isGenerationSettled({ phase: 'stage_design', status: 'stale' })).toBe(true);
    expect(isGenerationSettled({ phase: 'core', status: 'processing' })).toBe(false);
    expect(isGenerationSettled(null)).toBe(false);
  });
});

describe('目标页接线（防回退）', () => {
  it('pill 跟真实状态：拿到 pathId 后轮询 generation-status（P22 缺陷1）', () => {
    expect(goalSource).toContain('learningAPI.getPathGenerationStatus(track.pathId)');
    expect(goalSource).toContain('trackPathGeneration');
    // 映射必须走纯函数，不得在组件里散写第二份
    expect(goalSource).toContain('genPillCopy(genTrack.value.lc)');
  });

  it('生成未确认完成前不给平静终态：旧的「路径已创建」平静档不得复活', () => {
    const pillBlock = goalSource.slice(goalSource.indexOf('const genPill = computed'), goalSource.indexOf('function onGenPillClick'));
    expect(pillBlock, 'genPill 必须消费 genPillCopy 的映射').toContain('genPillCopy');
    expect(pillBlock, '平静终态「路径已创建」（不带生成结果）不得直接写回').not.toContain("text: '路径已创建'");
  });

  it('跨刷新常驻：pathId 持久化 + 挂载恢复轮询（P22 缺陷2）', () => {
    expect(goalSource).toContain('setGoalGenTracking(recentGoalsUserId.value, pathId)');
    expect(goalSource).toContain('void restoreGenTracking()');
    expect(goalSource).toContain('gen-pill--entry');
  });

  it('完成弹层注跟随真实状态，不再恒为「还在生成中」（P22 缺陷3）', () => {
    expect(goalSource).toContain('{{ doneGenNote }}');
    expect(goalSource, '静态旧句不得直接写回模板').not.toContain('>阶段与任务还在生成中。<');
  });

  it('离页停轮询：onBeforeUnmount 清理（P22 缺陷4）', () => {
    const unmountBlock = goalSource.slice(goalSource.indexOf('onBeforeUnmount(() => {'), goalSource.indexOf('/** 清回初始态'));
    expect(unmountBlock).toContain('stopGenPolling()');
  });
});
