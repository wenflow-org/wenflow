/**
 * 别名解析（逻辑名 → 具体部署）。
 *
 * 设计依据：doc/MODEL_GATEWAY_DESIGN.md §4.2 / §4.4
 * - 业务只认别名（chat / reasoning / light），绑定由模型层决定 → 「一处切模型」
 * - `requireThinking` 时按能力过滤（`require_parameters` 思路）：只选支持思考的成员；
 *   若没有成员支持，则降级为第一位成员并标记 `degraded`
 *   （请求侧由 thinking-policy 自动裁掉不支持的字段，不会发错参数）
 *
 * 纯函数，不访问 DB。
 */
import { getModelAliasMembers, getModelDefinition, isModelAlias } from '../../config/models.config';

export interface AliasSelection {
  alias: string;
  /** 选中的具体模型 id */
  model: string;
  /** 该别名的全部可用成员（声明顺序） */
  members: string[];
  /** 是否因能力不匹配而降级（true = 选中成员不满足 requireThinking） */
  degraded: boolean;
}

export interface SelectModelForAliasOptions {
  /** DB 覆盖：别名 → 模型 id 列表（platform_api_configs.chatModels 等） */
  overrides?: Record<string, string[] | null | undefined> | null;
  /** 本次请求是否必须支持思考 */
  requireThinking?: boolean;
}

/**
 * 把配置里的模型字符串解析为具体模型。
 * 非别名（具体模型 id / 未知值）返回 null，由调用方原样使用。
 */
export function selectModelForAlias(
  value: string,
  options: SelectModelForAliasOptions = {}
): AliasSelection | null {
  const alias = String(value || '').trim().toLowerCase();
  if (!alias || !isModelAlias(alias)) return null;

  const members = getModelAliasMembers(alias, options.overrides);
  if (!members.length) return null;

  if (options.requireThinking) {
    const capable = members.find((id) => getModelDefinition(id)?.supportsThinking);
    if (capable) return { alias, model: capable, members, degraded: false };
    return { alias, model: members[0], members, degraded: true };
  }

  return { alias, model: members[0], members, degraded: false };
}
