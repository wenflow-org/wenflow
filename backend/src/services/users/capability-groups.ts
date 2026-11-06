/**
 * 「活动类型」（capabilityType）筛选的单一事实源。
 *
 * #218 复现的病灶：Profile 监控组十条 manifest 没有一条 userListed，而能力筛选此前是
 * 「监控组 ∩ userListed」派生 → map.profile 恒为空数组，用户在页面上选「学习者模型」
 * forever 看到空列表，而后端确实有该类调用日志（skill:learning-predictor /
 * skill:learner-state-review / skill:learner-progress-report 等，均由 executeSkill
 * 以 `skill:<id>` 写 agent_call_logs，与 manifest 的 Profile 组成员一一对应）。
 *
 * 修复后的口径（两条范围刻意分开）：
 *   - 不带 capabilityType（默认「AI 任务记录」）= manifest userListed 白名单，只放行
 *     用户发起的业务动作（见 routes/users.buildAgentLogWhere；#219 契约不变）；
 *   - 带 capabilityType = **显式的能力钻取**，取该能力在 manifest 里的全部成员
 *     （kind !== 'alias'），包含平台内部 skill。
 *
 * 为什么可以包含内部 skill：`system` 这个合法能力键早在 #229 就是同样的语义——
 * 它映射到 ['system-call', 'unknown']，这两个 id 本来就**不在** userListed 白名单里。
 * 也就是说「能力筛选 ⊆ 默认视图」从来不是本模块的约束（此前只在四个能力组上强行
 * 施加该约束，才把 profile 钉死成恒空）；显式选一个能力 = 明确要看这一类调用。
 * 前端「隐藏底层调用」开关管的是默认视图，不影响显式能力钻取。
 *
 * 与之配套：前端 AgentLogs.vue 的 mapping 必须覆盖四个能力组的全部 manifest id，
 * 否则服务端筛出的行会在客户端二次过滤里被丢掉（守卫见
 * routes/__tests__/users-agent-logs.capability-dict.test.ts）。
 */
import {
  listAgentManifest,
  type MonitoringGroupName,
} from '../agent-manifest.service';

/** capabilityType（前端「活动类型」筛选键）→ manifest 监控组 */
export const CAPABILITY_MONITORING_GROUPS: Record<string, MonitoringGroupName> = {
  goal: 'Goal',
  path: 'Path',
  teaching: 'Teaching',
  profile: 'Profile',
};

/**
 * 合法能力键 = manifest 派生的四个能力组 + 三个显式键（tutoring/tracking/system）。
 * 未知值（`x` / `tutoring2`）与大小写变体（`Teaching` / `PROFILE`）此前既不命中能力分支、
 * 又因是「真值」而跳过默认白名单，where 退化成 { userId }，等价于 includeSystem=true
 * 的全量日志（api-gateway 与内部 skill 全部漏出）。现在大小写变体归一后按合法键处理
 * （明确等价），其余未知值明确拒绝（400 VALIDATION_ERROR）并回列允许值。
 */
export const CAPABILITY_TYPES = [
  ...Object.keys(CAPABILITY_MONITORING_GROUPS),
  'tutoring',
  'tracking',
  'system',
];

// 用可选字段而非 `ok: true/false` 判别式联合：本仓库 strictNullChecks=false，
// 布尔字面量判别式在这套 tsconfig 下不做收窄（已用 tsc 验证），读 `message` 会编译报错。
export type CapabilityTypeParseResult = { capabilityType?: string; error?: string };

/**
 * 校验并归一化 capabilityType 查询参数。
 * - 未传 / 空串（含纯空白）= 不筛选，走默认 userListed 白名单（`capabilityType=` 与不传同义）；
 * - 大小写变体按小写归一后命中合法键（`Teaching` ≡ `teaching`，明确等价而非静默全量）；
 * - 其余（含非字符串，如重复参数成数组）= 未知值，返回可回给调用方的 400 消息。
 */
export function parseCapabilityTypeQuery(raw: unknown): CapabilityTypeParseResult {
  const allowed = CAPABILITY_TYPES.join('、');
  if (raw === undefined || raw === null) return { capabilityType: undefined };
  if (typeof raw !== 'string') {
    return { error: `capabilityType 只能是单个字符串。允许值：${allowed}` };
  }
  const normalized = raw.trim().toLowerCase();
  if (!normalized) return { capabilityType: undefined };
  if (!CAPABILITY_TYPES.includes(normalized)) {
    return { error: `capabilityType 无效：${raw}。允许值：${allowed}` };
  }
  return { capabilityType: normalized };
}

/** 某个监控组在 manifest 里的全部成员 id（不含 alias 节点）。 */
export function capabilityIdsOfGroup(group: MonitoringGroupName): string[] {
  return listAgentManifest()
    .filter((entry) => entry.monitoringGroup === group && entry.kind !== 'alias')
    .map((entry) => entry.id);
}

/** 监控组 → 能力键 的反查表（组名到能力键在此唯一，避免两处手写对应关系） */
const CAPABILITY_KEY_OF_GROUP: Record<string, string> = Object.fromEntries(
  Object.entries(CAPABILITY_MONITORING_GROUPS).map(([key, group]) => [group, key])
);

/**
 * capabilityType → agentId 集合。
 * 四个能力组 = manifest 监控组全量成员（profile 因此不再恒空，见文件头）；
 * tutoring / tracking 在 manifest 里没有对应监控组（没有辅导、进度追踪 Agent），
 * 显式保留空数组，维持「筛该项返回空」的行为——合法键必须映射到一个集合，
 * 若删掉键，合法请求会落到 `{ in: undefined }`（Prisma 报错）而不是「恒空但合法」。
 */
export function buildCapabilityAgentMap(): Record<string, string[]> {
  const map: Record<string, string[]> = {};
  for (const capabilityType of Object.keys(CAPABILITY_MONITORING_GROUPS)) {
    map[capabilityType] = [];
  }
  for (const entry of listAgentManifest()) {
    if (entry.kind === 'alias' || !entry.monitoringGroup) continue;
    const capabilityType = CAPABILITY_KEY_OF_GROUP[entry.monitoringGroup];
    if (capabilityType) map[capabilityType].push(entry.id);
  }
  map.tutoring = [];
  map.tracking = [];
  // 平台底层调用不是 manifest 里的 agent/skill（也就不在 userListed 白名单里），
  // 「系统底层调用」是刻意独立于默认视图的显式范围（同 includeSystem），保持原有口径
  map.system = ['system-call', 'unknown'];
  return map;
}
