/**
 * 自然语言确认探测（2026-09-27 绕圈缺陷修复）。
 *
 * 背景：确认闸原先只认 UI 显式标志（confirmProposal），注释明说"不猜文本"——
 * 实测绕圈：proposing 阶段 AI 连续 5 轮重复"请在下面点一下确认"，用户回的快捷选项/
 * 打字文本「就按这个来，确认」永远推不动，confidence 卡 0.88 不动；补标志后 0.3s 完成。
 *
 * 分层事实：前端 useGoalLive.isProposalConfirmText 早有同款探测（真机 UI 键入确认能推进），
 * 本缺陷只发生在**不经前端辅助的 API 调用方**（驱动脚本、快捷选项直发文本、未来客户端）——
 * 故把防线补到服务边界，所有调用方同权。两边口径各自维护，改动时互相对一眼。
 *
 * 设计（精度优先——误确认 = 生成一条用户没要的路径，比不确认伤）：
 * - 只看**最后一个语义段**（按标点/换行切段，礼貌尾缀如"谢谢"跳过）——确认是"最后一句话"；
 *   「好，但预算改成每天1小时」这类尾缀带改需求的文本不会被误判成确认；
 * - 段必须是**纯确认短语**（白名单整段匹配，≤12 字），不是"包含确认二字"就算；
 * - 段内出现否决/犹豫/疑问词（不/别/还没/再/等/吗/?…）直接否掉。
 */
const CONFIRM_SEGMENT_MAX_CHARS = 12;

/** 纯确认短语白名单（整段匹配；归一化只去尾缀语气词/标点） */
const CONFIRM_SEGMENT_PATTERNS: RegExp[] = [
  /^(好|好的|好呀|好嘞|好啊|嗯+|哦了|行|行的|可以|可以呀|没问题|没毛病|同意|赞同|确认|确定|定了|就这么定了|ok|okay|yes)$/i,
  /^(就)?按?这(个|样)(来|定|办|执行|生成)?$/,
  /^(就这(样|么))(定|办|来|执行|生成)?$/,
  /^(就按)(这个|这些|当前)(来|办|执行|生成)?$/,
  /^(帮我|开始|去|直接|先)?生成(吧|路径|学习路径)?$/,
  /^(开始吧|走起|搞起|来吧|就这么着)$/,
];

/** 否决/犹豫/疑问词：段内出现任一即不算确认（"先不确认""再想想""可以吗"全挡） */
const CONFIRM_SEGMENT_BLOCKLIST = /(不|别|还没|尚未|没确|再|等下|等等|先不|慢点|以后|考虑|看看|吗|？|\?|啥|什么|哪|多少|什么时候|希望|想|要不再|对吧|是吧)/;

/** 礼貌尾缀：扫段时透明跳过（"生成吧。谢谢！"仍算确认）。注意不放"就这样（啦）"——那是确认语义，不是客套 */
const COURTESY_TAIL = /^(谢谢|感谢|辛苦了?|麻烦你?了?|多谢)$/;

function normalizeSegment(segment: string): string {
  return segment
    .replace(/[。.!！~～\s]+$/g, '')
    .replace(/(?:吧|了|呀|嘞|哈|啦)+$/g, '');
}

/**
 * 用户回复是否表达了「确认方案」。
 * 规则见文件头注释；返回 false 时调用方走原模型回合路径（行为零变化）。
 */
export function isProposalConfirmationText(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  if (!value || value.length > 120) return false;
  const segments = value
    .split(/[。.!！?？,，;；、\n\r]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return false;
  let index = segments.length - 1;
  while (index >= 0 && COURTESY_TAIL.test(segments[index])) index--;
  if (index < 0) return false;
  const segment = segments[index];
  if (segment.length > CONFIRM_SEGMENT_MAX_CHARS) return false;
  if (CONFIRM_SEGMENT_BLOCKLIST.test(segment)) return false;
  const normalized = normalizeSegment(segment);
  if (!normalized) return false;
  return CONFIRM_SEGMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * 显式拒绝探测（2026-10-08，架构审计/宽域 C 轨后补真人面守门）。
 *
 * 背景：R6 P1-12 给 VL 仿真协调器加了「显式拒绝不得代签」（shouldAutoConfirmGoalProposal
 * 三闸），但真人服务边界的 confirmProposal UI 标志仍可压过拒绝文本（C 轨探针 C 实锤：
 * 犹豫文本 + flag=true → 当轮生成路径）。UI 标志=确认按钮点击，是首选通道不假；
 * 但文本**明示拒绝**时点击不再代签——误确认=生成一条用户没要的路径，比不确认伤。
 *
 * 精度优先：只认「最后一个语义段是纯拒绝/犹豫短语」，与确认白名单同构（整段匹配、
 * ≤12 字、礼貌尾缀跳过）；否则按普通回复推进，模型自然接住犹豫。确认快捷按钮的
 * 自带文案（「确认生成…」）不含拒绝词，不受影响。
 */
const REFUSAL_SEGMENT_PATTERNS: RegExp[] = [
  /^(不|不用|不要|不行|不好|先不|先不用|先别|别|暂不|暂时不|还没|还没有|没想好|没准备好|我还没想好)$/,
  /^(再想想|再考虑|再看看|考虑一下|考虑下|想想|等等|等一下|等会儿|慢点|我想想|我再想想|我考虑一下|我再看看)$/,
  /^(换个|换一个|换下|换个方向|换个思路|重新|重新来|重新规划|重新想想|不对|不对吧|有问题|有疑问|我质疑)$/,
  /^(不要了|不确认|不生成|先不生成|先不确认|取消)$/,
  /^(有点犹豫|犹豫|犹豫一下|拿不定|拿不准|定不下来)$/,
];

/**
 * 用户回复是否**明示拒绝/犹豫**（与 isProposalConfirmationText 同构：只看最后一个语义段）。
 * 命中时即使带 confirmProposal 标志也不代签（调用方按普通回复处理）。
 */
export function isExplicitRefusalText(text: string | null | undefined): boolean {
  const value = String(text ?? '');
  if (!value || value.length > 120) return false;
  const segments = value
    .split(/[。.!！?？,，;；、\n\r]+/)
    .map((segment) => segment.trim())
    .filter(Boolean);
  if (!segments.length) return false;
  let index = segments.length - 1;
  while (index >= 0 && COURTESY_TAIL.test(segments[index])) index--;
  if (index < 0) return false;
  const segment = segments[index];
  if (segment.length > CONFIRM_SEGMENT_MAX_CHARS) return false;
  const normalized = normalizeSegment(segment);
  if (!normalized) return false;
  return REFUSAL_SEGMENT_PATTERNS.some((pattern) => pattern.test(normalized));
}
