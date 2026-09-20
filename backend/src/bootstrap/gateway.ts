/**
 * EduClaw Gateway 装配（架构审计 §5 行动 #3：index.ts 拆分）
 *
 * 职责：创建 Gateway、启动期 manifest / skills.yaml 户口簿校验、注册官方 Agent 与核心 Skill、
 * 清理退役 Skill 残留、同步能力探针开关。
 */
import prisma from '../config/database';
import systemPrisma from '../config/system-database';
import { logger } from '../utils/logger';
import { createGateway, EduClawGateway } from '../gateway';
import { registerOfficialAgents } from '../agents';
import { allSkillDefinitions, skillHandlers } from '../skills';
import { PURGED_SKILLS } from '../skills/retired-skills';
import { validateManifest, listTopLevelAgents } from '../services/agent-manifest.service';
import { loadSkillsFile } from '../services/skill-registry/skills-file';
import { aiCapabilityHealthService } from '../services/ai-capability-health.service';
import { getRuntimeCapabilityProbeEnabled } from '../services/capability-probe-settings.service';

/**
 * 初始化 EduClaw Gateway
 */
export async function initializeGateway(): Promise<EduClawGateway> {
  logger.info('Initializing EduClaw Gateway...');

  // 创建 Gateway
  const instance = createGateway(prisma, {
    ai: {
      baseUrl: process.env.AI_API_URL || 'http://localhost:3000',
      apiKey: process.env.AI_API_KEY || '',
      defaultModel: process.env.AI_MODEL || '',
      defaultReasoningModel: process.env.AI_MODEL_REASONING || '',
    }
  });

  // 注册所有官方 Agent
  // 启动校验：manifest 必须合法（kind=agent 无 prompt，kind=skill 有 prompt 与 modelConfig）
  const manifestCheck = validateManifest();
  if (manifestCheck.ok === false) {
    logger.error('[startup] Agent manifest 校验失败，终止启动:');
    for (const err of manifestCheck.errors) {
      logger.error('  - ' + err);
    }
    throw new Error('Agent manifest 校验失败');
  }
  const topAgents = listTopLevelAgents();
  logger.info(`[startup] Agent manifest OK · ${topAgents.length} 个顶层 Agent: ${topAgents.map(a => a.id).join(', ')}`);

  // skills.yaml 户口簿校验（P0）：F1~F10/F12 任一失败即终止启动
  // （fail-fast，与 field-routing import 期 fail-fast 同风格）。过渡开关 SKILLS_FILE_DISABLED=1
  // 跳过（规格 §5.3 回滚点，仅限一版发布窗口）。
  if (process.env.SKILLS_FILE_DISABLED === '1') {
    logger.info('[startup] skills.yaml 户口簿校验已跳过（SKILLS_FILE_DISABLED=1，过渡回滚点）');
  } else {
    const skillsBook = loadSkillsFile();
    const kindCounts = skillsBook.skills.reduce((acc, entry) => {
      acc[entry.kind] = (acc[entry.kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);
    logger.info(`[startup] skills.yaml 户口簿校验 OK · ${skillsBook.skills.length} 条活跃登记（kind 分布: ${Object.entries(kindCounts).map(([kind, count]) => `${kind}=${count}`).join(' ')}）`);
  }

  await registerOfficialAgents({
    registerAgent: async (definition, handler) => {
      return instance.registerAgent(definition, handler);
    }
  });

  // 注册所有核心 Skill
  for (const definition of allSkillDefinitions) {
    const handler = skillHandlers[definition.name];
    if (handler) {
      await instance.registerSkill(definition, handler);
    }
  }

  // 加载已有的注册
  await instance.loadRegistrations();

  logger.info('✅ EduClaw Gateway initialized');

  return instance;
}

export async function purgeRetiredSkills(): Promise<void> {
  const retiredSkillNames = [...PURGED_SKILLS];
  const retiredAgentIds = retiredSkillNames.map((name) => `skill:${name}`);

  await Promise.all([
    systemPrisma.skill_registrations.deleteMany({ where: { name: { in: retiredSkillNames } } }),
    systemPrisma.skill_model_configs.deleteMany({ where: { skillId: { in: retiredSkillNames } } }),
    prisma.user_skill_configs.deleteMany({ where: { skillName: { in: retiredSkillNames } } }),
    systemPrisma.agent_prompts.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    // 2026-08 统一化：退役 skill 的管道/契约残留一并清理（bootstrap 只建不更新，残留行不可达）
    systemPrisma.agent_field_routings.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    systemPrisma.agent_contracts.deleteMany({ where: { agentId: { in: retiredAgentIds } } }),
    // agent-snapshots.md 是自动生成的沙盘说明书（非 prompt 源），误入 agent_prompts 的行一并清理
    systemPrisma.agent_prompts.deleteMany({ where: { agentId: 'agent-snapshots' } })
  ]);

  logger.info('已清理退役 Skill 配置残留', {
    retiredSkillCount: retiredSkillNames.length
  });
}

/**
 * 能力探针开关统管自动探测：关闭时不启动定时轮询。
 * 启动金丝雀已移除：健康快照由周期探测（开关开启时）或手动「立即探测」生成，
 * 不再在每次进程启动时向模型服务发一轮真实请求（dev 热重载下尤其浪费）。
 */
export async function syncCapabilityProbeSettings(): Promise<void> {
  const probeEnabled = await getRuntimeCapabilityProbeEnabled();
  await aiCapabilityHealthService.setEnabled(probeEnabled);
  if (!probeEnabled) {
    logger.info('[ai-capability] 探测定时器已禁用（默认关闭 / 连接与安全开关关闭），跳过 start()');
  }
}
