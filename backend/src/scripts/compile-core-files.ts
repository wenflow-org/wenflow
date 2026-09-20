// 运维 CLI 入口：实现已迁 services/prompt-manifest/（审计 #8：scripts 只留纯运维 CLI，运行时依赖归位 service）
import { compileAllCorePromptFiles } from '../services/prompt-manifest/compile-core-files';


void compileAllCorePromptFiles()
  .then((files) => {
    console.log(JSON.stringify({ success: true, count: files.length }, null, 2));
  })
  .catch((error) => {
    console.error('[compile-core-files] 失败', error);
    process.exitCode = 1;
  });

