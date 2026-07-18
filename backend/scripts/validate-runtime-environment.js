require('dotenv').config();

const main = String(process.env.DATABASE_URL || '').trim().replace(/\\/g, '/');
const system = String(process.env.SYSTEM_DATABASE_URL || '').trim().replace(/\\/g, '/');

if (/^file:\.\/prisma\//i.test(main)) {
  console.error('DATABASE_URL 使用了旧嵌套路径；当前本地路径应为 file:./dev.db');
  process.exit(1);
}
if (/^file:\.\/(?:prisma\/)?system\.db(?:[?#].*)?$/i.test(system)) {
  console.error('SYSTEM_DATABASE_URL 使用了旧歧义路径；当前本地路径应为 file:../system.db');
  process.exit(1);
}

console.log(JSON.stringify({ success: true }));
