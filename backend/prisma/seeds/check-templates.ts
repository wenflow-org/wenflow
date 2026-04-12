import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const templates = await prisma.promptTemplate.findMany();
  console.log('Templates count:', templates.length);
  console.log('Templates:', JSON.stringify(templates, null, 2));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
