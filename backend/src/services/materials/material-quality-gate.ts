/**
 * 资料质量闸门（入库前文档分流）。
 *
 * 为什么要它：生产入库闸门（ingestWebMaterial）只拒「切不出任何块」的正文。
 * 2026-10-18 用 46 份真实抓取实测：15 份垃圾（拦截页/乱码/纯导航/无字幕视频页/整本 PDF 转储）
 * **全部放行**，且它们贡献了资料库 65.3% 的块。
 *
 * 一次决策模型调用问三个问题，按**缺陷类型**分流而不是卡单一可用性阈值。
 * （2026-10-22 注释对齐：初版设想的「确定性规则层（长度/中文占比/控制字符/URL）」
 * 最终没有落在本文件——那套启发式活在评测脚本 eval-goal-material-gate.ts，作为
 * 评测参照标签；本文件只有空文本判断 + 决策模型，别按旧注释找不存在的代码。）
 *
 * 实测（同一批 46 份，以启发式标签为参照）：
 *   现状（只拒切不出块）        垃圾拦截 0/15，干净误杀 0/31
 *   usable < 0.5               垃圾拦截 8/15，干净误杀 0/31
 *   defect != ok               垃圾拦截 12/15，干净误杀 1/31（那份是 29k 字的权威指南，本就该限量收录）
 *
 * 策略（默认阈值可用 MATERIAL_GATE_* 覆盖）：
 *   defect ∈ {bot_wall, navigation_only, mojibake, video_page} → reject（不入库）
 *   defect = dump                                              → cap（入库但限量、标注「仅收录部分」）
 *   usable < 0.5                                               → reject
 *   topic_match < 0.3                                          → reject（版本错配 / 同名不同主题）
 *   其余                                                        → accept
 *
 * fail-open：未配置决策 provider、超时、异常都返回 null，调用方按「放行并发 note」处理，
 * 绝不因为闸门故障阻塞路径生成。MATERIAL_QUALITY_GATE_DISABLED=1 一键关闭。
 */

import { logger } from '../../utils/logger';
import { decide, isDecisionConfigured, isDecisionEnabled, type DecisionAnswer } from '../decision';

/** 与 eval-goal-material-gate.ts 的启发式分类保持同一套口径，便于对账。 */
export type MaterialDefect =
  | 'ok'
  | 'bot_wall'
  | 'navigation_only'
  | 'mojibake'
  | 'video_page'
  | 'dump';

export type MaterialGateAction = 'accept' | 'reject' | 'cap';

export interface MaterialGateVerdict {
  action: MaterialGateAction;
  usable: number | null;
  defect: MaterialDefect | null;
  topicMatch: number | null;
  /** 是否存在成段连续正文（0~1）；阿里云部署上这是比 usable 更有区分度的信号 */
  hasProse: number | null;
  reason: string;
  /** 命中该结论的 provider（alibaba / cloudflare / custom …），便于排障 */
  provider?: string;
}

export interface MaterialGateInput {
  /** 目标主题（人话，如「HTTP 缓存」） */
  topic: string;
  title: string;
  url: string;
  text: string;
}

const REJECT_DEFECTS: readonly MaterialDefect[] = ['bot_wall', 'navigation_only', 'mojibake', 'video_page'];
const DEFECT_CRITERIA: Record<string, string> = {
  ok: '成段的实质正文，学习者能正常阅读并获得知识',
  bot_wall: '机器人验证、访问拦截、要求开启 JavaScript 的中间页',
  navigation_only: '页面主体是导航、目录、页脚、版权声明、评论区或下载按钮，没有成段正文',
  mojibake: '编码损坏，中文显示为乱码或问号方块，无法阅读',
  video_page: '视频播放页，正文只有标题与简介，没有字幕或讲稿',
  dump: '整本标准/手册/PDF 转储，体量远超单份学习材料所需',
};

