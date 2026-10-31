import fs from 'fs';
import path from 'path';
import { ensureCheckpointQuestionVisible } from '../teaching-turn-engine';

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
});
