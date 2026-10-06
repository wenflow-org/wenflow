/**
 * F5 triage-judge 僵尸位退役（R1 REVIEW 2026-10-05 finding A15）回归守卫。
 *
 * 契约（对齐 retired-skills.ts 退役纪律 + check-retired-skill-lists.ts 活跃守卫）：
 * 1. 退役位在册：triage-judge 进入 ALL_RETIRED_SKILLS（ retired-skills.ts 单源名单）；
 * 2. 摘注册：不入 allSkillDefinitions / skillHandlers（gateway 注册面、F8/F11 活跃互斥的前提）；
 * 3. 保留可执行面：eval-triage-judge / replay-path-planning 经 auxSkillDefinitionMap +
 *    executableSkillHandlers 直调不破——退役 ≠ 删代码。
 * 名单采用「不入启动 purge」位（不动历史数据）：skill_model_configs / agent_prompts ACTIVE
 * 存量行保留，仅供 cleanup-retired-field-data 手动清理——本测试不覆盖 DB 行为（启动 purge
 * 只对 PURGED_SKILLS 生效，triage-judge 不在其中，属设计口径）。
 */
import { ALL_RETIRED_SKILLS } from '../retired-skills';
import { allSkillDefinitions, skillHandlers, executableSkillHandlers } from '../index';
import {
  auxSkillDefinitions,
  auxSkillHandlers,
  auxSkillDefinitionMap,
  auxRetiredSkillHandlers,
} from '../v4-aux-skills';

const RETIRED_ID = 'triage-judge';

/** 修复前 2026-09-15 退役波（course-design 等）之外的 aux 全集，用于防「顺手多摘」回归。 */
const ACTIVE_AUX_AFTER_RETIREMENT = [
  'teaching-opening-generator',
  'learner-progress-report',
  'skill-author',
  'skill-compiler',
  'learner-state-review',
  'concept-consolidator',
  'concept-load-estimator',
  'replan-attribution',
];

describe('F5 triage-judge 僵尸位退役', () => {
  it('退役位在册：triage-judge 进入 ALL_RETIRED_SKILLS（retired-skills.ts 单源名单）', () => {
    expect(ALL_RETIRED_SKILLS).toContain(RETIRED_ID);
  });

  it('已摘注册：不入 allSkillDefinitions / skillHandlers（gateway 注册面）', () => {
    expect(allSkillDefinitions.map((definition) => definition.name)).not.toContain(RETIRED_ID);
    expect(Object.keys(skillHandlers)).not.toContain(RETIRED_ID);
  });

  it('已摘注册：不入 auxSkillDefinitions / auxSkillHandlers（活跃守卫要求与退役名单互斥）', () => {
    expect(auxSkillDefinitions.map((definition) => definition.name)).not.toContain(RETIRED_ID);
    expect(Object.keys(auxSkillHandlers)).not.toContain(RETIRED_ID);
    // 未被顺手多摘：其余 8 个 aux skill 全部保持注册
    expect(auxSkillDefinitions.map((definition) => definition.name).sort())
      .toEqual([...ACTIVE_AUX_AFTER_RETIREMENT].sort());
  });

  it('保留可执行面：eval/replay 直调路径（definition + handler）不被删除', () => {
    expect(auxSkillDefinitionMap[RETIRED_ID]?.name).toBe(RETIRED_ID);
    expect(typeof auxRetiredSkillHandlers[RETIRED_ID]).toBe('function');
    expect(typeof executableSkillHandlers[RETIRED_ID]).toBe('function');
    // 注册面其余成员的直调路径不回归（executableSkillHandlers ⊇ skillHandlers）
    expect(typeof executableSkillHandlers['replan-attribution']).toBe('function');
    expect(typeof executableSkillHandlers['concept-consolidator']).toBe('function');
  });

  it('活跃守卫镜像：ALL_RETIRED_SKILLS ∩ 注册集 = ∅（retired:check 第 2 项的同款不变量）', () => {
    const registeredNames = new Set(allSkillDefinitions.map((definition) => definition.name));
    const conflicts = ALL_RETIRED_SKILLS.filter((name) => registeredNames.has(name));
    expect(conflicts).toEqual([]);
  });
});
