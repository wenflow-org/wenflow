/* eslint-disable no-console -- 一次性评测 CLI：面向人读的输出，不需要 logger */
/**
 * laya（自建 SystemOne 兼容部署，经 new-api 暴露）**修正问法**重测脚本。
 *
 * 与 `eval-systemone-triage.ts`（v1）的关系：
 *  - 同一批 60 例、同一批输入字段（只给用户可见文本 visibleOpening / triggerEvent+domain / background）、
 *    同一套金标口径 —— 两者的数字可直接对比。
 *  - v1 的默认变体在本脚本里叫 `biased`，逐字复刻（nested criteria + 原指令 + 4 个问题），
 *    作为「上一轮基线」的复现锚点。
 *  - 新增 `neutral`（只把 block 指令去偏）、`flat`（criteria 改成文档要求的「选项名 -> 描述字符串」并写清边界）、
 *    `flat_other`（再加 `other` 逃生口）、`solo_block`（只问一个判断，测问题间干扰）。
 *
 * 为什么要重测（A-classic-usage.md 的对照）：
 *  1. 指令去偏：区分「模型不会判」与「我们的指令把它带偏了」。
 *  2. `answer_confidence = max(p)` 才是 Laya 的 abstention gate 用的量（`confidence` 是归一化熵，
 *     `x_jev_confidence` 是按 jev 公式重算的迁移字段，`action.act_probability` 官方说不可用于 gating）。
 *     本脚本把「弃权率 vs 接受样本准确率」曲线算出来，看它是否知道自己不确定。
 *  3. noul 没有 confidence 字段，只能逐标签扫阈值（脚本扫 0.3/0.5/0.7 等）。
 *  4. `usage.state_tokens` / `state_tokens_dropped` / `truncated` / `truncated_questions` 必须落盘核对：
 *     它区分「模型判不准」与「我们超长把它截断了」。
 *
 * 原始响应**全量落盘**（含 usage/routing/每个答案的概率分布），分析可离线重放：
 *   JSONL 路径见 `--out`，默认 doc/local/DECISION-MODEL-STUDY-2026-10-18/raw-f-laya/<variant>.jsonl
 *   重放分析（不发请求）：npx ts-node --transpile-only src/scripts/eval-systemone-triage-v2.ts --analyze
 *
 * ⚠️ 金标是生成虚拟学员案例时一并写出的（非真人标注）。度量的是「与案例生成器是否一致」，
 *    不是「是否正确」——这一条封死了结论强度。
 *
 * 用法：
 *   npx ts-node --transpile-only src/scripts/eval-systemone-triage-v2.ts --variant=biased --limit=8
 *   npx ts-node --transpile-only src/scripts/eval-systemone-triage-v2.ts --variant=flat
 *   npx ts-node --transpile-only src/scripts/eval-systemone-triage-v2.ts --analyze
 *
 * 环境变量（凭证不写进代码）：
 *   SYSTEMONE_BASE_URL  默认 http://101.43.146.102:30001/v1/systemone
 *   SYSTEMONE_MODEL     默认 jev-latest
 *   SYSTEMONE_API_KEY   默认 public（自建部署需要时用 backend/.env 的 EMBEDDING_API_KEY）
 *   SYSTEMONE_AUTH_STYLE 默认 bearer；`raw` = Authorization 直接放 key（阿里云 MaaS 决策端点要这个）
 *                       阿里云跑法见 doc/local/DECISION-MODEL-STUDY-2026-10-18/H-alibaba-triage.md
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { PRIMARY_BLOCK_TYPES, type PrimaryBlockType } from '../services/learning/response-triage';

const CASE_DIR = process.env.TRIAGE_CASE_DIR
  ? path.resolve(process.env.TRIAGE_CASE_DIR)
  : path.resolve(__dirname, '..', '..', '..', 'data', 'vl-persona-mixed-2026-09-21', 'cases');
const OUT_DIR = path.resolve(
  __dirname,
  '..',
  '..',
  '..',
  'doc',
  'local',
  'DECISION-MODEL-STUDY-2026-10-18',
  'raw-f-laya'
);
const BASE_URL = process.env.SYSTEMONE_BASE_URL || 'http://101.43.146.102:30001/v1/systemone';
const API_KEY = process.env.SYSTEMONE_API_KEY || 'public';
const MODEL = process.env.SYSTEMONE_MODEL || 'jev-latest';
/** 鉴权形态：bearer（默认，new-api 与 OpenCode Zen）；raw＝Authorization 直接放 key（阿里云 MaaS 决策端点）。 */
const AUTH_HEADER = process.env.SYSTEMONE_AUTH_STYLE === 'raw' ? API_KEY : `Bearer ${API_KEY}`;
/** 单次请求的重试次数（默认 2）。网关聚合了多个上游副本，个别副本会对模型名报 400，重试即可命中正常副本。 */
const RETRIES = Number(process.env.TRIAGE_RETRIES || '2');

const BLOCK_SET = new Set<string>(PRIMARY_BLOCK_TYPES);

// --------------------------------------------------------------------------
// 变体定义
// --------------------------------------------------------------------------

/** v1 的嵌套写法：{ 选项名: { description } }。这是「未按文档」的 criteria 形态。 */
const NESTED_BLOCK_CRITERIA: Record<PrimaryBlockType, { description: string }> = {
  capability: { description: '存在可迁移的概念/技能缺口，需要建认知结构 + 多步练习（换个场景还会再遇到）' },
  oneoff_operation: { description: '一次性具体操作或工具用法，学会点哪里即可' },
  environment_tooling: { description: '设备/软件/网络/配置/环境阻塞，修好系统即可' },
  permission_process: { description: '账号/权限/审批/流程/交接/他人配合阻塞' },
  emotion_relationship: { description: '情绪调节/恐惧/面子/焦虑/人际冲突是主要阻塞' },
};

/** 文档要求的写法：选项名 -> 描述字符串，描述写**边界**（区别于什么），不堆同义词。 */
const FLAT_BLOCK_CRITERIA: Record<string, string> = {
  capability:
    '可迁移的概念或技能缺口：换个场景/换个软件还会再遇到，需要建立新概念并多步练习（与之相对：只是一次性的按钮在哪）',
  oneoff_operation:
    '一次性的具体操作或工具用法：学会点哪里、走哪一步就够，不涉及新概念，也不会反复考（与之相对：后面还要反复用到的能力缺口）',
  environment_tooling:
    '设备/软件/网络/配置本身有问题：把系统修好就解决，与该学员会不会无关（与之相对：系统没坏，是人不会用）',
  permission_process:
    '账号/权限/审批/流程/交接/需要他人先行动：卡点在别人或制度上，学员自己再会也推不动',
  emotion_relationship:
    '情绪调节/恐惧/面子/焦虑/人际冲突本身是主要阻塞：卡点是不敢、难受、和别人闹僵，而不是不知道怎么做',
};

const BLOCK_INSTRUCTIONS: Record<string, string> = {  // v1 原文（含「字面在问操作、但背后是能力缺口时判 capability」——语料里学员大量自我归因，可能被放大）
  biased:
    '按根因判，不要按字面话题判。字面在问某个操作、但背后是反复遇到的能力缺口时判 capability；' +
    '只有在"别人不给权限/要走流程/需要他人配合"时才判 permission_process；' +
    '只有在"设备或软件环境坏了、修好就行"时才判 environment_tooling。',
  neutral: '判断这一困难真正的来源是根因，而不是学员自己把它归因成了什么。',
};

