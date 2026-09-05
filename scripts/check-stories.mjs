import prisma from '../backend/src/config/database.js';

const stories = await prisma.virtual_learner_stories.findMany({
  take: 5,
  select: { id: true, title: true, storyTitle: true, profileId: true, status: true }
});
console.log(JSON.stringify(stories, null, 2));
await prisma.$disconnect();
