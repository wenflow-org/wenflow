import dotenv from 'dotenv';
import prisma from '../config/database';

dotenv.config();

async function upsertStageDesignerSkillConfig() {
  await prisma.skill_model_configs.upsert({
    where: { skillId: 'stage-designer' },
    update: {
      temperature: 0.3,
      maxTokens: 32000,
      requestTimeoutMs: 300000,
      enabled: true,
      updatedAt: new Date(),
    },
    create: {
      id: `smc_stage_designer_${Date.now()}`,
      skillId: 'stage-designer',
      tier: 'chat',
      temperature: 0.3,
      maxTokens: 32000,
      requestTimeoutMs: 300000,
      enabled: true,
      updatedAt: new Date(),
    }
  });

  console.log(JSON.stringify({
    success: true,
    skillId: 'stage-designer',
    requestTimeoutMs: 300000,
    maxTokens: 32000,
  }, null, 2));
}

upsertStageDesignerSkillConfig()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