/**
 * 外部实践风格的判据：llama.cpp 官方决策模型示例（`billing: "payments, charges, refunds, invoices"`）
 * 与 OpenRouter 教程都只用三到五个词写**职责边界**，不写"与之相对：…"这类排他从句。
 * 对照用：我们的 FLAT 判据每条 60~90 字。
 */
const SHORT_BLOCK_CRITERIA: Record<string, string> = {
  capability: '可迁移的概念或技能缺口，换个场景还会再遇到',
  oneoff_operation: '一次性的按钮在哪、走哪一步，学会就够',
  environment_tooling: '设备、软件或网络本身坏，修好就解决',
  permission_process: '卡在账号、权限、审批，或需要别人先行动',
  emotion_relationship: '不敢、怕丢脸、难受，或和别人闹僵',
};

const RECURRENCE_CRITERIA_NESTED = {
  once: { description: '这件事只发生过一次，是孤立事件，处理掉就不会再遇到' },
  recurring: { description: '这件事反复发生、会再来（有"每次/又/还是/一直/反复"等线索，或情境本身就必然重复）' },
};
const RECURRENCE_CRITERIA_FLAT = {
  once: '这件事只发生过一次，是孤立事件，处理掉就不会再遇到',
  recurring: '这件事反复发生、会再来（有"每次/又/还是/一直/反复"等线索，或情境本身就必然重复）',
};
/** 所有变体共用，避免「复现问法」这个变量混进对比。 */
const RECURRENCE_INSTRUCTIONS = '注意有的情境天生会重复（每天都要做的事），即使原话没说"每次"。';

type QuestionId = 'block_type' | 'recurrence' | 'recurrence_noul' | 'freq_cue';

interface VariantSpec {
  label: string;
  note: string;
  blockInstruction: keyof typeof BLOCK_INSTRUCTIONS;
  criteriaStyle: 'nested' | 'flat';
  withOther: boolean;
  questions: QuestionId[];
  /** 把 5 分类改写成 5 个独立是非题（noul），答案离线取 argmax。用于检验「分类问法」本身是否是瓶颈。 */
  binaryBlock?: boolean;
  /** 一次只问一个问题、每个问题单独发一次请求（state 重复发送），答案合并成一条记录与整批对比。 */
  splitCalls?: boolean;
  /** 覆盖 block_type 的选项判据（五轮提示词迭代用）。 */
  criteriaOverride?: Record<string, string>;
  /** 覆盖 block_type 的 instructions（五轮提示词迭代用）。 */
  instructionOverride?: string;
  /** 按外部实践（llama.cpp 官方示例 / OpenRouter 教程）把判据压到三到五个词。 */
  shortCriteria?: boolean;
  /** 5 个独立 noul（每问带 {true,false} 两端判据），离线 argmax——OpenRouter 多标签配方。 */
  noulShort?: boolean;
  /** 选项顺序倒置（JevBench：小模型对选项顺序敏感，用作诊断）。 */
  criteriaOrder?: 'reversed' | 'rotated' | 'alpha';
}

