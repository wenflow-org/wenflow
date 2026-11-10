/**
 * 设置页功能开关（2026-11-08 产品裁决）
 *
 * 模型接入是平台级配置（管理台「模型与接入」统一管），学员侧暂不开放：
 *   - 状态开关 / 「API 接入」卡（含左右两栏）整体隐藏
 *   - 「我的 MCP 工具」卡整体隐藏
 * 模板挂 v-if、onMounted 条件加载（隐藏期间不发 api-config / mcp 请求）。
 * 代码与流程（本批对齐管理台的「获取即保存 / 保存常驻禁用 / 收起态摘要」）全量保留，
 * 翻开对应开关即整块回来。两个开关独立——将来 MCP 可以单独先行放开。
 * 测试可 vi.mock 本模块把开关翻开，行为回归锁不因隐藏而失效。
 */
export const SHOW_CUSTOM_MODEL_API = false;
export const SHOW_MCP_TOOLS = false;
