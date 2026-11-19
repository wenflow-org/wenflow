/**
 * 课堂契约卡（2026-11-19 课堂全面改造）：
 * ① 开课/恢复响应带 lessonContract，契约卡展示核心 KC 与独立证据门槛；
 * ② 支线状态（active/remaining/parkingLot）随每回合响应更新；
 * ③ 结课浮层展示契约达成与停车区，不把契约外探索判成失败。
 *
 * 模板入口字段由后端 engine/startSession 注入；这里锁字段名与渲染入口，改名不锁会静默退化。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const here = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(resolve(here, '../V2LearningPage.vue'), 'utf8');

describe('V2LearningPage 课堂契约卡与自由支线', () => {
  it('契约卡渲染核心 KC、独立证据门槛与覆盖度', () => {
    expect(source).toContain('class="contract"');
    expect(source).toContain('本节契约');
    expect(source).toContain('contractCoreKcs');
    expect(source).toContain('lessonContract?.minIndependentEvidence');
    expect(source).toContain('contractCoveredCount');
  });

  it('支线标签显示当前分支与剩余轮次', () => {
    expect(source).toContain('自由支线');
    expect(source).toContain('branchLabel');
    expect(source).toContain('branchRemaining');
    expect(source).toContain('branchActive');
  });

  it('停车区可见，且不会渲染成主线失败', () => {
    expect(source).toContain('contractParkingLot');
    expect(source).toContain('停车区');
    expect(source).not.toContain('停车区（未完成）');
  });

  it('开课/恢复/回合响应都把契约与报告写入本地状态', () => {
    expect(source).toContain('lessonContract.value = s.lessonContract');
    expect(source).toContain('lessonReport.value = s.lessonReport');
    expect(source).toContain('lessonContract.value = r.lessonContract');
    expect(source).toContain('lessonReport.value = r.lessonReport');
    expect(source).toContain('branchInfo.value = r.branch');
  });

  it('结课浮层展示契约达成与停车区', () => {
    expect(source).toContain('class="finish__contract"');
    expect(source).toContain('个核心 KC 有证据');
    expect(source).toContain('待课后处理');
  });
});