const VARIANTS: Record<string, VariantSpec> = {
  biased: {
    label: 'v1 复刻：nested criteria + 原（偏 capability 的）指令 + 4 问',
    note: '上一轮的默认变体，作为基线复现锚点',
    blockInstruction: 'biased',
    criteriaStyle: 'nested',
    withOther: false,
    questions: ['block_type', 'recurrence', 'recurrence_noul', 'freq_cue'],
  },
  neutral: {
    label: 'nested criteria + 去偏指令 + 4 问',
    note: '只动指令，隔离「指令带偏」',
    blockInstruction: 'neutral',
    criteriaStyle: 'nested',
    withOther: false,
    questions: ['block_type', 'recurrence', 'recurrence_noul', 'freq_cue'],
  },
  flat: {
    label: 'flat criteria（写边界）+ 去偏指令 + 4 问',
    note: '按 A 文档第 3.2 节改成「选项名 -> 描述字符串」并写清与相邻类的区别',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type', 'recurrence', 'recurrence_noul', 'freq_cue'],
  },
  flat_other: {
    label: 'flat criteria + other 逃生口 + 去偏指令 + 4 问',
    note: '文档建议闭集可能落在集合外时加 other；这里用来测「被迫五选一」是不是误差来源',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: true,
    questions: ['block_type', 'recurrence', 'recurrence_noul', 'freq_cue'],
  },
  solo_block: {
    label: 'flat criteria + 去偏指令，只问 block_type 一问',
    note: '测问题间干扰（4 问共享 token 预算与 head），以及单点判断的上限',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
  },
  fiveNoul: {
    label: '把 5 分类拆成 5 个独立是非题（noul），离线取 argmax',
    note: '文档推荐「多选题逐标签单独 noul」；用来检验三次都差 10 个点的瓶颈是模型能力还是「让模型做选择题」这种问法本身',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: [],
    binaryBlock: true,
  },
  split4: {
    label: 'flat 四问，但 **每个问题单独发一次请求**（state 重复发送），最后合并',
    note: '对照 flat（四问一次发）：检验「一次多个问题」是否互相干扰、以及拆开的代价（state×4、请求数×4）',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type', 'recurrence', 'recurrence_noul', 'freq_cue'],
    splitCalls: true,
  },

  // ---- 五轮提示词迭代（2026-10-19）：只问 block_type，每轮只改判据/指令 ----
  p1: {
    label: '第1轮：给 capability↔emotion 写互补边界（不会 vs 不敢）',
    note: '针对上一轮最大混淆：capability 被判成 emotion（h2o 8/14、jev 也有同类）',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    criteriaOverride: {
      ...FLAT_BLOCK_CRITERIA,
      capability:
        '可迁移的概念或技能缺口：换个场景或换个软件还会再遇到，需要建立新概念并多步练习。' +
        '边界：学员想学、也不怕，只是不会——即使他说“怕弄坏”，只要主要卡点是不会，就判这一类。',
      emotion_relationship:
        '情绪调节/恐惧/面子/焦虑/人际冲突本身是主要阻塞。' +
        '边界：如果情绪来自“不会做”（怕出错、怕丢脸），先看是不是真的缺方法；' +
        '只有当学员其实会做、但不敢做/不想做/和别人闹僵时，才判这一类。',
    },
    instructionOverride:
      '判断这一困难真正的来源是根因，而不是学员自己把它归因成了什么。' +
      '重点区分“不会”与“不敢”：不会（缺方法、缺概念）→ capability；' +
      '不敢/难受/闹僵（其实会做）→ emotion_relationship。',
  },
  p2: {
    label: '第2轮：给其余三类写排他边界（不会再用到 / 修好不会用 / 知道流程不会操作）',
    note: '第1轮之后再看混淆，补齐 environment/oneoff/permission 的边界',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    criteriaOverride: {
      ...FLAT_BLOCK_CRITERIA,
      capability:
        '可迁移的概念或技能缺口：换个场景或换个软件还会再遇到，需要建立新概念并多步练习。' +
        '边界：学员想学、也不怕，只是不会——即使他说“怕弄坏”，只要主要卡点是不会，就判这一类。',
      emotion_relationship:
        '情绪调节/恐惧/面子/焦虑/人际冲突本身是主要阻塞。' +
        '边界：如果情绪来自“不会做”（怕出错、怕丢脸），先看是不是真的缺方法；' +
        '只有当学员其实会做、但不敢做/不想做/和别人闹僵时，才判这一类。',
      environment_tooling:
        '设备/软件/网络/配置本身有问题：把系统修好就解决。' +
        '边界：如果系统修好后学员还要学怎么用，说明根因是能力缺口（capability）；只有“修好就会用”才是这一类。',
      oneoff_operation:
        '一次性的具体操作或工具用法：学会点哪里、走哪一步就够。' +
        '边界：如果这个操作以后还要反复用到、或换个场景还会卡，属于 capability；只有“点一次就会、不会再考”才是这一类。',
      permission_process:
        '账号/权限/审批/流程/交接/需要他人先行动：卡点在别人或制度上。' +
        '边界：如果学员自己能操作、只是不知道该走哪一步，属于流程类；如果学员知道流程但不会操作，不属于这一类。',
    },
    instructionOverride:
      '按根因判，不按字面话题判。每类只在与其它四类的边界上判：' +
      '不会且会再遇到→capability；点一次就够→oneoff_operation；系统坏了→environment_tooling；' +
      '别人或制度挡着→permission_process；其实会做但不敢/难受/人际→emotion_relationship。',
  },
  p3: {
    label: '第3轮：判据回到基线，只把指令换成「命中即停」的顺序',
    note: '第1/2轮证明「在别的选项里反复提 capability」会把预测吸过去；这轮隔离出「顺序」这一个变量',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    instructionOverride:
      '按这个顺序判，命中即停：' +
      '① 卡点在别人或制度上（权限/审批/流程/需他人先动）→ permission_process；' +
      '② 卡点是设备/软件/网络/配置本身坏了（修好就解决）→ environment_tooling；' +
      '③ 卡点是情绪/恐惧/面子/人际本身（其实会做但不敢/不想）→ emotion_relationship；' +
      '④ 卡点是“点哪里/走哪步”的一次性操作（学会就不会再考）→ oneoff_operation；' +
      '⑤ 其余“换个场景还会再遇到、需要建立新概念或多步练习”→ capability。',
  },
  p4: {
    label: '第4轮：只换判据写法（名词短语+表征+反例），指令回到基线',
    note: '隔离「判据文本结构」这一个变量',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    criteriaOverride: {
      capability:
        '能力缺口（会反复遇到的概念或技能）。表征：换个场景或换个软件还会卡；需要先建立新概念，再练多步操作。',
      oneoff_operation:
        '一次性操作（学会点哪里就够）。表征：只需要照做一次；以后不会再考；不需要理解原理。',
      environment_tooling:
        '环境故障（设备/软件/网络/配置本身坏了）。表征：修好系统就恢复；与学员会不会无关。',
      permission_process:
        '外部卡点（账号/权限/审批/流程/他人配合）。表征：需要别人先行动或走制度流程；学员再会也推不动。',
      emotion_relationship:
        '情绪或关系卡点（恐惧/面子/焦虑/人际冲突是主因）。表征：其实会做，但不敢做、不想做或和别人闹僵；换个人来做就顺畅。',
    },
  },
  p5: {
    label: '第5轮：基线的判据 + 两轴指令（卡点在哪 / 会不会再遇到）+ 明确不采信自我归因',
    note: '把 R0 与 R1-R4 的证据合成：判据不动，指令按两条正交轴走，并显式排除「学员自己说的原因」',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    instructionOverride:
      '按两条轴判，不采信学员自己说的原因（他说年纪大、设备差、没天赋都不算判据）：' +
      '第一轴看卡点在哪里——别人或制度挡着→permission_process；设备/软件/网络本身坏了→environment_tooling；' +
      '其实会做，但不敢、难受或和人闹僵→emotion_relationship；' +
      '卡点在学员自己不会，进入第二轴——只是不知道点哪里、走哪步，学会就不会再考→oneoff_operation；' +
      '换个场景还会再遇到，需要建立新概念并多步练习→capability。',
  },

  // ---- 第二轮（按外部项目实践重写）：llama.cpp 官方示例 / OpenRouter 教程 / JevBench 的写法 ----
  q1: {
    label: 'q1：短判据（三到五个词）+ 纯问句指令（官方示例风格，无去偏句）',
    note: 'llama.cpp 官方决策模型示例与 OpenRouter 教程都用短关键词边界；这条同时去掉我们的去偏句',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    shortCriteria: true,
    instructionOverride: '这位学员的困难，根因属于哪一类？',
  },
  q2: {
    label: 'q2：短判据 + 保留去偏句（只换判据）',
    note: '隔离"判据长短"这一个变量（与 R0 的唯一差别）',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    shortCriteria: true,
  },
  q3: {
    label: 'q3：5 个独立 noul + {true,false} 两端判据（OpenRouter 多标签配方）',
    note: '官方文档的多标签写法：逐标签独立判断，离线 argmax；看它在五分类上是否优于 choice',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: [],
    noulShort: true,
  },
  q4: {
    label: 'q4：基线判据，选项顺序倒置（JevBench：小模型对选项顺序敏感）',
    note: '诊断项：顺序若显著影响结果，说明这套判据没被模型当作无序集合读',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    criteriaOrder: 'reversed',
  },
  q5: {
    label: 'q5：capability 从第一挪到最后（其余顺移）',
    note: '与 q4 配对：分离"capability 在首位"与"capability 在末位"两个假设',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    criteriaOrder: 'rotated',
  },
  q6: {
    label: 'q6：字母序排列（capability 仍在最前）',
    note: '对照：顺序变了但 capability 仍居首，用来判断是"位置"还是"整体排列"在起作用',
    blockInstruction: 'neutral',
    criteriaStyle: 'flat',
    withOther: false,
    questions: ['block_type'],
    criteriaOrder: 'alpha',
  },
};

