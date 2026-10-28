/**
 * 资料需求来源域（public / private）判定。
 *
 * 背景（2026-10-28 Frontier R1/R2 实证）：goal 在 44–50% 的路径里声明 needsMaterial，
 * 但 F3 私有材料组 26 次联网尝试 0 成功——内部手册/私有协议/本公司字典本就不该走公网检索。
 * 该模块把「要不要联网」从提示词软约束变成确定性分流：
 *   - private → 跳过 material-collector，由 goal 请用户上传附件（或按“用户手上有原文”设计路径）；
 *   - public  → 照旧交给 material-collector 检索/抓取/抽取。
 *
 * 判定优先级：goal 显式给出的 origin（public/private）> 文本启发式 > 默认 public。
 * 默认 public 是保守选择：保留现有检索行为，不因漏标而少采。
 */
import type { MaterialNeed } from '../../skills/material-collector/types';

export type MaterialOrigin = 'public' | 'private';

/** 私有/内部资料的强信号（先于公开信号判断；“公司内部规范”应判 private）。 */
const PRIVATE_PATTERNS = [
  /内部/,
  /自研/,
  /自建/,
  /本公司/,
  /本院/,
  /本实验室/,
  /本厂/,
  /本团队/,
  /私有/,
  /内控/,
  /未刊稿/,
  /无外键/,
  /字典说明/,
  /红皮书/,
  /内部文档/,
  /内部规范/,
  /私有协议/,
  /内部手册/,
  /本公司数据/,
];

/** 公开权威资料的信号（仅在没有私有信号时生效）。 */
const PUBLIC_PATTERNS = [
  /法规/,
  /法律/,
  /条例/,
  /准则/,
  /标准/,
  /规范/,
  /指南/,
  /公告/,
  /白皮书/,
  /官方文档/,
  /规范/,
  /国标/,
  /ISO/,
  /IEC/,
  /\bW3C\b/,
  /\bRFC\b/,
  /\bAPI\b/,
  /\bSDK\b/,
  /specification/i,
  /release notes/i,
  /documentation/i,
];

function textOf(need: MaterialNeed | null | undefined): string {
  if (!need || typeof need !== 'object') return '';
  return [need.kind, need.title, need.why, need.publisher, need.version]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ');
}

/** goal 显式 origin 优先；否则按文本启发式；都无法判断时默认 public。 */
export function inferMaterialOrigin(need: MaterialNeed | null | undefined): MaterialOrigin {
  const explicit = String((need as any)?.origin || '').trim().toLowerCase();
  if (explicit === 'private') return 'private';
  if (explicit === 'public') return 'public';

  const text = textOf(need);
  if (!text) return 'public';
  if (PRIVATE_PATTERNS.some((pattern) => pattern.test(text))) return 'private';
  if (PUBLIC_PATTERNS.some((pattern) => pattern.test(text))) return 'public';
  return 'public';
}

export function partitionMaterialNeeds(needs: MaterialNeed[]): {
  publicNeeds: MaterialNeed[];
  privateNeeds: MaterialNeed[];
} {
  const publicNeeds: MaterialNeed[] = [];
  const privateNeeds: MaterialNeed[] = [];
  for (const need of needs) {
    if (inferMaterialOrigin(need) === 'private') privateNeeds.push(need);
    else publicNeeds.push(need);
  }
  return { publicNeeds, privateNeeds };
}
