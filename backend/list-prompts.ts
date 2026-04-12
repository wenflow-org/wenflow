import prisma from './src/config/database';

async function main() {
  const prompts = await prisma.prompt.findMany();
  console.log(JSON.stringify(prompts, null, 2));
}

main().catch(e => {
  console.error(e);
  process.exit(1);
}).finally(async () => {
  await prisma.$disconnect();
});