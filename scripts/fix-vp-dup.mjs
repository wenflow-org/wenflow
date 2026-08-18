import { readFileSync, writeFileSync } from 'node:fs';
const p = 'D:/wenflow/wenflow/frontend/src/views/admin-redesign/VirtualProfile.vue';
const lines = readFileSync(p, 'utf8').split('\n');

// Find the vp-lc block start (the outer one at line index 201, 0-based)
// We expect:
//   201: <div class="vp-lc" :class=...>
//   202:   <div class="vp-lc__row">
//   203:     <div class="vp-lc" :class=...>   <- duplicate to remove
//   204:       <div class="vp-lc__row">        <- duplicate to remove
//   205:         <span 阶段 ...>
// We want to remove lines 203 and 204 (0-based: 202 and 203)

// Locate all lines that are exactly the duplicated vp-lc open tag
let targetIdx = -1;
for (let i = 0; i < lines.length; i++) {
  const t = lines[i].trim();
  if (t.startsWith('<div class="vp-lc" :class=') && t === '<div class="vp-lc" :class="{ \'is-stalled\': progressOf(s).stalled, \'is-running\': progressOf(s).running }">') {
    // Check if next-next line is also another vp-lc (nested duplicate)
    const next = lines[i + 1] || '';
    const next2 = lines[i + 2] || '';
    if (next.trim() === '<div class="vp-lc__row">' && next2.trim().startsWith('<div class="vp-lc"')) {
      targetIdx = i;
      break;
    }
  }
}

if (targetIdx === -1) {
  console.log('NOT FOUND: no duplicated vp-lc block');
  process.exit(1);
}

// Remove the duplicate: lines targetIdx+1 (the row) and targetIdx+2 (the nested vp-lc)
console.log('duplicate at line', targetIdx + 1, '(1-based)');
lines.splice(targetIdx + 1, 2); // remove <div class="vp-lc__row"> and nested <div class="vp-lc">
writeFileSync(p, lines.join('\n'), 'utf8');
console.log('DONE - removed duplicate wrapper');