function num(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function threshold(name: string, fallback: number): number {
  return num(process.env[name], fallback);
}

export function isMaterialQualityGateEnabled(): boolean {
  // 单测默认不触网：jest 里 resolveDeps 会注入真实 gateMaterial，若 .env 配了决策 provider
  // 就会把假夹具送去真打上游。JEST_WORKER_ID 与 NODE_ENV 双保险——有套件会把 NODE_ENV 改成
  // production 后未还原（runInBand 共享进程），只判 NODE_ENV 会让后续套件误开闸门（实测
  // material-collector 三套件在全量跑时被真判上游、单跑却通过）。需要覆盖时设 MATERIAL_QUALITY_GATE_FORCE=1。
  const inTestRuntime = process.env.NODE_ENV === 'test' || Boolean(process.env.JEST_WORKER_ID);
  if (inTestRuntime && process.env.MATERIAL_QUALITY_GATE_FORCE !== '1') return false;
  return process.env.MATERIAL_QUALITY_GATE_DISABLED !== '1' && isDecisionEnabled() && isDecisionConfigured();
}

/** 首/中/尾采样：只看开头会把「27 万字转储」误判成正常文档。 */
export function sampleForGate(text: string, budget = 7000): string {
  if (text.length <= budget) return text;
  const headLen = Math.floor(budget * 0.4);
  const midLen = Math.floor(budget * 0.2);
  const tailLen = budget - headLen - midLen;
  const middleStart = Math.max(0, Math.floor(text.length / 2) - midLen);
  return [
    text.slice(0, headLen),
    '[…中间省略…]',
    text.slice(middleStart, middleStart + midLen),
    '[…尾部…]',
    text.slice(-tailLen),
  ].join('\n\n');
}

/**
 * 纯策略函数：把决策模型的答案映射成动作。抽出来是为了单测不触网。
 *
 * 顺序即优先级：缺陷类型 > 成段正文 > 可用性 > 主题一致性。
 * - 先判缺陷类型：整本转储（cap）与乱码/导航页（reject）处置不同，单看分数会把它们压在同一档；
 * - `has_prose` 排在 `usable` 前：实测（2026-10-18）阿里云的 usable 分数几乎恒定在 0.87~0.99，
 *   对垃圾页没有区分度；而「是否存在成段连续论述」这个更客观的问法能拦 13/15 垃圾、只误伤 3/31。
 */
export function classifyMaterialVerdict(
  answers: Record<string, DecisionAnswer> | null | undefined,
  options: { usableMin?: number; topicMin?: number; proseMin?: number } = {}
): Omit<MaterialGateVerdict, 'provider'> {
  const usable = typeof answers?.usable?.noul === 'number' ? answers.usable.noul : null;
  const defectRaw = answers?.defect?.choice;
  const defect = typeof defectRaw === 'string' && defectRaw in DEFECT_CRITERIA
    ? (defectRaw as MaterialDefect)
    : null;
  const topicMatch =
    typeof answers?.topic_match?.noul === 'number' ? answers.topic_match.noul : null;
  const hasProse = typeof answers?.has_prose?.noul === 'number' ? answers.has_prose.noul : null;

  const usableMin = options.usableMin ?? 0.5;
  const topicMin = options.topicMin ?? 0.3;
  const proseMin = options.proseMin ?? 0.5;
  const base = { usable, defect, topicMatch, hasProse };

  if (defect && REJECT_DEFECTS.includes(defect)) {
    return { ...base, action: 'reject', reason: `缺陷类型 ${defect}` };
  }
  if (defect === 'dump') {
    return { ...base, action: 'cap', reason: '超大体量文档，限量收录' };
  }
  if (hasProse !== null && hasProse < proseMin) {
    return { ...base, action: 'reject', reason: `无成段正文 ${hasProse.toFixed(2)} < ${proseMin}` };
  }
  if (usable !== null && usable < usableMin) {
    return { ...base, action: 'reject', reason: `可用性 ${usable.toFixed(2)} < ${usableMin}` };
  }
  if (topicMatch !== null && topicMatch < topicMin) {
    return { ...base, action: 'reject', reason: `主题一致性 ${topicMatch.toFixed(2)} < ${topicMin}` };
  }
  return { ...base, action: 'accept', reason: '通过' };
}

export async function gateMaterialDocument(
  input: MaterialGateInput,
  options: { timeoutMs?: number; signal?: AbortSignal } = {}
): Promise<MaterialGateVerdict | null> {
  if (!isMaterialQualityGateEnabled()) return null;
  const text = String(input?.text || '');
  if (!text.trim()) {
    return { action: 'reject', usable: null, defect: null, topicMatch: null, hasProse: null, reason: '正文为空' };
  }

  try {
    const response = await decide(
      {
        state: {
          目标主题: input.topic,
          页面标题: input.title,
          来源URL: input.url,
          正文节选: sampleForGate(text),
        },
        questions: {
          usable: {
            type: 'noul',
            instructions:
              '这份正文是否可以提供给学习者作为学习材料？拦截页、纯导航页、乱码、无字幕视频页、超大体量转储都给低概率；成段且可读的正文给高概率。',
          },
          defect: {
            type: 'choice',
            instructions: '这份正文最主要的缺陷类型是什么？',
            criteria: DEFECT_CRITERIA,
          },
          topic_match: {
            type: 'noul',
            instructions:
              '这份正文的内容是否与目标主题一致？同名文件的不同版本、主题相近但讲别的事都给低概率。',
          },
          has_prose: {
            type: 'noul',
            instructions:
              '这段正文里是否存在成段的连续论述（至少连续两三百字围绕同一主题展开，而不是导航项、短句堆叠、按钮文字、列表或评论区）？存在给高概率，只有碎片式页面元素给低概率。',
          },
        },
      },
      options
    );

    const verdict = classifyMaterialVerdict(response.answers, {
      usableMin: threshold('MATERIAL_GATE_USABLE_MIN', 0.5),
      topicMin: threshold('MATERIAL_GATE_TOPIC_MIN', 0.3),
      proseMin: threshold('MATERIAL_GATE_PROSE_MIN', 0.5),
    });
    return { ...verdict, provider: response.provider };
  } catch (error) {
    logger.warn('[material-quality-gate] 判定失败（fail-open，按放行处理）', {
      url: input?.url,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}
