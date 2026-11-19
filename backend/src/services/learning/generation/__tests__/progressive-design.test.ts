/**
 * 渐进式调度单测（活的 path 批次 D2）：
 * isProgressiveStageDesignEnabled（flag 解析）/ extractLearnerSignals 信号提炼与钳制（纯函数）。
 * DB 查询面（buildPreviousStageOutcome 的 milestones/teaching_sessions 查询）由 probe-progressive E2E 覆盖。
 */
import { jest } from '@jest/globals';

jest.mock('../../../learner/LearnerSnapshotRefreshService', () => ({
  learnerSnapshotRefreshService: { refresh: jest.fn() },
}));

import {
  extractLearnerSignals,
  extractLessonReportSignals,
  isProgressiveStageDesignEnabled,
} from '../progressive-design';

describe('isProgressiveStageDesignEnabled', () => {
  const original = process.env.PROGRESSIVE_STAGE_DESIGN;
  afterEach(() => {
    if (original === undefined) delete process.env.PROGRESSIVE_STAGE_DESIGN;
    else process.env.PROGRESSIVE_STAGE_DESIGN = original;
  });

  it('默认开（未设置 / 空串；2026-11-18 起渐进式是默认形态）', () => {
    delete process.env.PROGRESSIVE_STAGE_DESIGN;
    expect(isProgressiveStageDesignEnabled()).toBe(true);
    process.env.PROGRESSIVE_STAGE_DESIGN = '';
    expect(isProgressiveStageDesignEnabled()).toBe(true);
  });
  it("'1'/'true' 开", () => {
    process.env.PROGRESSIVE_STAGE_DESIGN = '1';
    expect(isProgressiveStageDesignEnabled()).toBe(true);
    process.env.PROGRESSIVE_STAGE_DESIGN = 'true';
    expect(isProgressiveStageDesignEnabled()).toBe(true);
  });
  it("显式关（'0'/'false'/'off'，保留回滚路径）", () => {
    for (const value of ['0', 'false', 'off']) {
      process.env.PROGRESSIVE_STAGE_DESIGN = value;
      expect(isProgressiveStageDesignEnabled()).toBe(false);
    }
  });
});

describe('extractLearnerSignals 信号提炼（钳制 ≤5、mastered 除外）', () => {
  it('从快照与 wrapup 提炼，各类钳制 5 条', () => {
    const signals = extractLearnerSignals(
      {
        currentPath: {
          prerequisiteGaps: [
            { conceptName: '缺口1' }, { conceptName: '缺口2' }, { conceptName: '缺口3' },
            { conceptName: '缺口4' }, { conceptName: '缺口5' }, { conceptName: '缺口6' },
          ],
        },
        globalSignals: {
          fragileConcepts: ['脆弱1', '脆弱2', '脆弱3', '脆弱4', '脆弱5', '脆弱6'],
          strugglingConcepts: ['挣扎1', '挣扎2'],
        },
      },
      {
        summary: {
          knowledgeItems: [
            { name: '没掌握点', status: 'learning' },
            { name: '已掌握点', status: 'mastered' },
            { name: '复述点', status: 'review' },
          ],
        },
      }
    );
    expect(signals.fragileConcepts).toHaveLength(5);
    expect(signals.strugglingConcepts).toEqual(['挣扎1', '挣扎2']);
    expect(signals.prerequisiteGaps).toHaveLength(5);
    expect(signals.stillLearning).toEqual(['没掌握点', '复述点']); // mastered 不进 stillLearning
  });

  it('空快照/wrapup → 全空数组（不抛错）', () => {
    const signals = extractLearnerSignals({}, null);
    expect(signals).toEqual({
      fragileConcepts: [], strugglingConcepts: [], prerequisiteGaps: [], stillLearning: [],
    });
  });
});

describe('extractLessonReportSignals（课堂契约回流路径层）', () => {
  const stateWith = (report: Record<string, unknown>, contract?: Record<string, unknown>) => ({
    teachingState: {
      sessionArtifacts: {
        lessonReport: report,
        ...(contract ? { lessonContract: contract } : {}),
      },
    },
  });

  it('未达成 KC / 独立证据缺口 / 终检未过 / 停车区先修与拓展线索全部提炼', () => {
    const signals = extractLessonReportSignals([
      stateWith({
        met: false,
        missingKcs: ['识别违约金触发条件'],
        independentKcs: ['定位期限起算点'],
        exitTicket: { asked: true, passed: false, conceptName: '判断抗辩依据' },
        parkingLot: [
          { topic: '先修：合同成立要件' },
          { topic: '程序员该不该考公' },
        ],
      }, {
        coreKcs: [
          { name: '识别违约金触发条件' },
          { name: '定位期限起算点' },
          { name: '判断抗辩依据' },
        ],
      }),
      // 同一任务更旧的课不应重复（调用方已按 task 取最新）；这里验证跨课去重
      stateWith({ met: true, missingKcs: ['识别违约金触发条件'], parkingLot: [{ topic: '先修：合同成立要件' }] }),
    ]);
    expect(signals.contractGaps).toEqual(['识别违约金触发条件']);
    expect(signals.weakKcs).toEqual(['识别违约金触发条件', '判断抗辩依据']);
    expect(signals.exitTicketGaps).toEqual(['判断抗辩依据']);
    expect(signals.prerequisitePatches).toEqual(['先修：合同成立要件']);
    expect(signals.parkingLotTopics).toEqual(['程序员该不该考公']);
  });

  it('无 lessonReport 的旧课 → 不产生任何键（设计输入保持骨架级）', () => {
    expect(extractLessonReportSignals([{ teachingState: { sessionArtifacts: {} } }])).toEqual({});
  });

  it('JSON 字符串形态的 teachingState 同样可解析', () => {
    const session = {
      teachingState: JSON.stringify({
        sessionArtifacts: {
          lessonReport: { met: false, missingKcs: ['A'] },
          lessonContract: { coreKcs: [{ name: 'A' }] },
        },
      }),
    };
    expect(extractLessonReportSignals([session]).contractGaps).toEqual(['A']);
  });
});
