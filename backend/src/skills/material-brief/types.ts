/**
 * material-brief 类型定义（Document Summary Index 模式的每资料摘要节点）。
 *
 * brief 是「附加知识堆」的一次性结构化理解产物：持久化在资料记录上，
 * goal 对话（澄清全面 vs 重点）、path 生成（分段意图）处处复用；
 * 正文深内容由按章节取回机制解决，brief 不搬运大段原文。
 */

export interface MaterialBriefTocEntry {
  /** 章节标题（照抄原文，不改写）。 */
  title: string;
  /** 该章节一句话内容概括（≤40 字）。 */
  gist: string;
}

export interface MaterialBrief {
  /** 文档类型（课程标准/教材/讲义/规范/论文/笔记/报告…），无法判断为 null。 */
  docType: string | null;
  /** 一句话主题。 */
  subject: string | null;
  /** 目标读者/适用对象，无法判断为 null。 */
  audience: string | null;
  /** 全文浓缩概括（≤200 字，只基于正文）。 */
  overview: string | null;
  /** 目录（≤30 条，title 照抄原文）。 */
  toc: MaterialBriefTocEntry[];
  /** 核心概念/关键术语（≤10 个）。 */
  coreConcepts: string[];
  /** 天然学习切分维度（≤4 条，如「按五大领域」「按年龄段」）。 */
  naturalDivisions: string[];
}

export interface MaterialBriefRequest {
  /** 资料名（原始文件名）。 */
  name: string;
  /** 解析后的正文（超长由编排侧采样并附截断标记）。 */
  markdown: string;
}

export interface MaterialBriefResult {
  status: 'ok' | 'not_found';
  brief: MaterialBrief | null;
  notes: string[];
}
