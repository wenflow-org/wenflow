/**
 * #218 契约守卫：用户侧 AgentLogs.vue 的本地字典必须与 agent manifest 对齐。
 *
 * 背景：前端没有自动化门禁，字典写死在后端的镜像表里，已两次与 manifest 脱节
 * （旧 id teaching-agent / ai-teaching-agent / learner-model-agent 线上 0 行；
 *  manifest Profile 组新增的 7 个 skill 未进字典，被 `|| 'system'` 归成「平台底层」）。
 * 服务端 capabilityType 已改为按 manifest 派生，前端必须在同一 id 集合上映射，
 * 否则服务端筛出的行会在 displayLogs 的客户端二次过滤里被丢掉。
 *
 * 这里用后端 jest 读取 .vue 源码做文本解析（不构建前端）：
 *   - 能力类型映射 / 展示名字典覆盖 manifest 四个能力组的全部 id；
 *   - 能力类型映射的**值**等于 manifest 声明的分组（只锁键集合挡不住 id 换组）；
 *   - 字典键与 Agent 下拉的 id 都必须是 manifest 已知 id 或 alias（防再挂废弃 id）。
 */
import fs from 'fs';
import path from 'path';

import { listAgentManifest, listUserListedAgentIds } from '../../services/agent-manifest.service';

const VUE_PATH = path.resolve(__dirname, '../../../../frontend/src/views/user/AgentLogs.vue');
const CAPABILITY_GROUPS = ['Goal', 'Path', 'Teaching', 'Profile'];
// 不在 manifest 中但有日志写入/历史兼容的 id
const NON_MANIFEST_IDS = ['unknown', 'system-call', 'ai-tutor'];

function readSource(): string {
  return fs.readFileSync(VUE_PATH, 'utf8');
}

/** 取以 `marker` 开头的对象字面量块（到下一处两空格缩进的 `};` 为止） */
function objectBlock(source: string, marker: string): string {
  const start = source.indexOf(marker);
  if (start < 0) {
    throw new Error(`未找到字典块：${marker}（前端源文件结构变化时需同步本守卫）`);
  }
  const end = source.indexOf('\n  };', start);
  if (end < 0) {
    throw new Error(`字典块未闭合：${marker}`);
  }
  return source.slice(start, end);
}

function objectKeys(source: string, marker: string): string[] {
  return [...objectBlock(source, marker).matchAll(/'([^']+)':/g)].map((match) => match[1]);
}

/** 取对象字面量块的「键 → 值」对（值限定为单引号字符串） */
function objectEntries(source: string, marker: string): Array<[string, string]> {
  return [...objectBlock(source, marker).matchAll(/'([^']+)':\s*'([^']*)'/g)].map(
    (match) => [match[1], match[2]] as [string, string]
  );
}

