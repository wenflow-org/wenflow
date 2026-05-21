import dotenv from 'dotenv';
import prisma from '../config/database';

dotenv.config();

async function migrateRemoveFramingDiagnostics() {
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
  let withSceneFraming = 0;
  let removedQualityFlags = 0;
  let removedSupportingEvidence = 0;

  for (const path of paths) {
    scanned += 1;
    if (!path.aiPromptTemplate) continue;

    let parsed: any;
    try {
      parsed = JSON.parse(path.aiPromptTemplate);
    } catch {
      continue;
    }

    const sceneFraming = parsed?.sceneFraming;
    if (!sceneFraming || typeof sceneFraming !== 'object') continue;
    withSceneFraming += 1;

    const normalizedInput = sceneFraming.normalizedInput && typeof sceneFraming.normalizedInput === 'object'
      ? { ...sceneFraming.normalizedInput }
      : null;

    const hasQualityFlags = !!(normalizedInput && Object.prototype.hasOwnProperty.call(normalizedInput, 'qualityFlags'));
    const hasSupportingEvidence = Object.prototype.hasOwnProperty.call(sceneFraming, 'supportingEvidence');

    if (!hasQualityFlags && !hasSupportingEvidence) continue;

    if (hasQualityFlags && normalizedInput) {
      delete normalizedInput.qualityFlags;
      removedQualityFlags += 1;
    }

    const nextSceneFraming = {
      ...sceneFraming,
      ...(normalizedInput ? { normalizedInput } : {}),
    } as Record<string, any>;

    if (hasSupportingEvidence) {
      delete nextSceneFraming.supportingEvidence;
      removedSupportingEvidence += 1;
    }

    await prisma.learning_paths.update({
      where: { id: path.id },
      data: {
        aiPromptTemplate: JSON.stringify({
          ...parsed,
          sceneFraming: nextSceneFraming,
        }),
        updatedAt: new Date(),
      }
    });

    migrated += 1;
  }

  console.log(JSON.stringify({
    success: true,
    scanned,
    withSceneFraming,
    migrated,
    removedQualityFlags,
    removedSupportingEvidence,
  }, null, 2));
}

migrateRemoveFramingDiagnostics()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
