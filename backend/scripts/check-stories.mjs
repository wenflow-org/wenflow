import { PrismaClient } from '@prisma/client';
const p = new PrismaClient();

const profiles = await p.virtual_learner_profiles.findMany({
  take: 14,
  select: { id: true, profile: true }
});

console.log('=== Story title inspection ===\n');
for (const prof of profiles) {
  try {
    const data = JSON.parse(prof.profile || '{}');
    const pool = Array.isArray(data?.storyPool) ? data.storyPool : [];
    if (!pool.length) continue;
    const s = pool[0];
    const title = s.title || '';
    const buf = Buffer.from(title, 'utf8');
    const isTruncated = buf.length < title.length * 3 && !title.endsWith('）') && !title.endsWith('"') && !title.endsWith('。');
    console.log(`${prof.id.slice(0,8)}: titleLen=${title.length} byteLen=${buf.length} title="${title}"`);
    if (buf.length > 0) {
      // Check if last byte is a valid UTF-8 ending
      const lastByte = buf[buf.length - 1];
      const isContinuation = (lastByte & 0xC0) === 0x80;
      console.log(`  lastByte=0x${lastByte.toString(16)} isContinuation=${isContinuation} truncated=${isContinuation}`);
    }
  } catch(e) {
    console.log(`${prof.id}: error ${e.message}`);
  }
}

await p.$disconnect();
