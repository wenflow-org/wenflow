/**
 * #84 失败检查点概念的**后续回合**肯定语护栏（2026-10-19）：
 * 实证（zhongkao-streaming 批，cp_1791507198243_nprpr 两次 code failed「缺少要点：对边相等」）——
 * 提交轮硬门之后，老师在自由回合仍称「你答对了/这一关你走通了」。本文件钉死决策函数口径：
 * 仅当本回合知识点命中会话内 code 失败概念（精确或 ≥4 字包含）时剥离，防误剥与重复处理。
 */
import fs from 'fs';
import path from 'path';
import { shouldGuardReplyForFailedConcept, stripAffirmationsOnFailedVerdict } from '../checkpoint-feedback-guard';

describe('shouldGuardReplyForFailedConcept', () => {
  it('精确命中（归一后同串）→ true', () => {
    expect(shouldGuardReplyForFailedConcept({
      currentPoint: '辨认单个条件隐含的几何性质',
      failedConceptNames: ['辨认单个条件隐含的几何性质'],
    })).toBe(true);
    expect(shouldGuardReplyForFailedConcept({
      currentPoint: ' 辨认单个条件隐含的几何性质 ',
      failedConceptNames: ['辨认单个条件隐含的几何性质'],
    })).toBe(true);
  });

  it('≥4 字包含匹配（带括号/后缀变体）→ true；不足 4 字的短名不做包含→ false（精度优先）', () => {
    expect(shouldGuardReplyForFailedConcept({
      currentPoint: '辨认单个条件隐含的几何性质（单/多条件）',
      failedConceptNames: ['辨认单个条件隐含的几何性质'],
    })).toBe(true);
    expect(shouldGuardReplyForFailedConcept({
      currentPoint: '识别',
      failedConceptNames: ['识别条件'],
    })).toBe(false);
  });

  it('未命中失败概念 → false（不误剥其它已掌握概念的正常肯定）', () => {
    expect(shouldGuardReplyForFailedConcept({
      currentPoint: '核对批号有效期归属',
      failedConceptNames: ['辨认单个条件隐含的几何性质'],
    })).toBe(false);
  });

  it('本回合由提交硬门处理（judgingThisTurn）→ false（防重复剥离与重复遥测）', () => {
    expect(shouldGuardReplyForFailedConcept({
      currentPoint: '辨认单个条件隐含的几何性质',
      failedConceptNames: ['辨认单个条件隐含的几何性质'],
      judgingThisTurn: true,
    })).toBe(false);
  });

  it('退化输入：空知识点 / 空失败清单 / 非字符串 → false', () => {
    expect(shouldGuardReplyForFailedConcept({ currentPoint: '', failedConceptNames: ['x'] })).toBe(false);
    expect(shouldGuardReplyForFailedConcept({ currentPoint: undefined, failedConceptNames: ['x'] })).toBe(false);
    expect(shouldGuardReplyForFailedConcept({ currentPoint: '概念甲', failedConceptNames: [] })).toBe(false);
    expect(shouldGuardReplyForFailedConcept({ currentPoint: '概念甲', failedConceptNames: null })).toBe(false);
    expect(shouldGuardReplyForFailedConcept({ currentPoint: 123 as unknown as string, failedConceptNames: ['123'] })).toBe(false);
  });

  it('命中后剥离确实压住「你答对了/这一关你走通了」这类肯定句（与提交轮同一剥离函数）', () => {
    const reply = '你答对了，AB = AC 确实意味着 ∠B = ∠C。好的，这一关你走通了。那我们现在只聚焦这一步：哪条边是 ∠B 的对边？';
    const screened = stripAffirmationsOnFailedVerdict(reply);
    expect(screened.stripped.length).toBeGreaterThanOrEqual(1);
    if (screened.applied) {
      expect(screened.reply).not.toContain('你答对了');
      expect(screened.reply).not.toContain('这一关你走通了');
    }
  });
});

describe('#84 护栏接线（源码守卫）', () => {
  const engineSource = fs.readFileSync(
    path.join(__dirname, '..', 'teaching-turn-engine.ts'),
    'utf-8'
  );

  it('引擎在提交轮硬门之后接线后续回合护栏，并使用单列遥测类别', () => {
    expect(engineSource).toContain('shouldGuardReplyForFailedConcept');
    expect(engineSource).toContain("faultCategory: 'MODEL_AFFIRMATION_AFTER_FAILED_CHECKPOINT'");
    expect(engineSource).toContain('buildCheckpointCodeArbitration(previousTeachingState.checkpointHistory)');
  });
});
