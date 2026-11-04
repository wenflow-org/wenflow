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
 *   - 字典键与 Agent 下拉的 id 都必须是 manifest 已知 id 或 alias（防再挂废弃 id）。
 */
import fs from 'fs';
import path from 'path';

import { listAgentManifest } from '../../services/agent-manifest.service';

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
});
