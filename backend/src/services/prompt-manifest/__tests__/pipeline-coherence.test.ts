/**
 * 管线一致性回归：锁定 2026-10-29 清创的契约，不让冲突/退役口径再漂回去。
 * 纯静态读 core.yaml，不打 LLM；失败信息直接给出文件与修复方向。
 */
import * as fs from 'fs';
import * as path from 'path';
import yaml from 'js-yaml';

const CORE_DIR = path.resolve(process.cwd(), '..', 'prompts', 'core');

function readCore(skillId: string): Record<string, unknown> {
  return (yaml.load(fs.readFileSync(path.join(CORE_DIR, `${skillId}.yaml`), 'utf8')) as Record<string, unknown>) || {};
}

function rulesOf(skillId: string): string[] {
  const core = readCore(skillId);
  return Array.isArray(core.rules) ? core.rules.map((r: unknown) => String(r)) : [];
}

describe('teaching-turn 契约收口', () => {
  const rules = rulesOf('teaching-turn');

  it('看图指代只由 boardContext 决定，不再保留“文本自足是有条件的”旧分叉', () => {
    const rule15 = rules[17]; // 2026-11-23 再增 2 条条件规则（studentLinkMaterial/linkStatus）→ 编号 16→18，索引 15→17
    expect(rule15).toContain('boardContext');
    expect(rule15).toContain('文本自足与看图指代');
    expect(rule15).not.toContain('文本自足是有条件的');
  });

  it('完成候选不再要求“无提示独立完成”', () => {
    // 措辞演进：早期是「上一轮引导/提问下答对也算」，契约分流后为「以上均含在你上一轮引导/提问下达成」
    // ——意图不变：完成判定不把「无提示」当门槛，且不复活严格口径
    const rule = rules.find((r) => r.includes('上一轮引导/提问下达成') || r.includes('上一轮引导/提问下答对也算'));
    expect(rule).toBeTruthy();
    expect(rule).not.toContain('无提示下独立完成');
    expect(rule).toContain('isCompletionCandidate');
  });

  it('“答对”的无提示定义只用于掌握证据，不用于完成判定', () => {
    const rule = rules.find((r) => r.includes('只用于掌握度/知识看板判定'));
    expect(rule).toBeTruthy();
    expect(rule).toContain('不用于 control.isCompletionCandidate');
  });

  it('figure.kind 枚举包含 split-compare，且给出 normalizer 认的 spec 字段', () => {
    const figure = ((readCore('teaching-turn').fields || []) as Array<{ name?: unknown; desc?: unknown }>).find((f) => f.name === 'figure');
    const desc = String(figure?.desc || '');
    expect(desc).toContain('split-compare');
    // 只加枚举不够：模型会自创 lines/branch，normalizer 按 head/rows/delta 校验后整图丢弃
    // （2026-10-29 真 LLM 实测：kind 正确但 spec 用 title/lines/branch → 不出图）。
    expect(desc).toContain('"head"');
    expect(desc).toContain('"rows"');
    expect(desc).toContain('"delta"');
  });
});

describe('path-planning 里程碑口径', () => {
  it('key_stages 不再锁定阶段数：按自然盲区收敛，不要求等值', () => {
    const rule = rulesOf('path-planning').find((r) => r.includes('里程碑数量的最终口径'));
    expect(rule).toBeTruthy();
    expect(rule).toContain('契约收窄');
    expect(rule).toContain('自然收敛');
    expect(rule).toContain('不要求等于 Goal 的 key_stages 数量');
  });
});

describe('path-task-design 默认值与交付物口径', () => {
  const rules = rulesOf('path-task-design');

  it('skillNature 缺失时统一按 cognitive_internalized，不再回退 tool_operation', () => {
    const joined = rules.join('\n');
    expect(joined).toContain('字段缺失（未声明）的全局口径：按 `cognitive_internalized`');
    expect(joined).not.toContain('按 `tool_operation` 的通用口径');
  });

  it('交付物与业务判断统一为一个锚，不再要求每阶段额外生产成品（2026-11-09 外评批次改写后口径）', () => {
    // 旧规则「真实交付与判断锚」已并入 firstDeliverable/successCriteria 内联规则：
    // 衔接方式 = 对上一阶段产物做业务判断或推进它一步，判断就是推进，不为打卡而生产。
    const joined = rules.join('\n');
    expect(joined).toContain('对上一阶段产物做业务判断或推进它一步');
    expect(joined).toContain('不要求每个阶段都塞一个交付物生产任务');
    expect(joined).toContain('判断就是推进，不要为打卡而生产');
  });
});

