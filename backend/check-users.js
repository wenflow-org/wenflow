const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

(async () => {
  try {
    const users = await prisma.users.findMany({ 
      select: { 
        id: true, 
        name: true, 
        email: true,
        learning_paths: {
          select: {
            id: true,
            title: true,
            description: true
          }
        }
      } 
    });
    
    console.log('=== Users and their Learning Paths ===\n');
    users.forEach(u => {
      console.log(`👤 User: ${u.id} - ${u.name} (${u.email})`);
      console.log(`   Paths: ${u.learning_paths.length}`);
      u.learning_paths.forEach(p => {
        console.log(`   - ${p.title}`);
      });
      console.log('');
    });
    
    await prisma.$disconnect();
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})();
