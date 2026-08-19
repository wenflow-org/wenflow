import { readFileSync, writeFileSync } from 'fs';

const files = {
  'frontend/src/views/admin-redesign/LearnerCenter.vue': {
    patterns: [
      { regex: /const normalRows: Row\[\] = \[[\s\S]*?\n\]\n/, replace: '/* demo 数据已移除 */\n' },
      { regex: /const demoRows = ref<Row\[\]>\(\[\.\.\.normalRows\]\)/, replace: 'const demoRows = ref<Row[]>([]) // demo 数据已移除' },
    ]
  },
  'frontend/src/views/admin-redesign/TeachingSessions.vue': {
    patterns: [
      { regex: /const demoRows: Row\[\] = \[[\s\S]*?\n\]\n/, replace: '/* demo 数据已移除 */\n' },
    ]
  },
  'frontend/src/views/admin-redesign/Announcements.vue': {
    patterns: [
      { regex: /const demoRows.*=.*\[[\s\S]*?\n\]\n/, replace: 'const demoRows = ref([]) // demo 数据已移除\n' },
    ]
  }
};

for (const [file, config] of Object.entries(files)) {
  let content = readFileSync(file, 'utf8');
  for (const { regex, replace } of config.patterns) {
    const before = content;
    content = content.replace(regex, replace);
    if (content === before) console.log(`  ⚠️ ${file}: pattern not matched`);
  }
  writeFileSync(file, content, 'utf8');
  console.log(`✅ ${file}`);
}
