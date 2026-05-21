import dotenv from 'dotenv';
import prisma from '../config/database';

dotenv.config();

async function migratePathGenerationStageDesign() {
  const paths = await prisma.learning_paths.findMany({
    where: {
      aiPromptTemplate: { not: null }
    },
    select: {
      id: true,
      aiPromptTemplate: true,
    }
  });

  let scanned = 0;
  let migrated = 0;

  for (const path of paths) {
    scanned += 1;
    if (!path.aiPromptTemplate) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(path.aiPromptTemplate);
    } catch {
      continue;
    }

    const generation = parsed?._generation;
    if (!generation || typeof generation !== 'object') continue;

    const needsMigration = (
      Object.prototype.hasOwnProperty.call(generation, 'enrichment')
      || Object.prototype.hasOwnProperty.call(generation, 'enrichmentRetryCount')
      || Object.prototype.hasOwnProperty.call(generation, 'lastEnrichmentRetryAt')
    );

    if (!needsMigration) continue;

    const nextGeneration = {
      ...generation,
      stageDesign: generation.stageDesign ?? generation.enrichment ?? null,
      stageDesignRetryCount: generation.stageDesignRetryCount ?? generation.enrichmentRetryCount ?? 0,
      lastStageDesignRetryAt: generation.lastStageDesignRetryAt ?? generation.lastEnrichmentRetryAt ?? null,
    } as Record<string, any>;

    delete nextGeneration.enrichment;
    delete nextGeneration.enrichmentRetryCount;
    delete nextGeneration.lastEnrichmentRetryAt;

    await prisma.learning_paths.update({
      where: { id: path.id },
      data: {
        aiPromptTemplate: JSON.stringify({
          ...parsed,
          _generation: nextGeneration,
        }),
        updatedAt: new Date(),
      }
    });

    migrated += 1;
  }

  console.log(JSON.stringify({
    success: true,
    scanned,
    migrated,
  }, null, 2));
}

migratePathGenerationStageDesign()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