function buildRequest(row: CaseRow, variant: VariantSpec) {
  const questions: Record<string, unknown> = {};
  const criteriaSource = variant.shortCriteria ? SHORT_BLOCK_CRITERIA : FLAT_BLOCK_CRITERIA;
  let blockCriteria: Record<string, unknown> = variant.criteriaOverride
    ? { ...variant.criteriaOverride }
    : variant.criteriaStyle === 'nested'
      ? { ...NESTED_BLOCK_CRITERIA }
      : { ...criteriaSource };
  if (variant.criteriaOrder) {
    const keys = Object.keys(blockCriteria);
    const order =
      variant.criteriaOrder === 'reversed'
        ? [...keys].reverse()
        : variant.criteriaOrder === 'rotated'
          ? [...keys.slice(1), keys[0]] // capability 从第一挪到最后，其余顺移
          : [...keys].sort();           // 字母序（capability 仍在最前，检验是不是"位置"本身在起作用）
    const reordered: Record<string, unknown> = {};
    for (const key of order) reordered[key] = blockCriteria[key];
    blockCriteria = reordered;
  }
  if (variant.withOther) blockCriteria.other = '其他：以上五类都明显不贴合';

  // 外部实践配方：5 个独立是非题，每问带 {true,false} 两端判据，离线 argmax（OpenRouter 多标签写法）。
  if (variant.noulShort) {
    for (const [cls, desc] of Object.entries(SHORT_BLOCK_CRITERIA)) {
      questions[`block_noul_${cls}`] = {
        type: 'noul',
        instructions: `这位学员的困难，根因是否属于「${cls}」这一类？`,
        criteria: { true: desc, false: '根因其实属于另一类，或明显不是这一类' },
      };
    }
  }

  if (variant.binaryBlock) {
    // 5 个独立是非题。⚠️ 实测：`question` 字段在这两条通道上被忽略（同 state 下换问题文本分数不变，
    // 改 instructions 才变），所以判据必须写进 instructions——问题文本一律不放，避免又一次「看着像测了」。
    for (const [cls, desc] of Object.entries(FLAT_BLOCK_CRITERIA)) {
      questions[`block_noul_${cls}`] = {
        type: 'noul',
        instructions:
          `这位学员陈述的困难，根因是否属于「${cls}」这一类？判据——${desc}。` +
          '符合这一类就给高概率；根因其实属于别的类就给低概率。只判这一类，不需要与其他类比较。',
      };
    }
  }

  if (variant.questions.includes('block_type')) {
    questions.block_type = {
      type: 'choice',
      question: '这位学员陈述的困难，根因属于哪一类？',
      criteria: blockCriteria,
      instructions: variant.instructionOverride ?? BLOCK_INSTRUCTIONS[variant.blockInstruction],
    };
  }
  if (variant.questions.includes('recurrence')) {
    questions.recurrence = {
      type: 'choice',
      question: '这个困难对这位学员来说是反复发生的，还是只此一次？',
      criteria: variant.criteriaStyle === 'nested' ? { ...RECURRENCE_CRITERIA_NESTED } : { ...RECURRENCE_CRITERIA_FLAT },
      instructions: RECURRENCE_INSTRUCTIONS,
    };
  }
  if (variant.questions.includes('recurrence_noul')) {
    questions.recurrence_noul = {
      type: 'noul',
      question: '这位学员的困难是否属于"反复发生、会再来"的情形？',
      instructions: '反复发生、会再来给高概率；孤立的一次性事件给低概率。',
    };
  }
  if (variant.questions.includes('freq_cue')) {
    questions.freq_cue = {
      type: 'noul',
      question: '原话里是否出现了明确的复现或频次措辞（例如 每次、又、还是、一直、老、反复、第几次、X 周了）？',
      instructions: '只要字面上有这类词就给高概率；纯叙述单次事件给低概率。',
    };
  }

  // 槽位是「一个 state × 若干并行问题」；问题 id 不下发模型，语义必须写进 question。
  return { state: { 学员原话: row.request, 情境: row.context, 背景: row.background }, questions };
}

// --------------------------------------------------------------------------
// 数据装载
// --------------------------------------------------------------------------

function arg(name: string, fallback: string): string {
  const hit = process.argv.find((item) => item.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
}
const hasFlag = (name: string) => process.argv.includes(`--${name}`);

interface CaseRow {
  file: string;
  name: string;
  request: string;
  context: string;
  background: string;
  labelBlock: string;
  labelRecurrence: string;
}

/** 与 eval-triage-judge.ts / v1 取同一批字段，保证可比。 */
function loadCases(limit: number): CaseRow[] {
  const files = fs.readdirSync(CASE_DIR).filter((f) => f.endsWith('.json')).sort();
  const rows: CaseRow[] = [];
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(path.join(CASE_DIR, file), 'utf-8'));
    const spec = raw.spec || {};
    const story = (raw.record || {}).story || {};
    rows.push({
      file,
      name: spec.name || file,
      request: String(story.visibleOpening || spec.goalHint || '').trim(),
      context: [story.triggerEvent, spec.domain].filter(Boolean).join(' / '),
      background: String(spec.background || '').trim(),
      labelBlock: String(story.primaryBlockType || '?'),
      labelRecurrence: String(story.recurrence || '?'),
    });
    if (rows.length >= limit) break;
  }
  return rows;
}

// --------------------------------------------------------------------------
// 调用与落盘
// --------------------------------------------------------------------------

interface RawRecord {
  variant: string;
  index: number;
  replay: number;
  case: string;
  file: string;
  ts: string;
  gold: { block: string; recurrence: string };
  ms: number;
  attempts: number;
  httpStatus: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 原始响应体原样落盘，供离线复盘
  response: any | null;
  error: string | null;
}

/** 每变体一个 JSONL，按行追加；单行写入即完整记录，便于并发下也能断点续跑。 */
function appendRecord(outFile: string, record: RawRecord): void {
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.appendFileSync(outFile, `${JSON.stringify(record)}\n`, 'utf-8');
}

interface CallOutcome {
  httpStatus: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- 同上
  response: any | null;
  error: string | null;
  attempts: number;
  ms: number;
}

