/**
 * 「会带图」的技能清单（2026-10-18 #123）。
 *
 * 用途：管理端保存技能模型绑定时，若最终生效模型**未声明视觉能力**，给出可见提示——
 * 「配置侧"保存/运行能被拦下并给出明确提示"」中的保存面（运行面由网关硬闸门与
 * prompt-composer 的能力护栏覆盖，见 gateway/api-gateway/executor.assertVisionAllowed）。
 *
 * 不阻断保存：图片是**可选上下文**（课堂配图随历史回流），链路会自动降级为纯文本；
 * 这里只是把「配了但读不了图」提前说出来，不让它变成看不见的能力损失。
 * 运行时能力判定仍以模型注册表（llm-providers.json `vision: true`）为唯一事实源。
 */
import { supportsVision } from './models.config';

export const VISION_CONTEXT_SKILLS: ReadonlySet<string> = new Set([
  // 教师侧：课堂配图随教学历史回流（教师能引用只有图里才有的信息）
  'teaching-turn',
  // 学习者侧：可见上下文里的课堂配图进模拟器请求
  'virtual-learner-learn-turn-simulator',
  // 目标阶段对话当前无图，通道已通（如后续学习者上传参考图）
  'virtual-learner-goal-dialogue-simulator',
]);

export function skillCarriesVisionContext(skillId: string | null | undefined): boolean {
  return VISION_CONTEXT_SKILLS.has(String(skillId || '').trim());
}

/**
 * 保存技能模型绑定时的**可见提示**文案（2026-10-18 #123）：
 * 技能会带图而生效模型未声明 vision → 返回提示；否则 null。
 *
 * 为什么不在保存时硬拒：图片是可选上下文（配图随历史回流），链路会优雅降级为纯文本课堂；
 * 硬拒会挡住「故意不带图跑便宜模型」的合法配置。运行面由网关硬闸门兜底——任何真的带图的
 * 请求打到未声明模型都会被明确拒绝（MODEL_VISION_UNSUPPORTED）。
 */
export function buildVisionBindingWarning(skillId: string, effectiveModel: string | null): string | null {
  if (!skillCarriesVisionContext(skillId)) return null;
  if (!effectiveModel) return null;
  if (supportsVision(effectiveModel)) return null;
  return `技能「${skillId}」会随上下文携带课堂配图，但生效模型「${effectiveModel}」未声明视觉能力`
    + '（图片将被省略为纯文本）。如需模型读图：在 llm-providers.json 为该模型声明 "vision": true，'
    + `并用 npm run vision:probe -- --model=${effectiveModel} 实测把关。`;
}
