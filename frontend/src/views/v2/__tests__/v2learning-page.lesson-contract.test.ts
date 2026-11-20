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

  it('结算被契约缺口拒绝时走页内门禁并展示逐条原因，不落「稍后重试」故障弹窗', () => {
    expect(source).toContain("LESSON_CONTRACT_NOT_MET");
    expect(source).toContain('还差几步才能完成本节课');
    expect(source).toMatch(/LESSON_CONTRACT_NOT_MET[\s\S]{0,4000}showSettleGate/);
  });

  it('结束学习（不计入完成）的浮层不冒充「本节完成」', () => {
    expect(source).toContain("finishAction.value === 'end_only'");
    expect(source).toContain('本次学习已结束');
    expect(source).toContain('本次不计入完成，任务进度与里程碑保持不变');
  });

  it('完成入口不提前摆出：知识点未全掌握且契约未达标时不显示', () => {
    expect(source).toContain('const canCompleteLesson = computed');
    expect(source).toContain('v-if="canCompleteLesson"');
    expect(source).toMatch(/allKpMastered[\s\S]{0,800}canCompleteLesson/);
    // 提前离开只走 ⋯ 菜单的「结束学习（不计入完成）」
    expect(source).toContain('结束学习（不计入完成）');
  });

  it('完课条件满足后在输入区上方给出结束提示，而不是只藏一颗页头按钮', () => {
    expect(source).toContain('const lessonReadyToFinish = computed');
    expect(source).toContain('class="ready"');
    expect(source).toContain('本节知识点已全部掌握');
    expect(source).toContain('可以完成本节，系统会生成本次学习总结。');
    expect(source).toContain('class="btn-primary ready__go"');
    // 结束提示条占住输入区上方，伴学球必须抬上去，不能压住「完成本节」
    expect(source).toContain("'peerfab--ready': lessonReadyToFinish");
    expect(source).toContain('.peerfab--ready { bottom:');
  });

  it('契约报告存在时以 met 为准：课末终检未过不提前摆完成，改提示去作答', () => {
    expect(source).toContain('if (lessonReport.value) return lessonReport.value.met === true');
    expect(source).toContain('const showFinishBlocked = computed');
    expect(source).toContain('还差课末终检');
    expect(source).toContain('继续作答最后一道独立终检题');
    expect(source).toContain('goAnswerFinishGate');
  });

  it('恢复会话从 sessionArtifacts 回填契约/报告，刷新后不会只看 4/4 就放完成', () => {
    expect(source).toContain('detail.state?.sessionArtifacts');
    expect(source).toContain('artifacts.lessonContract');
    expect(source).toContain('artifacts.lessonReport');
    expect(source).toContain('artifacts.exitTicket');
  });
});
