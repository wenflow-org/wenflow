/**
 * 检查点「代码判对、模型否定」护栏（2026-10-28 f3 实拍）。
 *
 * 证据：答案键 A / 学生选 A / checkpointHistory.passed=true；
 * 模型回复「这道不对——A 还是没答到点上」，随后逼学生把三行现象重写一遍。
 */
import fs from 'fs';
import path from 'path';
import { repairContradictedPassedVerdict } from '../checkpoint-feedback-guard';

describe('repairContradictedPassedVerdict', () => {
  it('f3 实拍：passed=true 但回复以「这道不对」开头 → 换成确定性确认', () => {
    const reply =
      '这道不对——A 还是没答到点上。你可能觉得 A 只写了看到的东西，但「暖风一直吹」加上「菜叶发黄、新芽没几个」，' +
      '两件事并排放在一起，读起来已经在暗示「暖了还是慢」这个对照了。你先只做一件事：把这三样重写一遍。';
    const out = repairContradictedPassedVerdict(reply);
    expect(out).toContain('对，这道答对了');
    expect(out).not.toContain('这道不对');
    expect(out).not.toContain('没答到点上');
  });

  it('保留原回复最后一个问句，维持推进', () => {
    const reply = '这道不对——先别急着往下走。你先说说，A 里哪个词让你觉得它只是现象？';
    const out = repairContradictedPassedVerdict(reply);
    expect(out).toContain('对，这道答对了');
    expect(out).toContain('A 里哪个词让你觉得它只是现象？');
  });

  it('正常确认的回复原样返回（不误改）', () => {
    const reply = '对，选 A 是对的——这一句只写了看得见的东西，没有滑到解释。接下来看第二组。';
    expect(repairContradictedPassedVerdict(reply)).toBe(reply);
  });

  it('句首垫话后否决也要修（独立评审 P2：开头锚定会漏）', () => {
    const reply = '好的，这道题不对——A 还是没答到点上。再想想「暖风一直吹」暗示了什么？';
    const out = repairContradictedPassedVerdict(reply);
    expect(out).toContain('对，这道答对了');
    expect(out).not.toContain('这道题不对');
    expect(out).toContain('暗示了什么？');
  });

  it('首句是问句时不修（「答错了吗？」是提问不是否决）', () => {
    const reply = '我看看，你答错了吗？我们再核对一遍选项。';
    expect(repairContradictedPassedVerdict(reply)).toBe(reply);
  });

  it('否定词前有「没/不」时不算否决（「没答错」「没选错」是肯定）', () => {
    const first = '很好，这道题你没答错，思路很清楚。';
    const second = '对，这次没选错。接下来看第二组。';
    expect(repairContradictedPassedVerdict(first)).toBe(first);
    expect(repairContradictedPassedVerdict(second)).toBe(second);
  });

  it('后面句子里的否决不误判（只检查首句）', () => {
    const reply = '对，这道答对了。如果不对，我们再看第二组。';
    expect(repairContradictedPassedVerdict(reply)).toBe(reply);
  });

  it('退化输入原样返回', () => {
    expect(repairContradictedPassedVerdict('')).toBe('');
    expect(repairContradictedPassedVerdict(null)).toBe(null);
    expect(repairContradictedPassedVerdict(undefined)).toBe(undefined);
  });
});

describe('护栏接线（源码守卫）', () => {
  const engineSource = fs.readFileSync(
    path.join(__dirname, '..', 'teaching-turn-engine.ts'),
    'utf-8'
  );

  it('引擎在 passed=true 的提交轮调用对称护栏并记录遥测', () => {
    expect(engineSource).toContain('repairContradictedPassedVerdict');
    expect(engineSource).toContain("faultCategory: 'MODEL_NEGATION_ON_PASSED_CHECKPOINT'");
    expect(engineSource).toContain('options.checkpointJudgement.passed === true');
  });
});
