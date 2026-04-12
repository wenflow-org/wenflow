import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const paths = await prisma.learningPath.findMany({
    select: { id: true, name: true, userId: true },
    take: 10
  });
  console.log(JSON.stringify(paths, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
