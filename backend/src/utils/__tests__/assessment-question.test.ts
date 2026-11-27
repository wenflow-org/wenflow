import { parseAssessmentQuestion, stripOptionLetterInstruction } from '../assessment-question';

describe('stripOptionLetterInstruction（题干不承载界面操作指令）', () => {
  it('剥掉末尾「回复选项字母」的各种说法，保留题干正文', () => {
    expect(stripOptionLetterInstruction('哪一格是高峰？回复选项字母。')).toBe('哪一格是高峰？');
    expect(stripOptionLetterInstruction('哪一格是高峰？请回复选项字母即可')).toBe('哪一格是高峰？');
    expect(stripOptionLetterInstruction('哪一格是高峰？选选项字母')).toBe('哪一格是高峰？');
    expect(stripOptionLetterInstruction('哪一格是高峰？')).toBe('哪一格是高峰？');
  });

  it('题干中间的「选项字母」一词不误删', () => {
    expect(stripOptionLetterInstruction('选项字母 A 代表哪一种口径？')).toBe('选项字母 A 代表哪一种口径？');
  });
});

describe('parseAssessmentQuestion：入口统一清洗', () => {
  it('单选题题干末尾的「回复选项字母」在解析时被剥掉', () => {
    const parsed = parseAssessmentQuestion({
      question: '换一张表：42、38、95、61、50，哪一格是高峰？回复选项字母。',
      type: 'single_choice',
      options: [{ id: 'A', text: '13:00' }, { id: 'B', text: '14:00' }, { id: 'C', text: '15:00' }],
      correctOptionIds: ['C'],
    });
    expect(parsed?.question).toBe('换一张表：42、38、95、61、50，哪一格是高峰？');
  });

  it('只有界面指令、没有正文 → 判为无效题', () => {
    expect(parseAssessmentQuestion({
      question: '回复选项字母。',
      type: 'single_choice',
      options: [{ id: 'A', text: '甲' }, { id: 'B', text: '乙' }],
      correctOptionIds: ['A'],
    })).toBeNull();
  });
});
