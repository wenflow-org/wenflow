const fs = require('fs');

const files = [
  'src/coordinators/simulation.coordinator.ts',
  'src/routes/ai-teaching.routes.ts',
  'src/agents/simulation-agent/index.ts',
  'src/coordinators/learn.coordinator.ts',
  'src/coordinators/path.coordinator.ts',
  'src/routes/admin/platform.ts',
  'src/coordinators/ai-teaching.definition.ts'
];

// Garbled CJK characters typically fall in these "rare" CJK ranges when UTF-8 misread as GBK
// Common garbled chars: 锛 鍣 鐨 璇 绋 嬶 細 etc - these are valid CJK but appear in nonsense context
// Better approach: detect the replacement char and specific known-garbled bytes
// The mojibake chars are real CJK ideographs but uncommon. Detect lines with these specific markers.
const garbledMarkers = /[锛鍣鐨璇绋嬶細鈫娈鍗忚皟鐢熸垚璐熻矗鐤戦槻寰崇枒甯︿繃妯℃嫙浼氳瘽鑰呭洖澶辫触绱фユ娈靛鈥晳鎬ュ仠姝㈠崟]/;

files.forEach(f => {
  try {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    const hits = [];
    lines.forEach((line, i) => {
      if (garbledMarkers.test(line)) {
        hits.push((i + 1) + ': ' + line.trim().slice(0, 90));
      }
    });
    console.log('=== ' + f + ' : ' + hits.length + ' lines ===');
    hits.slice(0, 30).forEach(h => console.log('  ' + h));
  } catch (e) {
    console.log('ERR ' + f + ': ' + e.message);
  }
});