describe('goal-conversation 时间模型', () => {
  it('时间降维后不再输出总学时/总周数/objectiveScopeHours', () => {
    const core = readCore('goal-conversation');
    const text = JSON.stringify(core.fields || []);
    expect(text).toContain('不再输出');
    expect(text).toContain('objectiveScopeHours');
    expect(text).not.toContain('可以保留原字段名与原形态用于平台审计');
    // 旧值不由后端补算：prompt 不能再承诺一个代码里不存在的计算（2026-10-29 核查）。
    expect(text).not.toContain('后端 TypeScript 从新三元组确定性计算');
  });
});

describe('VL 判决链', () => {
  it('判决门文案与代码一致：观测留痕，结课权威在教师侧', () => {
    const joined = rulesOf('simulation-learn-turn').join('\n');
    expect(joined).toContain('平台会把判决作为观测留痕');
    expect(joined).not.toContain('代码会强制拦截');
  });

  it('判决器 inputs 声明了 pendingCheckpoint', () => {
    const core = readCore('simulation-epistemic-grounding');
    expect(((core.inputs || []) as Array<{ name?: unknown }>).some((i) => i.name === 'pendingCheckpoint')).toBe(true);
  });
});

describe('maxTokens 预算', () => {
  // 用户口径（2026-10-29）：全部 64000，不分档。轻量 Skill 也不降配——
  // 分档会让长输出在截断处静默丢字段，且各 Skill 的实际输出长度无法静态保证。
  it('所有 core 统一 64000', () => {
    for (const file of fs.readdirSync(CORE_DIR).filter((f) => f.endsWith('.yaml'))) {
      const core = yaml.load(fs.readFileSync(path.join(CORE_DIR, file), 'utf8')) as { params?: { maxTokens?: unknown } };
      expect({ file, maxTokens: core?.params?.maxTokens }).toEqual({
        file,
        maxTokens: 64000,
      });
    }
  });
});

describe('pipeline map 分类（不把直调/孤儿 prompt 静默当主链）', () => {
  // 2026-11-02 更新：a896886d 已把 teaching-board-design 按 F7 登记进 prompts/skills.yaml
  // （kind=handler-only、registrationPoint=none、prompt 以独立产物 skill.teaching-board-design.md 承载）。
  // 登记之后它不再是「绕过户口簿的 compiled-only」，而是**已登记的直调能力**——本用例据此改成
  // 断言「它在 skillsWithoutPrompt 里被显式标为 handler-only，且不在 compiled-only 名单里」，
  // 保留原意：直调/孤儿 prompt 不许被当成主链静默混入。
  it('teaching-board-design 已登记为 handler-only（不再是 compiled-only）；无 core 的孤儿 prompt 单列', () => {
    const mapPath = path.resolve(process.cwd(), '..', 'doc', 'pipeline-map.json');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    const ids = (rows: Array<Record<string, unknown>>) => rows.map((row) => row.skillId || row.id || row.name);
    expect(ids(map.skillsWithoutPrompt)).toContain('teaching-board-design');
    expect(ids(map.compiledOnlyPrompts)).not.toContain('teaching-board-design');
    expect(ids(map.orphanPrompts)).toEqual(
      expect.arrayContaining(['concept-priority', 'path-adjustment-generator']),
    );
  });
});

describe('pipeline map 输入声明覆盖', () => {
  it('mainline 不允许无 inputs，除非是 service 直调（运行期入参）的已知例外', () => {
    const mapPath = path.resolve(process.cwd(), '..', 'doc', 'pipeline-map.json');
    const map = JSON.parse(fs.readFileSync(mapPath, 'utf8'));
    // profile-learning-predict 由 TeachingContextBuilder service 直调，入参是运行期对象，
    // core 的 inputs schema 要求 ref（skill/sandbox/user），没有 truthful 的 ref 可声明。
    // 其余 mainline 若 inputs=0，视为契约缺失（新 Skill 漏声明）。
    const runtimeInputMainline = new Set(['profile-learning-predict']);
    const missing = (map.prompts as Array<{ kind?: unknown; inputs?: unknown; skillId: string }>)
      .filter((p) => p.kind === 'mainline' && p.inputs === 0)
      .map((p) => p.skillId)
      .filter((id: string) => !runtimeInputMainline.has(id));
    expect(missing).toEqual([]);
  });
});
