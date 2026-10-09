/**
 * 检查点判错反馈的开头口径（UX 走查 walkc-j17 实测，2026-10-09）。
 *
 * 实证：检查点选择题选错（B 被判错并标红），导师反馈首句却是
 * 「你说得对——`\d{2}` 要求正好两位数字，遇到 14:23:5 时，它只能匹配到 5 前面的那位数字？
 * 等一下，我帮你捋清楚。」——首句复述并**肯定**了学生的错误答案，第二句才自我推翻，
 * 正确答案要到段末才出现。红色错项 + 「你说得对」首句自相矛盾，学生以为答对了。
 *
 * 既有规则只约束了「不出现词」与「裁决一致」（probe 的 test 锁 generatedSystemPrompt
 * 不含「答得对」），但生成的答案不落库、事后给不出证据，所以这里把口径锁在**真源**上：
 * ① prompts/core/teaching-turn.yaml 的 checkpointVerdict 规则必须写明「第一句先给裁决结论」
 *    与「禁止认同式开头」；② 该改动必须真的编译进产物 prompts/skill.teaching-turn.md
 *    （只改 yaml 没编译 = 空改，DB ACTIVE 才是运行时第一读取源）。
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

// 本文件位于 backend/src/services/ai-teaching/__tests__/ → 仓库根上溯 5 层
const REPO_ROOT = path.resolve(__dirname, '../../../../..');
const CORE = fs.readFileSync(path.join(REPO_ROOT, 'prompts/core/teaching-turn.yaml'), 'utf8');
const MD = fs.readFileSync(path.join(REPO_ROOT, 'prompts/skill.teaching-turn.md'), 'utf8');

/** 取源码里承载「检查点作答的代码裁决」的那一条（yaml `- ` 行 / md `- ` 行同形） */
function verdictRule(text: string): string {
  const line = text.split('\n').find((l) => l.includes('检查点作答的**代码裁决**'));
  if (!line) throw new Error('找不到「检查点作答的代码裁决」规则');
  return line;
}

describe('检查点判错反馈：开头先给裁决结论（walkc-j17）', () => {
  const coreRule = verdictRule(CORE);
  const mdRule = verdictRule(MD);

  it('core yaml：明确要求 reply 第一句先给裁决结论', () => {
    expect(coreRule).toContain('reply 的第一句必须先给裁决结论');
    expect(coreRule).toContain('先否定再解释');
  });

  it('core yaml：禁止用「你说得对」这类认同开头承接错误作答', () => {
    expect(coreRule).toContain('认同开头');
    expect(coreRule).toContain('你说得对');
    // 必须点名「先认同再自我推翻」这个具体症状，否则模型读到「不要在错答时认同」仍会复述选项
    expect(coreRule).toContain('先认同再自我推翻');
  });

  it('core yaml：禁止把裁决拖到后面，或把自问自答铺垫句放第一句', () => {
    expect(coreRule).toContain('把裁决放到后面');
    expect(coreRule).toContain('不要拖到段落末尾才说答案');
    expect(coreRule).toContain('自问自答的铺垫句');
    expect(coreRule).toContain('等一下，我帮你捋清楚');
  });

  it('裁决句之后才解释：原先的「指出没答到的部分」要求仍在', () => {
    expect(coreRule).toContain('裁决句之后再指出没答到的部分');
    expect(coreRule).toContain('不要罗列答案键原文');
  });

  it('规则真的编译进产物 md（同一行、同一口径）', () => {
    expect(mdRule).toContain('reply 的第一句必须先给裁决结论');
    expect(mdRule).toContain('认同开头');
    expect(mdRule).toContain('把裁决放到后面');
    // yaml 与 md 去壳（行首 `- ` 与行尾空白）后正文一致（防 md 被手工改回而 yaml 没跟上）
    expect(mdRule.replace(/^\s*-\s*/, '').trimEnd()).toBe(coreRule.replace(/^\s*-\s*/, '').trimEnd());
  });

  it('既有约束未被顶掉：通过裁决仍「正常确认并推进」、不泄露技术来源', () => {
    expect(coreRule).toContain('passed=true 时正常确认并推进');
    expect(coreRule).toContain('绝不可');
    expect(coreRule).toContain('checkpointVerdict 缺失时忽略本条');
  });
});
