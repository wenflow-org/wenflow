/**
 * Prompt Compiler — 重写 ## 输入说明 段
 * ============================================================
 * 输入: PromptBlock (section='input') + routing 表中标记为 input role 的字段列表
 * 输出: 新的块 body, 用 routing 表数据重写其中的 ```json``` 示例;
 *       保留段内所有 prose bullet 和 IN-XX 编号规则.
 *
 * 现状: 编排文件声明的 promptRole 全集（orchestration-file.ts PROMPT_ROLES，
 * 7 角色）均为输出侧角色，无 input-* 角色，路由数据从未出现输入侧字段；
 * 因此本函数恒为 no-op（保留入口仅为维持 compilePrompt 流程结构）。
 */

import type { PromptBlock } from '../prompt-schema';
import type { FieldRoutingRow } from '../field-dispatcher';

export interface RewriteInputResult {
  body: string;
  rewritten: boolean;
  fieldsApplied: number;
}

/**
 * 重写输入段
 *
 * @param block PromptBlock (section='input')
 * @param routings 该 agent 的全部 routing 行
 * @returns 新 body + 是否实际重写 + 应用的字段数
 */
export function rewriteInputSection(
  block: PromptBlock,
  _routings: FieldRoutingRow[]
): RewriteInputResult {
  // promptRole 词表无输入侧角色 → 输入行恒为空，恒 no-op（保留源 body）
  return { body: block.body, rewritten: false, fieldsApplied: 0 };
}
