/**
 * KC 稳定键命名空间（#94）。
 *
 * kcId 来自 `kcAnnotation`（路径内的 KC 局部序号），在同一路径内稳定、跨路径不唯一。
 * 计划侧（concept-graph 物化）与痕迹侧（memory-trace 写入）都必须按**同一个锚键**
 * 登记/解析，措辞漂移才不会分叉；因此把键的构造收在独立模块，避免任一侧各自拼串。
 *
 * 注意：路径前缀不可省——不同路径的 `kc-1a` 不是同一个 KC。
 */
export function kcAnchorKey(kcId: unknown, pathId?: string | null): string {
  const id = typeof kcId === 'string' ? kcId.trim() : '';
  if (!id) return '';
  const path = typeof pathId === 'string' ? pathId.trim() : '';
  return path ? `kc:${path}:${id}` : `kc:${id}`;
}
