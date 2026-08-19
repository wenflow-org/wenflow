import { readFileSync, writeFileSync } from 'fs';

const file = 'frontend/src/views/admin-redesign/store.ts';
let content = readFileSync(file, 'utf8');

// Replace learnerDetails array with empty
content = content.replace(
  /export const learnerDetails: LearnerDetail\[\] = \[[\s\S]*?\n\]/,
  'export const learnerDetails: LearnerDetail[] = [] // demo 数据已移除'
);

// Replace virtualProfiles array with empty
content = content.replace(
  /export const virtualProfiles: VirtualProfile\[\] = \[[\s\S]*?\n\]/,
  'export const virtualProfiles: VirtualProfile[] = [] // demo 数据已移除'
);

// Replace userDetails array with empty
content = content.replace(
  /export const userDetails: UserDetail\[\] = \[[\s\S]*?\n\]/,
  'export const userDetails: UserDetail[] = [] // demo 数据已移除'
);

writeFileSync(file, content, 'utf8');
console.log('Done — demo arrays replaced with empty');
