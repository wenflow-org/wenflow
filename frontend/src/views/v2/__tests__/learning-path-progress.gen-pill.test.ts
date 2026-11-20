/**
 * 目标页的路径生成跟踪与完成弹层（走查 2026-11-02 P22 三缺陷；2026-11-20 生成 pill 退役）。
 *
 * 病根：确认后约 1.5s 会话就 isCompleted（任务受理），但阶段/课时生成还在后端跑约 7 分钟。
 * 目标页此前只看会话 phase——进度条提前跳平静终态「路径已创建」、刷新即消失、完成弹层
 * 永远说「还在生成中」。修法：与 /learning-paths 同源，轮询 generation-status。
 *
 * 2026-11-20：对话底坞里的生成 pill 全部移除，路径创建/生成进度统一收进右上角通知中心
 * （AI 任务 tab 的 running 行 + 调用日志 feed）。本文件只锁定：
 *  - 阶段短语 / 终态判据与列表页同口径；
 *  - 目标页仍按真实 generation-status 跟踪（跨刷新恢复）；
 *  - 完成弹层副文跟随真实状态；
 *  - 对话页不再渲染任何 gen-pill。
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { genStageLabel, isGenerationSettled } from '../learningPathProgress';

const goalSource = readFileSync(resolve(__dirname, '../V2GoalConversation.vue'), 'utf8');

describe('生成阶段短语与终态判据', () => {
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
  it('路径生成跟踪跟真实状态：拿到 pathId 后轮询 generation-status（P22 缺陷1）', () => {
    expect(goalSource).toContain('learningAPI.getPathGenerationStatus(track.pathId)');
    expect(goalSource).toContain('trackPathGeneration');
  });

  it('路径创建进度 UI 不留在对话底坞，统一走右上角通知中心', () => {
    expect(goalSource).not.toContain('gen-pill');
    expect(goalSource).not.toContain('genPill');
    expect(goalSource).not.toContain('路径已创建 · 生成完成');
  });

  it('跨刷新常驻：pathId 持久化 + 挂载恢复轮询（P22 缺陷2）', () => {
    /* 2026-11-06 走查 图4：跟踪写入时一并记下会话 id——入口页要把状态挂回「最近会话」那一行。
       2026-11-20：对话底坞的 pill 已全部退役，跨刷新常驻能力不变。 */
    expect(goalSource).toContain('setGoalGenTracking(recentGoalsUserId.value, pathId, cid)');
    expect(goalSource).toContain('void restoreGenTracking()');
    expect(goalSource).toContain('isGeneratingRecent');
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
