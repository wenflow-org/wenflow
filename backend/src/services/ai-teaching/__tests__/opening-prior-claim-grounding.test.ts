import { hasUnverifiablePriorClaim } from '../teaching-turn-engine';

/**
 * 开场「上一课经历」接地守卫（修复批 8，OPENING_ASSUME_EXPERIENCE 课堂聚类 4/5）：
 * lastLessonRecap 缺席（无可核验上一课记录）时，开场文本断言上一课经历即违例
 * → 引擎按接地约束重生成一次（条件式表述或锚定本课材料）。
 * 这里钉住可复算判定器：病历单形态全命中、条件式/锚定表述不误伤。
 */
describe('hasUnverifiablePriorClaim（开场上一课经历接地判定）', () => {
  it('病历单形态全命中：上一课/上一阶段/上次/你说过', () => {
    expect(hasUnverifiablePriorClaim({
      message: '上一课你把竞业限制和违约金那五处逐条判完了，今天往下走。',
      question: '',
    })).toBe(true);
    expect(hasUnverifiablePriorClaim({
      message: '上一阶段那三把尺子已经走稳了，这节课加第四把。',
      question: '',
    })).toBe(true);
    expect(hasUnverifiablePriorClaim({
      message: '我们直接看这份合同。',
      question: '你说过要的是能发给 HR 的那句话，对吧？',
    })).toBe(true);
    expect(hasUnverifiablePriorClaim({
      message: '上次课的三个要点还记得吗？今天换个新情形。',
      question: '',
    })).toBe(true);
  });

  it('条件式表述（如果你之前…）不算断言 → 不违例', () => {
    expect(hasUnverifiablePriorClaim({
      message: '如果你之前接触过竞业限制条款，今天可以拿自己的合同对照；没接触过也不影响，我们从法定下限说起。',
      question: '',
    })).toBe(false);
  });

  it('锚定本课材料 → 不违例', () => {
    expect(hasUnverifiablePriorClaim({
      message: '你手上这份合同有五处需要逐条核对，先从竞业限制那段开始。',
      question: '看着这段，你觉得哪一句最先站不住？',
    })).toBe(false);
  });

  it('message 与 question 都参与扫描', () => {
    expect(hasUnverifiablePriorClaim({
      message: '我们从法定下限开始。',
      question: '上一阶段的口径你还有印象吗？',
    })).toBe(true);
  });

  it('反向断言（批 12，批 L 聚类 5/5 tripwire）：断言学习者没做过某事同样违例', () => {
    expect(hasUnverifiablePriorClaim({
      message: '你之前没细看过这类合同，下周一又要签，心里没底很正常。今天我们把坑逐个点出来。',
      question: '',
    })).toBe(true);
    expect(hasUnverifiablePriorClaim({
      message: '你以前从没接触过财报，我们从第一张表开始。',
      question: '',
    })).toBe(true);
    expect(hasUnverifiablePriorClaim({
      message: '你过去不太见过这种条款写法吧？我们先看最常见的。',
      question: '',
    })).toBe(true);
  });

  it('条件式反向表述不违例（批 8 钉住的合法衔接形态的反向版）', () => {
    expect(hasUnverifiablePriorClaim({
      message: '如果你之前没接触过竞业限制，今天我们从法定下限说起；接触过的话可以直接判条款。',
      question: '',
    })).toBe(false);
    expect(hasUnverifiablePriorClaim({
      message: '要不要先看看你对这类合同的印象？没看过也没关系，我们从样例开始。',
      question: '',
    })).toBe(false);
  });
});
