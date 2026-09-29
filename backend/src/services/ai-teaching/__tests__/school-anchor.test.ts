/**
 * 学校体系锚进课堂（2026-09-30，实测驱动）。
 *
 * 背景：教材版本/考纲/在校进度在人设与 goal 提取里给得很具体（「同济版教材，期末闭卷」
 * 「统编版教材，考试为新高考卷题型」「第 10 周讲到向量组」），但教学对话 0 引用——
 * 实测线代 64 回合、语文 25 回合，对「教材/同济/统编版/新高考/统考」零提及。
 * 数据在持久化 normalizedInput 的 learnerProfile 自由文本里，教学层从不读取。
 *
 * 本测试锁 `resolveSchoolAnchorForTeaching` 的读侧契约：三种持久化形态都能取到、
 * 空模板返回 null（键缺省、课堂行为不变）。
 */
import { resolveSchoolAnchorForTeaching } from '../TeachingContextBuilder';

const makeTemplate = (normalizedInput: Record<string, unknown>) => JSON.stringify({
  sceneFraming: { normalizedInput },
});

describe('resolveSchoolAnchorForTeaching · 学校体系锚读侧', () => {
  it('从 sceneFraming.normalizedInput 取 background 与 baselineEvidence', () => {
    const t = makeTemplate({
      learnerProfile: {
        backgroundExperience: '高二语文在读，使用统编版教材，考试为新高考卷题型，对小说散文阅读题有做题经验但得分低',
        currentBaseline: { level: 'intermediate', evidence: '高二学生，统编版教材，熟悉新高考卷题型，但阅读题得分极低' },
      },
    });
    const a = resolveSchoolAnchorForTeaching(t)!;
    expect(a).toBeTruthy();
    expect(a.background).toContain('统编版');
    expect(a.background).toContain('新高考');
    expect(a.baselineEvidence).toContain('统编版');
  });

  it('baselineEvidence 缺失时只带 background（字段独立，不互相拖垮）', () => {
    const t = makeTemplate({
      learnerProfile: { backgroundExperience: '同济版教材，期末闭卷，第 10 周讲到向量组' },
    });
    const a = resolveSchoolAnchorForTeaching(t)!;
    expect(a.background).toContain('同济版');
    expect(a.baselineEvidence).toBeNull();
  });

  it('无 learnerProfile → null（键缺省，课堂行为不变）', () => {
    expect(resolveSchoolAnchorForTeaching(makeTemplate({ learnerProfile: {} }))).toBeNull();
    expect(resolveSchoolAnchorForTeaching(makeTemplate({}))).toBeNull();
  });

  it('空/非法模板 → null（不抛错，观测器不许成为新的故障点）', () => {
    expect(resolveSchoolAnchorForTeaching(null)).toBeNull();
    expect(resolveSchoolAnchorForTeaching('')).toBeNull();
    expect(resolveSchoolAnchorForTeaching('not-json')).toBeNull();
  });

  it('回退链：顶层 normalizedInput（历史持久化形态）也能取到', () => {
    const t = JSON.stringify({
      normalizedInput: {
        learnerProfile: { backgroundExperience: '大学线性代数，同济版教材，期末统考闭卷' },
      },
    });
    const a = resolveSchoolAnchorForTeaching(t)!;
    expect(a.background).toContain('同济版');
  });
});
