import dotenv from 'dotenv';
import systemPrisma from '../config/system-database';

dotenv.config();

/**
 * 仅同步 stage-designer 的路由/可靠性字段。
 * temperature/maxTokens 由 prompts/*.md → agent_prompts ACTIVE 独占，禁止写入 skill_model_configs。
 */
async function upsertStageDesignerSkillConfig() {
  await systemPrisma.skill_model_configs.upsert({
    where: { skillId: 'stage-designer' },
    update: {
      requestTimeoutMs: 300000,
      enabled: true,
      updatedAt: new Date(),
    },
    create: {
      id: `smc_stage_designer_${Date.now()}`,
      skillId: 'stage-designer',
      tier: 'chat',
      // schema 占位默认；运行时不作为生成参数权威源
      temperature: 0.7,
      maxTokens: 2000,
      requestTimeoutMs: 300000,
      enabled: true,
      updatedAt: new Date(),
    },
  });

  console.log(
    JSON.stringify(
      {
        success: true,
        skillId: 'stage-designer',
        requestTimeoutMs: 300000,
        note: 'temperature/maxTokens not written; owner=agent_prompts.ACTIVE',
      },
      null,
      2
    )
  );
}

upsertStageDesignerSkillConfig()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });
