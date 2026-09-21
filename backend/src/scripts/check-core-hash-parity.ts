// 运维 CLI 入口：实现已迁 services/prompt-manifest/（审计 #8：scripts 只留纯运维 CLI，运行时依赖归位 service）
import { main } from '../services/prompt-manifest/check-core-hash-parity';
import systemPrisma from '../config/system-database';


main()
  .catch((error) => {
    console.log(
      JSON.stringify(
        { hasErrors: true, error: error instanceof Error ? error.message : String(error) },
        null,
        2
      )
    );
    process.exitCode = 1;
  })
  .finally(async () => {
    await systemPrisma.$disconnect();
  });