async function callSystemOne(body: unknown, retries = RETRIES): Promise<CallOutcome> {
  const started = Date.now();
  let attempts = 0;
  let lastError = '';
  let lastStatus: number | null = null;
  while (attempts <= retries) {
    attempts += 1;
    try {
      const res = await fetch(BASE_URL, {
        method: 'POST',
        headers: { Authorization: AUTH_HEADER, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: MODEL, ...(body as object) }),
        signal: AbortSignal.timeout(60_000),
      });
      const text = await res.text();
      lastStatus = res.status;
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${text.slice(0, 180)}`;
      } else {
        return { httpStatus: res.status, response: JSON.parse(text), error: null, attempts, ms: Date.now() - started };
      }
    } catch (error) {
      lastError = String((error as Error)?.message || error).slice(0, 200);
    }
    if (attempts <= retries) await sleep(1500);
  }
  return { httpStatus: lastStatus, response: null, error: lastError, attempts, ms: Date.now() - started };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** 并发上限 + 请求起始最小间隔，既压住总时长也不至于把免费/自建通道打崩。 */
async function runPool<T>(items: T[], concurrency: number, gapMs: number, worker: (item: T, i: number) => Promise<void>) {
  let next = 0;
  let lastStart = 0;
  const lanes = Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, async () => {
    for (;;) {
      const i = next;
      next += 1;
      if (i >= items.length) return;
      const wait = lastStart + gapMs - Date.now();
      if (wait > 0) await sleep(wait);
      lastStart = Date.now();
      await worker(items[i], i);
    }
  });
  await Promise.all(lanes);
}

function pct(n: number, d: number): string {
  return d === 0 ? 'n/a' : `${((100 * n) / d).toFixed(0)}%`;
}
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

// --------------------------------------------------------------------------
// 离线分析（读 JSONL 重放，不再发请求）
// --------------------------------------------------------------------------

interface Row {
  case: string;
  goldBlock: string;
  predBlock: string;
  blockConf: number; // answer_confidence = max(p)
  entropyConf: number; // confidence = 归一化熵
  xJev: number | null;
  actProb: number | null;
  probs: Record<string, number>;
  goldOnce: boolean | null;
  predOnceChoice: boolean | null;
  noulRecurring: number | null;
  noulAnswerConf: number | null;
  freqCue: number | null;
  stateTokens: number | null;
  stateTokensDropped: number | null;
  truncated: boolean | null;
  truncatedQuestions: string[] | null;
  inputTokens: number | null;
  routingModel: string | null;
  routingRepo: string | null;
  ms: number;
  answerKeys: string[];
}

/**
 * 闸门用的置信度 = max(p)。各通道字段名不统一：laya/jev 给 `answer_confidence`（文档定义即 max(p)），
 * 阿里云只给 `confidence`。`probabilities` 是所有 choice 通道都带的，所以优先从它取，
 * 免得把某个通道的归一化熵字段（laya 的 `confidence`）误当闸门量。
 */
function gateConfidence(answer: {
  answer_confidence?: unknown;
  confidence?: unknown;
  probabilities?: Record<string, unknown>;
}): number {
  const values = Object.values(answer.probabilities || {})
    .map(Number)
    .filter((v) => Number.isFinite(v));
  if (values.length) return Math.max(...values);
  const fromNamed = Number(answer.answer_confidence ?? answer.confidence);
  return Number.isFinite(fromNamed) ? fromNamed : NaN;
}

function toRow(rec: RawRecord): Row | null {
  const res = rec.response;
  if (!res) return null;
  const a = res.answers || {};
  const block = a.block_type || {};
  const rec_ = a.recurrence || {};
  const noul = a.recurrence_noul || {};
  const cue = a.freq_cue || {};
  const usage = res.usage || {};
  return {
    case: rec.case,
    goldBlock: rec.gold.block,
    predBlock: String(block.choice ?? 'MISSING'),
    blockConf: gateConfidence(block),
    entropyConf: Number(block.confidence ?? NaN),
    xJev: block.x_jev_confidence === undefined ? null : Number(block.x_jev_confidence),
    actProb: block.action?.act_probability === undefined ? null : Number(block.action.act_probability),
    probs: block.probabilities || {},
    goldOnce: rec.gold.recurrence === '' ? null : rec.gold.recurrence === 'once',
    predOnceChoice: rec_.choice === undefined ? null : rec_.choice === 'once',
    noulRecurring: noul.noul === undefined ? null : Number(noul.noul),
    noulAnswerConf: noul.answer_confidence === undefined ? null : Number(noul.answer_confidence),
    freqCue: cue.noul === undefined ? null : Number(cue.noul),
    stateTokens: usage.state_tokens === undefined ? null : Number(usage.state_tokens),
    stateTokensDropped: usage.state_tokens_dropped === undefined ? null : Number(usage.state_tokens_dropped),
    truncated: usage.truncated === undefined ? null : Boolean(usage.truncated),
    truncatedQuestions: usage.truncated_questions ?? null,
    inputTokens: usage.input_tokens === undefined ? null : Number(usage.input_tokens),
    routingModel: res.routing?.model ?? null,
    routingRepo: res.routing?.repo ?? null,
    ms: rec.ms,
    answerKeys: Object.keys(a),
  };
}

function blockStats(rows: Row[]) {
  const n = rows.length;
  const hit = rows.filter((r) => r.goldBlock === r.predBlock).length;
  const goldCounts = new Map<string, number>();
  for (const r of rows) goldCounts.set(r.goldBlock, (goldCounts.get(r.goldBlock) ?? 0) + 1);
  const majority = Math.max(0, ...goldCounts.values());
  const confs = rows.map((r) => r.blockConf).filter((v) => Number.isFinite(v));
  const entropyConfs = rows.map((r) => r.entropyConf).filter((v) => Number.isFinite(v));
  // 置信度对「答对/答错」的排序能力（1 = 完美排序，0.5 = 无区分度）。这是弃权闸门的前提。
  const correctScores = rows.filter((r) => r.goldBlock === r.predBlock).map((r) => r.blockConf).filter(Number.isFinite);
  const wrongScores = rows.filter((r) => r.goldBlock !== r.predBlock).map((r) => r.blockConf).filter(Number.isFinite);
  let aucPairs = 0;
  let aucHits = 0;
  for (const c of correctScores) {
    for (const w of wrongScores) {
      aucPairs += 1;
      if (c > w) aucHits += 1;
      else if (c === w) aucHits += 0.5;
    }
  }
  const correctConf = rows.filter((r) => r.goldBlock === r.predBlock).map((r) => r.blockConf);
  const wrongConf = rows.filter((r) => r.goldBlock !== r.predBlock).map((r) => r.blockConf);
  const confusion: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const gold = BLOCK_SET.has(r.goldBlock) ? r.goldBlock : '?';
    const pred = BLOCK_SET.has(r.predBlock) ? r.predBlock : 'other';
    confusion[gold] = confusion[gold] || {};
    confusion[gold][pred] = (confusion[gold][pred] ?? 0) + 1;
  }
  return {
    n,
    accuracy: hit / n,
    majority: majority / n,
    meanAnswerConfidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : null,
    // v1 脚本打印的「平均自陈置信度」用的是这个字段（归一化熵），不是 answer_confidence
    meanEntropyConfidence: entropyConfs.length ? entropyConfs.reduce((a, b) => a + b, 0) / entropyConfs.length : null,
    meanConfidenceCorrect: correctConf.length ? correctConf.reduce((a, b) => a + b, 0) / correctConf.length : null,
    meanConfidenceWrong: wrongConf.length ? wrongConf.reduce((a, b) => a + b, 0) / wrongConf.length : null,
    aucConfidenceForCorrect: aucPairs ? aucHits / aucPairs : null,
    perClass: PRIMARY_BLOCK_TYPES.map((label) => {
      const goldN = rows.filter((r) => r.goldBlock === label).length;
      const tp = rows.filter((r) => r.goldBlock === label && r.predBlock === label).length;
      const predN = rows.filter((r) => r.predBlock === label).length;
      return { label, goldN, tp, recall: goldN ? tp / goldN : null, precision: predN ? tp / predN : null, predN };
    }),
    confusion,
    predDistribution: Object.fromEntries(
      [...PRIMARY_BLOCK_TYPES, 'other', 'MISSING'].map((l) => [l, rows.filter((r) => r.predBlock === l).length])
    ),
  };
}

/** 「弃权率 vs 接受样本准确率」曲线：accept = answer_confidence >= t。 */
function abstainCurve(rows: Row[], thresholds: number[]) {
  return thresholds.map((t) => {
    const accepted = rows.filter((r) => Number.isFinite(r.blockConf) && r.blockConf >= t);
    const hit = accepted.filter((r) => r.goldBlock === r.predBlock).length;
    return {
      t,
      coverage: accepted.length / rows.length,
      abstain: 1 - accepted.length / rows.length,
      acceptedN: accepted.length,
      acceptedAccuracy: accepted.length ? hit / accepted.length : null,
      acceptedMajBaseline: accepted.length
        ? Math.max(0, ...["capability", "oneoff_operation", "environment_tooling", "permission_process", "emotion_relationship"].map((l) => accepted.filter((r) => r.goldBlock === l).length)) /
          accepted.length
        : null,
    };
  });
}

/** 置信度分桶：看「知道自己不确定」是否成立。 */
function confidenceBuckets(rows: Row[], edges: number[]) {
  const buckets: Array<{ range: string; n: number; accuracy: number | null; majBaseline: number | null; meanConf: number | null }> = [];
  for (let i = 0; i < edges.length - 1; i += 1) {
    const lo = edges[i];
    const hi = edges[i + 1];
    const inside = rows.filter((r) => Number.isFinite(r.blockConf) && r.blockConf >= lo && r.blockConf < hi);
    const hit = inside.filter((r) => r.goldBlock === r.predBlock).length;
    const golds = new Map<string, number>();
    for (const r of inside) golds.set(r.goldBlock, (golds.get(r.goldBlock) ?? 0) + 1);
    buckets.push({
      range: `[${lo},${hi})`,
      n: inside.length,
      accuracy: inside.length ? hit / inside.length : null,
      majBaseline: inside.length ? Math.max(0, ...golds.values()) / inside.length : null,
      meanConf: inside.length ? inside.reduce((a, r) => a + r.blockConf, 0) / inside.length : null,
    });
  }
  return buckets;
}

function onceMetrics(rows: Row[], predictOnce: (r: Row) => boolean | null) {
  const usable = rows.filter((r) => r.goldOnce !== null);
  const goldOnceN = usable.filter((r) => r.goldOnce).length;
  const goldRecurringN = usable.length - goldOnceN;
  const decided = usable.filter((r) => predictOnce(r) !== null);
  const predOnceN = decided.filter((r) => predictOnce(r) === true).length;
  const hit = decided.filter((r) => predictOnce(r) === r.goldOnce).length;
  const tp = decided.filter((r) => r.goldOnce === true && predictOnce(r) === true).length;
  return {
    decidedN: decided.length,
    accuracy: decided.length ? hit / decided.length : null,
    majorityBaseline: decided.length ? goldRecurringN / decided.length : null,
    predOnceN,
    onceRecall: goldOnceN ? tp / goldOnceN : null,
    oncePrecision: predOnceN ? tp / predOnceN : null,
  };
}

function noulSweep(rows: Row[], pick: (r: Row) => number | null, thresholds: number[]) {
  return thresholds.map((t) => ({
    threshold: t,
    ...onceMetrics(rows, (r) => {
      const v = pick(r);
      return v === null ? null : v < t;
    }),
  }));
}

function truncationStats(rows: Row[]) {
  const states = rows.map((r) => r.stateTokens).filter((v): v is number => v !== null);
  const dropped = rows.map((r) => r.stateTokensDropped).filter((v): v is number => v !== null);
  const truncatedRows = rows.filter((r) => r.truncated === true);
  const missing = rows.filter((r) => r.stateTokens === null).length;
  return {
    fieldPresent: missing === 0,
    stateTokensMax: states.length ? Math.max(...states) : null,
    stateTokensMean: states.length ? states.reduce((a, b) => a + b, 0) / states.length : null,
    droppedMax: dropped.length ? Math.max(...dropped) : null,
    truncatedCount: truncatedRows.length,
    truncatedCases: truncatedRows.map((r) => ({ case: r.case, dropped: r.stateTokensDropped, q: r.truncatedQuestions })),
  };
}

/** 同一请求重复调用的一致性：choice 是否翻转、answer_confidence 波动多大（决定阈值能不能用）。 */
function repeatability(records: RawRecord[]) {
  const byCase = new Map<string, RawRecord[]>();
  for (const rec of records) {
    if (!rec.response) continue;
    const list = byCase.get(rec.case) ?? [];
    list.push(rec);
    byCase.set(rec.case, list);
  }
  const repeated = [...byCase.entries()].filter(([, list]) => list.length > 1);
  if (repeated.length === 0) return null;
  let blockFlips = 0;
  let recFlips = 0;
  const spreads: number[] = [];
  const details: Array<{ case: string; blocks: string; confs: string; spread: number }> = [];
  for (const [name, list] of repeated) {
    list.sort((a, b) => a.replay - b.replay);
    const blocks = list.map((r) => String(r.response?.answers?.block_type?.choice ?? 'MISSING'));
    const recs = list.map((r) => String(r.response?.answers?.recurrence?.choice ?? 'MISSING'));
    const confs = list
      .map((r) => gateConfidence(r.response?.answers?.block_type ?? {}))
      .filter((v) => Number.isFinite(v));
    const spread = confs.length > 1 ? Math.max(...confs) - Math.min(...confs) : 0;
    if (new Set(blocks).size > 1) blockFlips += 1;
    if (new Set(recs).size > 1) recFlips += 1;
    spreads.push(spread);
    details.push({ case: name, blocks: blocks.join('|'), confs: confs.map((c) => c.toFixed(2)).join('|'), spread: Number(spread.toFixed(3)) });
  }
  return {
    cases: repeated.length,
    replays: repeated[0][1].length,
    blockFlipRate: blockFlips / repeated.length,
    recurrenceFlipRate: recFlips / repeated.length,
    meanConfSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
    maxConfSpread: Math.max(...spreads),
    details,
  };
}

function fmt(x: number | null, digits = 2): string {
  return x === null || !Number.isFinite(x) ? 'n/a' : x.toFixed(digits);
}

function analyzeVariant(variant: string, records: RawRecord[], spec: VariantSpec | undefined) {
  const ok = records.filter((r) => r.response);
  const failures = records.filter((r) => !r.response);
  const rows = ok.map(toRow).filter((r): r is Row => r !== null);
  const bs = blockStats(rows);
  const latencies = rows.map((r) => r.ms);
  const hasRecurrence = rows.some((r) => r.predOnceChoice !== null);
  const hasNoul = rows.some((r) => r.noulRecurring !== null);
  const hasCue = rows.some((r) => r.freqCue !== null);

  console.log(`\n${'='.repeat(96)}`);
  console.log(`变体 ${variant} —— ${spec?.label ?? '(未注册变体)'}`);
  if (spec?.note) console.log(`  设计意图：${spec.note}`);
  console.log(
    `  成功 ${rows.length}/${records.length}（失败 ${failures.length}）| 延迟 p50 ${percentile(latencies, 50)}ms ` +
      `p90 ${percentile(latencies, 90)}ms max ${latencies.length ? Math.max(...latencies) : 0}ms | ` +
      `input_tokens 每例 ${fmt(rows.reduce((a, r) => a + (r.inputTokens ?? 0), 0) / Math.max(1, rows.length), 0)}`
  );

  console.log(`\n[primary_block_type] 准确率 ${bs.accuracy === null ? 'n/a' : fmt(bs.accuracy)} (${bs.perClass.reduce((a, c) => a + c.tp, 0)}/${bs.n})` +
    ` | 多数类基线（全判 emotion_relationship）${fmt(bs.majority)}`);
  console.log(
    `  平均 answer_confidence=${fmt(bs.meanAnswerConfidence, 3)}（gate 用）| 归一化熵 confidence=${fmt(bs.meanEntropyConfidence, 3)}（v1 打印的那个）| ` +
      `答对时 ${fmt(bs.meanConfidenceCorrect)} vs 答错时 ${fmt(bs.meanConfidenceWrong)} | ` +
      `confidence 对「答对」的 AUC=${fmt(bs.aucConfidenceForCorrect, 3)}（0.5=无区分度）`
  );
  console.log(`  预测分布 ${JSON.stringify(bs.predDistribution)}`);
  console.table(
    PRIMARY_BLOCK_TYPES.map((label) => {
      const c = bs.perClass.find((x) => x.label === label)!;
      return { 类别: label, 金标数: c.goldN, 判出数: c.predN, 正确: c.tp, 召回: pct(c.tp, c.goldN), 精确: pct(c.tp, c.predN) };
    })
  );
  console.log('  混淆矩阵（行=金标，列=模型）');
  console.table(
    Object.fromEntries(
      Object.entries(bs.confusion).map(([gold, line]) => [
        gold,
        Object.fromEntries(['capability', 'oneoff_operation', 'environment_tooling', 'permission_process', 'emotion_relationship', 'other'].map((p) => [p, line[p] ?? 0])),
      ])
    )
  );

  console.log('\n[弃权曲线] accept = block_type 的闸门置信度 max(p) >= t（各通道字段名不同，统一取 max(probabilities)）');
  console.table(
    abstainCurve(rows, [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]).map((c) => ({
      '阈值t': c.t,
      '自动通过率': pct(c.acceptedN, rows.length),
      '自动通过例数': c.acceptedN,
      '弃权率': pct(rows.length - c.acceptedN, rows.length),
      '接受样本准确率': c.acceptedAccuracy === null ? 'n/a' : pct(Math.round((c.acceptedAccuracy ?? 0) * c.acceptedN), c.acceptedN),
      '接受子集多数类': c.acceptedMajBaseline === null ? 'n/a' : pct(Math.round((c.acceptedMajBaseline ?? 0) * c.acceptedN), c.acceptedN),
    }))
  );
  console.log('  置信度分桶（准确率 vs 同桶多数类，看置信度是否只是复读类先验）');
  console.table(
    confidenceBuckets(rows, [0, 0.2, 0.3, 0.4, 0.5, 0.7, 1.0001]).map((b) => ({
      区间: b.range,
      例数: b.n,
      准确率: b.accuracy === null ? 'n/a' : pct(Math.round(b.accuracy * b.n), b.n),
      同桶多数类: b.majBaseline === null ? 'n/a' : pct(Math.round(b.majBaseline * b.n), b.n),
      平均conf: fmt(b.meanConf),
    }))
  );
  console.log(
    '  最高置信前 20 / 中 20 / 后 20 的准确率：' +
      [[0, 20], [20, 40], [40, 60]]
        .map(([lo, hi]) => {
          const sorted = [...rows].sort((a, b) => b.blockConf - a.blockConf).slice(lo, hi);
          const hit = sorted.filter((r) => r.goldBlock === r.predBlock).length;
          return `${pct(hit, sorted.length)}`;
        })
        .join(' / ')
  );

  if (hasRecurrence) {
    const base = onceMetrics(rows, (r) => r.predOnceChoice);
    console.log('\n[recurrence] 金标 once ' + rows.filter((r) => r.goldOnce).length + ' / recurring ' + rows.filter((r) => !r.goldOnce).length);
    console.table([
      { 判据: '多数类（全判 recurring）', 准确率: fmt(base.majorityBaseline), once召回: '0%', once精确: 'n/a', 判出once: 0 },
      {
        判据: 'choice（recurrence）',
        准确率: base.accuracy === null ? 'n/a' : pct(Math.round(base.accuracy * base.decidedN), base.decidedN),
        once召回: pct(Math.round((base.onceRecall ?? 0) * rows.filter((r) => r.goldOnce).length), rows.filter((r) => r.goldOnce).length),
        once精确: pct(Math.round((base.oncePrecision ?? 0) * base.predOnceN), base.predOnceN),
        判出once: base.predOnceN,
      },
    ]);
  }
  if (hasNoul) {
    console.log('\n[recurrence_noul 阈值扫描] 判 once ⟺ noul < t（noul = P(recurring)，0.5 = 等概率）');
    console.table(
      noulSweep(rows, (r) => r.noulRecurring, [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]).map((s) => ({
        阈值t: s.threshold,
        准确率: s.accuracy === null ? 'n/a' : pct(Math.round(s.accuracy * s.decidedN), s.decidedN),
        once召回: s.onceRecall === null ? 'n/a' : pct(Math.round(s.onceRecall * rows.filter((r) => r.goldOnce).length), rows.filter((r) => r.goldOnce).length),
        once精确: s.oncePrecision === null ? 'n/a' : pct(Math.round(s.oncePrecision * s.predOnceN), s.predOnceN),
        判出once: s.predOnceN,
        多数类基线: fmt(s.majorityBaseline),
      }))
    );
  }
  if (hasCue) {
    console.log('\n[freq_cue 阈值扫描]（仅表面措辞，作为对照）');
    console.table(
      noulSweep(rows, (r) => r.freqCue, [0.3, 0.5, 0.7]).map((s) => ({
        阈值t: s.threshold,
        准确率: s.accuracy === null ? 'n/a' : pct(Math.round(s.accuracy * s.decidedN), s.decidedN),
        once召回: s.onceRecall === null ? 'n/a' : pct(Math.round(s.onceRecall * rows.filter((r) => r.goldOnce).length), rows.filter((r) => r.goldOnce).length),
        once精确: s.oncePrecision === null ? 'n/a' : pct(Math.round(s.oncePrecision * s.predOnceN), s.predOnceN),
        判出once: s.predOnceN,
      }))
    );
  }

  const tr = truncationStats(rows);
  console.log('\n[截断核对] usage.state_tokens / state_tokens_dropped / truncated / truncated_questions');
  console.log(
    `  字段存在=${tr.fieldPresent} | state_tokens max ${tr.stateTokensMax} / mean ${fmt(tr.stateTokensMean, 0)} | ` +
      `dropped max ${tr.droppedMax} | truncated=true ${tr.truncatedCount} 例`
  );
  if (tr.truncatedCases.length) console.log(`  被截断的例：${JSON.stringify(tr.truncatedCases)}`);
  console.log(
    `  实测路由：routing.model=${rows[0]?.routingModel} repo=${rows[0]?.routingRepo} | 答案键 ${JSON.stringify(rows[0]?.answerKeys)}`
  );

  const rep = repeatability(records);
  if (rep) {
    console.log(
      `\n[同请求重复性] ${rep.cases} 例 × ${rep.replays} 次：block_type 选择翻转率 ` +
        `${pct(Math.round(rep.blockFlipRate * rep.cases), rep.cases)} | recurrence 翻转率 ` +
        `${pct(Math.round(rep.recurrenceFlipRate * rep.cases), rep.cases)} | answer_confidence 组内极差 均值 ${fmt(rep.meanConfSpread, 3)} 最大 ${fmt(rep.maxConfSpread, 3)}`
    );
    console.table(rep.details.slice(0, 15));
  }
  if (rows[0] && Number.isFinite(rows[0].xJev)) {
    const xj = rows.map((r) => r.xJev).filter((v): v is number => v !== null);
    const ap = rows.map((r) => r.actProb).filter((v): v is number => v !== null);
    console.log(
      `  旁证：x_jev_confidence 均值 ${fmt(xj.reduce((a, b) => a + b, 0) / Math.max(1, xj.length))}（≠ answer_confidence）| ` +
        `act_probability 取值集合 ${JSON.stringify([...new Set(ap)])}（官方说不可用于 gating）`
    );
  }

  return {
    variant,
    n: rows.length,
    failures: failures.length,
    latency: { p50: percentile(latencies, 50), p90: percentile(latencies, 90) },
    inputTokensPerCase: Math.round(rows.reduce((a, r) => a + (r.inputTokens ?? 0), 0) / Math.max(1, rows.length)),
    block: {
      accuracy: bs.accuracy,
      majority: bs.majority,
      meanAnswerConfidence: bs.meanAnswerConfidence,
      meanEntropyConfidence: bs.meanEntropyConfidence,
      meanConfCorrect: bs.meanConfidenceCorrect,
      meanConfWrong: bs.meanConfidenceWrong,
      aucConfidenceForCorrect: bs.aucConfidenceForCorrect,
      predDistribution: bs.predDistribution,
    },
    abstain: abstainCurve(rows, [0, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9]),
    recurrenceChoice: hasRecurrence ? onceMetrics(rows, (r) => r.predOnceChoice) : null,
    noulSweep: hasNoul ? noulSweep(rows, (r) => r.noulRecurring, [0.3, 0.5, 0.7]) : null,
    cueSweep: hasCue ? noulSweep(rows, (r) => r.freqCue, [0.3, 0.5, 0.7]) : null,
    truncation: tr,
    repeatability: rep,
    rows,
  };
}

function readRaw(outFile: string): RawRecord[] {
  if (!fs.existsSync(outFile)) return [];
  return fs
    .readFileSync(outFile, 'utf-8')
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RawRecord);
}

// --------------------------------------------------------------------------
// main
// --------------------------------------------------------------------------

async function run(): Promise<void> {
  const variantName = arg('variant', 'biased');
  const spec = VARIANTS[variantName];
  if (!spec) {
    console.error(`[laya-retest] 未知变体 ${variantName}；可选：${Object.keys(VARIANTS).join(' / ')}`);
    process.exitCode = 1;
    return;
  }
  const limit = Number(arg('limit', '60')) || 60;
  const concurrency = Number(arg('concurrency', '3')) || 3;
  const gapMs = Number(arg('delay', '700'));
  const outFile = path.join(arg('out', OUT_DIR), `${variantName}.jsonl`);
  const rows = loadCases(limit);

  const replays = Math.max(1, Number(arg('replays', '1')) || 1);
  console.log(`[laya-retest] variant=${variantName} | ${spec.label}`);
  console.log(`[laya-retest] ${rows.length} 例 × ${replays} 次 | model=${MODEL} | ${BASE_URL} | 并发 ${concurrency} / 起始间隔 ${gapMs}ms`);
  console.log(`[laya-retest] 原始响应落盘 → ${outFile}\n`);

  const records: RawRecord[] = [];
  const jobs: Array<{ row: CaseRow; index: number; replay: number }> = [];
  for (let replay = 1; replay <= replays; replay += 1) {
    for (const [index, row] of rows.entries()) jobs.push({ row, index, replay });
  }
  let done = 0;
  await runPool(jobs, concurrency, gapMs, async ({ row, index, replay }) => {
    const body = buildRequest(row, spec);
    let outcome: CallOutcome;
    if (spec.splitCalls) {
      // 每个问题单独发一次请求（state 每次重复发送），答案合并成一条记录，便于与整批发法逐问对比。
      const entries = Object.entries(body.questions ?? {});
      const merged: { model: string; answers: Record<string, unknown>; usage: Record<string, unknown> } = {
        model: '',
        answers: {},
        usage: {},
      };
      let totalMs = 0;
      let attempts = 0;
      let status: number | null = null;
      let err: string | null = null;
      for (const [qid, question] of entries) {
        const one = await callSystemOne({ state: body.state, questions: { [qid]: question } });
        totalMs += one.ms;
        attempts += one.attempts;
        status = one.httpStatus ?? status;
        if (one.error) {
          err = one.error;
          break;
        }
        Object.assign(merged.answers, one.response?.answers ?? {});
        if (one.response?.model) merged.model = String(one.response.model);
        const usage = one.response?.usage as Record<string, unknown> | undefined;
        if (usage) {
          const prev = Number(merged.usage.input_tokens ?? 0) || 0;
          const next = Number(usage.input_tokens ?? 0) || 0;
          Object.assign(merged.usage, usage);
          merged.usage.input_tokens = prev + next; // 拆开发时 state 会被重复计数，这里累加，才是真实成本
        }
      }
      outcome = { httpStatus: status, response: err ? null : merged, error: err, attempts, ms: totalMs };
    } else {
      outcome = await callSystemOne(body);
    }
    const record: RawRecord = {
      variant: variantName,
      index,
      replay,
      case: row.name,
      file: row.file,
      ts: new Date().toISOString(),
      gold: { block: row.labelBlock, recurrence: row.labelRecurrence },
      ms: outcome.ms,
      attempts: outcome.attempts,
      httpStatus: outcome.httpStatus,
      response: outcome.response,
      error: outcome.error,
    };
    appendRecord(outFile, record);
    records.push(record);
    done += 1;
    const res = outcome.response;
    const block = res?.answers?.block_type;
    const mark = outcome.error ? '✗' : block?.choice === row.labelBlock ? '✓' : '·';
    console.log(
      `  [${done}/${jobs.length}] ${mark} ${row.name.padEnd(5)} ` +
        (outcome.error
          ? `失败：${outcome.error.slice(0, 80)}`
          : `金标[${row.labelBlock}·${row.labelRecurrence}] → ${String(block?.choice)}(${fmt(gateConfidence(block ?? {}))}) ` +
            `rec=${String(res?.answers?.recurrence?.choice)} noul=${fmt(Number(res?.answers?.recurrence_noul?.noul))} ` +
            `dropped=${res?.usage?.state_tokens_dropped} trunc=${res?.usage?.truncated} ${outcome.ms}ms`)
    );
  });

  records.sort((a, b) => a.index - b.index || a.replay - b.replay);
  const summary = analyzeVariant(variantName, records, spec);
  const summaryFile = path.join(path.dirname(outFile), `${variantName}.summary.json`);
  fs.writeFileSync(
    summaryFile,
    JSON.stringify({ ...summary, rows: undefined, truncation: { ...summary.truncation, truncatedCases: summary.truncation.truncatedCases } }, null, 1),
    'utf-8'
  );
  console.log(`\n[laya-retest] 原始 JSONL → ${outFile}\n[laya-retest] 汇总 JSON → ${summaryFile}`);
}

function analyzeAll(): void {
  const dir = arg('out', OUT_DIR);
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.jsonl')).sort() : [];
  if (files.length === 0) {
    console.error(`[laya-retest] ${dir} 下没有 *.jsonl，先跑 --variant=...`);
    process.exitCode = 1;
    return;
  }
  const summaries = [];
  for (const file of files) {
    const variantName = file.replace(/\.jsonl$/, '');
    const records = readRaw(path.join(dir, file));
    const summary = analyzeVariant(variantName, records, VARIANTS[variantName]);
    summaries.push(summary);
    if (hasFlag('write-summaries')) {
      fs.writeFileSync(path.join(dir, `${variantName}.summary.json`), JSON.stringify({ ...summary, rows: undefined }, null, 1), 'utf-8');
    }
  }

  console.log(`\n${'='.repeat(96)}`);
  console.log('横向对比总表');
  console.table(
    summaries.map((s) => ({
      变体: s.variant,
      例数: `${s.n}/${s.n + s.failures}`,
      'block准确率': s.block.accuracy === null ? 'n/a' : `${(100 * s.block.accuracy).toFixed(0)}%`,
      '多数类': s.block.majority === null ? 'n/a' : `${(100 * s.block.majority).toFixed(0)}%`,
      '平均ansConf': fmt(s.block.meanAnswerConfidence),
      'conf对/错': `${fmt(s.block.meanConfCorrect)}/${fmt(s.block.meanConfWrong)}`,
      '放弃@0.5': `${(100 * (1 - (s.abstain.find((c) => c.t === 0.5)?.coverage ?? 0))).toFixed(0)}%`,
      '接受@0.5准确': s.abstain.find((c) => c.t === 0.5)?.acceptedAccuracy == null ? 'n/a' : `${(100 * (s.abstain.find((c) => c.t === 0.5)!.acceptedAccuracy as number)).toFixed(0)}%`,
      recChoice: s.recurrenceChoice === null ? 'n/a' : `${(100 * (s.recurrenceChoice.accuracy ?? 0)).toFixed(0)}%`,
      'noul@0.5': s.noulSweep === null ? 'n/a' : `${(100 * ((s.noulSweep.find((x) => x.threshold === 0.5)?.accuracy) ?? 0)).toFixed(0)}%`,
      'noul@0.7': s.noulSweep === null ? 'n/a' : `${(100 * ((s.noulSweep.find((x) => x.threshold === 0.7)?.accuracy) ?? 0)).toFixed(0)}%`,
      p50: s.latency.p50,
      'stateTok max': s.truncation.stateTokensMax,
      truncated: s.truncation.truncatedCount,
    }))
  );
}

async function main(): Promise<void> {
  if (hasFlag('analyze')) analyzeAll();
  else await run();
}

void main().catch((error) => {
  console.error('[laya-retest] 失败', error);
  process.exitCode = 1;
});
