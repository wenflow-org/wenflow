import fs from 'fs';
import path from 'path';
import { ensureCheckpointQuestionVisible, stripLearnerNarrationOpening } from '../teaching-turn-engine';

/**
 * P0-4（外部审计）：检查点题面原本只存在于 pendingCheckpoint，教师回复正文不打印，
 * 学员可见历史里就出现「回答了一道从未出现过的题」。这里把题面补进可见回复。
 */
describe('ensureCheckpointQuestionVisible（检查点题面可见性）', () => {
  it('回复不含题面 → 追加题面', () => {
    const reply = '预览里还叠吗？';
    const question = '一页宽只是等比压窄，列宽比例没变，这说明什么？';
    const result = ensureCheckpointQuestionVisible(reply, question);
    expect(result.startsWith(reply)).toBe(true);
    expect(result).toContain(question);
  });

  it('回复已含题面（忽略空白差异）→ 不重复追加', () => {
    const question = '横向改完还是叠，下一步该动哪里？';
    const reply = `先别急着换纸张。\n\n${question}`;
    expect(ensureCheckpointQuestionVisible(reply, question)).toBe(reply);
    expect(ensureCheckpointQuestionVisible(`横向改完还是叠， 下一步该动哪里？`, question))
      .toBe('横向改完还是叠， 下一步该动哪里？');
  });

  it('空回复 → 直接返回题面；空题面 → 原样返回', () => {
    expect(ensureCheckpointQuestionVisible('', '题面')).toBe('题面');
    expect(ensureCheckpointQuestionVisible('原话', '')).toBe('原话');
  });

  it('老师已用自己的措辞问过同一道题 → 不重复贴题面', () => {
    const reply = '最后再确认第 1 步：设置打印区域时，框选的范围该到哪儿？';
    const question = '设置打印区域时，框选的范围应该是哪一段？';
    expect(ensureCheckpointQuestionVisible(reply, question)).toBe(reply);
  });

  it('接线守卫：新出题与答错重出题两条路径共用同一可见性写入', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'teaching-turn-engine.ts'), 'utf-8');
    const calls = source.match(/applyCheckpointQuestionVisibility\(checkpointCandidate\.question\)/g) || [];
    // 新出题 + 答错重出题（旧实现只覆盖新出题）
    expect(calls.length).toBe(2);
    expect(source).toContain('teachingOutput.reply = visibleWithQuestion');
    expect(source).toContain('effectiveTeachingOutput.reply = visibleWithQuestion');
  });

  // 2026-11-26 真课实录（Case A2 第 11 回合）：模型先把 ¹⁸O 情境改写一遍并提问，
  // 又把 control.checkpoint.question 原样贴一遍——一条回复里同一道题出现两次。
  it('题面前面有同题复读 → 剪掉复读，只留一段引入 + 题面', () => {
    const question = '某同学用只含 ¹⁸O 标记的葡萄糖培养液培养酵母菌，氧气充足，一段时间后检测到释放的 CO₂ 中含 ¹⁸O，但生成的 H₂O 中不含 ¹⁸O。他据此认为「CO₂ 和 H₂O 是在同一个场所产生的」。这个结论对不对？请说明你的判断依据。';
    const reply = [
      '这段收得挺准——你把主线自己串出来了。',
      '',
      '那换个新情境验一下这条口径还立不立得住：',
      '',
      '某同学用只含 ¹⁸O 标记的葡萄糖培养液培养酵母菌，在氧气充足条件下培养一段时间，检测到释放的 CO₂ 中含 ¹⁸O，但生成的 H₂O 中不含 ¹⁸O。他据此认为「CO₂ 和 H₂O 是在同一个场所产生的」。',
      '',
      '请你判断他这个结论对不对，并说清你是靠哪一步反应判出来的。',
      '',
      question,
    ].join('\n');
    const result = ensureCheckpointQuestionVisible(reply, question);
    expect(result).toBe([
      '这段收得挺准——你把主线自己串出来了。',
      '',
      '那换个新情境验一下这条口径还立不立得住：',
      '',
      question,
    ].join('\n'));
    // 题面只出现一次（归一后计次）
    const appearances = result.split('这个结论对不对').length - 1;
    expect(appearances).toBe(1);
  });

  it('剪完只剩题面 → 不剪（题面可见优先于去重）', () => {
    const question = '为什么第二阶段的场所不是线粒体内膜，而是线粒体基质？';
    const reply = `请你判断这个结论对不对？\n\n${question}`;
    expect(ensureCheckpointQuestionVisible(reply, question)).toBe(reply);
  });

  it('题面前一段是正常讲解 → 不动', () => {
    const question = '第三阶段的场所是线粒体内膜，那它拿什么当原料？';
    const reply = `第二阶段在线粒体基质里把丙酮酸彻底拆开，放出 CO₂。\n\n${question}`;
    expect(ensureCheckpointQuestionVisible(reply, question)).toBe(reply);
  });
});

/**
 * 2026-11-26 真课实录（Case A2 第 4 回合）：模型把内部分析写进可见正文，
 * 「学生只说了「继续」，那就顺着往下讲。」——学生看到的是「有个学情分析在说话」。
 */
describe('stripLearnerNarrationOpening（第三人称转述学生）', () => {
  it('开头一句是转述学生输入 → 剪掉，保留正文', () => {
    const reply = '学生只说了「继续」，那就顺着往下讲。先看板上「第一阶段 糖酵解」这一行。';
    expect(stripLearnerNarrationOpening(reply)).toBe('先看板上「第一阶段 糖酵解」这一行。');
  });

  it('「学生只回了『继续』」同样剪掉（A5 实录：回了 不在原动词表里）', () => {
    const reply = '学生只回了「继续」，我按课堂阶段继续讲第一段。先看板上「第一阶段 糖酵解」这一行。';
    expect(stripLearnerNarrationOpening(reply)).toBe('先看板上「第一阶段 糖酵解」这一行。');
  });

  it('讲误解的正常教学句（无时间限定词）→ 不动', () => {
    const reply = '学生常把第一阶段和第二阶段弄混，这是本课最常见的误区。';
    expect(stripLearnerNarrationOpening(reply)).toBe(reply);
  });

  it('剪掉后没有正文 → 保留原文', () => {
    const reply = '学生刚才说继续。';
    expect(stripLearnerNarrationOpening(reply)).toBe(reply);
  });

  it('正常回复不受影响', () => {
    const reply = '对，第二阶段就在线粒体基质。那顺着这个思路再走一步：丙酮酸被拆开时放出什么？';
    expect(stripLearnerNarrationOpening(reply)).toBe(reply);
  });
});
