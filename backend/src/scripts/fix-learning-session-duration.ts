import prisma from '../config/database';

type SessionRow = {
  id: string;
  userId: string;
  startTime: Date;
  endTime: Date | null;
  duration: number | null;
};

function parseArgs() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');
  const userArg = args.find((arg) => arg.startsWith('--userId='));
  const limitArg = args.find((arg) => arg.startsWith('--limit='));

  const userId = userArg ? userArg.split('=')[1] : undefined;
  const limit = limitArg ? Number(limitArg.split('=')[1]) : undefined;

  if (limit !== undefined && (!Number.isFinite(limit) || limit <= 0)) {
    throw new Error('--limit must be a positive number');
  }

  return { apply, userId, limit };
}

function computeNormalizedDuration(session: SessionRow): number | null {
  if (!session.endTime) {
    if (!session.duration || session.duration <= 0) return session.duration;
    if (session.duration > 24 * 60) return Math.max(1, Math.round(session.duration / 60));
    return session.duration;
  }

  const derived = Math.max(1, Math.round((session.endTime.getTime() - session.startTime.getTime()) / 60000));
  return derived;
}

async function main() {
  const { apply, userId, limit } = parseArgs();

  console.log(apply ? 'Mode: APPLY (will update database)' : 'Mode: DRY RUN (no database writes)');
  if (userId) console.log(`Filter: userId=${userId}`);
  if (limit) console.log(`Limit: ${limit}`);

  const sessions = await prisma.learning_sessions.findMany({
    where: {
      ...(userId ? { userId } : {}),
      duration: { not: null }
    },
    select: {
      id: true,
      userId: true,
      startTime: true,
      endTime: true,
      duration: true
    },
    orderBy: { startTime: 'desc' },
    ...(limit ? { take: limit } : {})
  });

  let changed = 0;
  let unchanged = 0;
  const updates: Array<{ id: string; from: number; to: number }> = [];

  for (const session of sessions) {
    const current = session.duration ?? 0;
    const normalized = computeNormalizedDuration(session as SessionRow);

    if (normalized === null || normalized === current) {
      unchanged += 1;
      continue;
    }

    changed += 1;
    updates.push({ id: session.id, from: current, to: normalized });
  }

  console.log(`Scanned: ${sessions.length}`);
  console.log(`Will change: ${changed}`);
  console.log(`Unchanged: ${unchanged}`);

  if (updates.length > 0) {
    console.log('Sample changes (max 20):');
    updates.slice(0, 20).forEach((item) => {
      console.log(`- ${item.id}: ${item.from} -> ${item.to}`);
    });
  }

  if (!apply || updates.length === 0) {
    return;
  }

  for (const item of updates) {
    await prisma.learning_sessions.update({
      where: { id: item.id },
      data: { duration: item.to }
    });
  }

  console.log(`Updated rows: ${updates.length}`);
}

main()
  .catch((error) => {
    console.error('Failed to normalize learning_sessions.duration:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
