/**
 * Mermaid 语法预处理：给含括号的 flowchart 节点标签补引号。
 *
 * 模型常生成 `B[pd.read_excel(路径)<br/>header 填几]` 这类标签；括号在 Mermaid
 * 语法里是节点形状的一部分，未加引号会整张图解析失败（TeachingDiagram 只能降级
 * 成源码块）。只处理方括号节点、只给含括号且尚未加引号的标签补引号，不改其他语法。
 */
export function normalizeMermaidLabels(code: string): string {
  if (!code) return code;
  return code.replace(/\[([^\]\n]+)\]/g, (whole, rawLabel: string) => {
    const label = rawLabel.trim();
    if (!label || /^["'].*["']$/.test(label)) return whole;
    if (!/[()]/.test(label)) return whole;
    // 标签里的双引号用实体，避免提前闭合 Mermaid 的字符串
    return `["${label.replace(/"/g, '&quot;')}"]`;
  });
}