describe('#218 用户侧 AgentLogs.vue 字典与 manifest 对齐', () => {
  const source = readSource();
  const manifest = listAgentManifest();
  const manifestIds = new Set<string>();
  for (const entry of manifest) {
    manifestIds.add(entry.id);
    for (const alias of entry.aliases ?? []) manifestIds.add(alias);
  }
  const capabilityGroupIds = [
    ...new Set(
      manifest
        .filter((entry) => CAPABILITY_GROUPS.includes(entry.monitoringGroup ?? ''))
        .map((entry) => entry.id)
    )
  ];

  it('能力类型映射覆盖四个能力组的全部 manifest id', () => {
    const keys = objectKeys(source, 'const mapping: Record<string, string> = {');
    expect(keys.length).toBeGreaterThan(0);
    expect(capabilityGroupIds.filter((id) => !keys.includes(id))).toEqual([]);
  });

  it('展示名字典覆盖四个能力组的全部 manifest id', () => {
    const keys = objectKeys(source, 'const agentNames: Record<string, string> = {');
    expect(keys.length).toBeGreaterThan(0);
    expect(capabilityGroupIds.filter((id) => !keys.includes(id))).toEqual([]);
  });

  // #226：只锁「键集合相等」挡不住语义漂移——把 skill:teaching-turn 从 teaching 组
  // 挪到 profile 组，键集合不变、守卫仍绿。这里锁值：每个 manifest id 的分组值
  // 必须等于 manifest 声明的 monitoringGroup（小写）。
  it('每个 manifest id 的分组值等于 manifest 声明的分组值', () => {
    const entries = objectEntries(source, 'const mapping: Record<string, string> = {');
    const declaredGroup = new Map(
      manifest
        .filter((entry) => CAPABILITY_GROUPS.includes(entry.monitoringGroup ?? ''))
        .map((entry) => [entry.id, (entry.monitoringGroup as string).toLowerCase()])
    );

    const mismatched = [...declaredGroup.entries()]
      .map(([id, expected]) => {
        const actual = entries.find((entry) => entry[0] === id)?.[1] ?? '(缺失)';
        return actual === expected ? null : `${id}: manifest=${expected}, 前端 mapping=${actual}`;
      })
      .filter((item): item is string => item !== null);

    expect(mismatched).toEqual([]);
  });

  it('能力映射值都是已知能力类型（不写错拼写）', () => {
    const entries = objectEntries(source, 'const mapping: Record<string, string> = {');
    const allowedValues = new Set([
      ...CAPABILITY_GROUPS.map((group) => group.toLowerCase()),
      'tutoring',
      'tracking',
      'system'
    ]);
    expect(entries.filter(([, value]) => !allowedValues.has(value))).toEqual([]);
  });

  it('字典键与 Agent 下拉都只使用 manifest 已知 id（不挂废弃 id）', () => {
    const keys = [
      ...objectKeys(source, 'const mapping: Record<string, string> = {'),
      ...objectKeys(source, 'const agentNames: Record<string, string> = {')
    ];
    expect(keys.filter((id) => !manifestIds.has(id) && !NON_MANIFEST_IDS.includes(id))).toEqual([]);

    const optionsStart = source.indexOf('const AGENT_OPTIONS = [');
    expect(optionsStart).toBeGreaterThan(-1);
    const optionsBlock = source.slice(optionsStart, source.indexOf('\n];', optionsStart));
    const optionIds = [...optionsBlock.matchAll(/value: '([^']+)'/g)]
      .map((match) => match[1])
      .filter(Boolean);
    expect(optionIds.length).toBeGreaterThan(0);
    expect(optionIds.filter((id) => !manifestIds.has(id))).toEqual([]);
  });

  // #226 残余：tutoring 在 manifest 里没有监控组、profile 组内也没有 userListed 的 id，
  // 这两项筛选**结构性恒空**。产品口径是「保留筛选项 + 专属空态文案」（见 issue #226
  // 「二选一」的第二支），绝不能沿用通用的「暂无日志」——用户会把它读成加载或筛选出错。
  // 本用例把这条口径钉成契约：后端映射为空的每个能力，前端下拉若仍提供，就必须有专属文案。
  it('#226 结构性空的能力筛选项在前端有专属空态文案（不退化成通用「暂无日志」）', () => {
    const userListed = new Set(listUserListedAgentIds());
    const mappingGroups: Record<string, string> = {
      goal: 'Goal',
      path: 'Path',
      teaching: 'Teaching',
      profile: 'Profile'
    };
    const emptyCapabilities = new Set<string>();
    for (const [capability, group] of Object.entries(mappingGroups)) {
      const ids = manifest
        .filter((entry) => entry.monitoringGroup === group && userListed.has(entry.id))
        .map((entry) => entry.id);
      if (ids.length === 0) emptyCapabilities.add(capability);
    }
    // manifest 里根本没有对应监控组的两类（routes/users.buildCapabilityAgentMap 显式置空）
    emptyCapabilities.add('tutoring');
    emptyCapabilities.add('tracking');

    // 前端「活动类型」下拉提供的值
    const optionsStart = source.indexOf('const CAPABILITY_OPTIONS = [');
    expect(optionsStart).toBeGreaterThan(-1);
    const optionsBlock = source.slice(optionsStart, source.indexOf('\n];', optionsStart));
    const offered = [...optionsBlock.matchAll(/value: '([^']*)'/g)]
      .map((match) => match[1])
      .filter(Boolean);

    // 专属空态文案字典（键是标识符，不带引号）
    const structuralBlock = objectBlock(source, 'const STRUCTURAL_EMPTY_CAPABILITIES: Record<string, string> = {');
    const structuralEntries = [...structuralBlock.matchAll(/(\w+):\s*'([^']*)'/g)]
      .map((match) => [match[1], match[2]] as [string, string]);

    const missing = offered
      .filter((capability) => emptyCapabilities.has(capability))
      .filter((capability) => {
        const text = structuralEntries.find(([key]) => key === capability)?.[1] ?? '';
        return !text.trim() || text.trim() === '暂无日志';
      });
    expect(missing).toEqual([]);
  });
});
