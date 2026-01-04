import * as esbuild from 'esbuild';
import { existsSync, mkdirSync, copyFileSync, readdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const watch = process.argv.includes('--watch');

// 빌드 엔트리 포인트들
const entries = [
  { in: 'src/lib/core.ts', out: 'dist/lib/core.js' },
  { in: 'src/exporters/claude.ts', out: 'dist/exporters/claude.js' },
  { in: 'src/exporters/chatgpt.ts', out: 'dist/exporters/chatgpt.js' },
  { in: 'src/exporters/gemini.ts', out: 'dist/exporters/gemini.js' },
  { in: 'src/content-script.ts', out: 'dist/content-script.js' },
  { in: 'src/background.ts', out: 'dist/background.js' },
  { in: 'src/popup/popup.ts', out: 'dist/popup/popup.js' },
];

// 디렉토리 생성
function ensureDir(filePath) {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

// 정적 파일 복사
function copyStaticFiles() {
  // popup.html 복사
  ensureDir('dist/popup/popup.html');
  if (existsSync('src/popup/popup.html')) {
    copyFileSync('src/popup/popup.html', 'dist/popup/popup.html');
  }

  // icons 복사
  if (existsSync('icons')) {
    ensureDir('dist/icons/dummy');
    for (const file of readdirSync('icons')) {
      copyFileSync(join('icons', file), join('dist/icons', file));
    }
  }
}

// 빌드 설정
const buildOptions = {
  bundle: true,   // import 구문을 인라인으로 번들링
  format: 'iife', // Chrome Extension content script는 ES modules 미지원
  target: 'es2020',
  sourcemap: false,
  minify: false,
  logLevel: 'info',
};

async function build() {
  console.log('[build] Starting...');

  // 디렉토리 준비
  entries.forEach(e => ensureDir(e.out));

  // 정적 파일 복사
  copyStaticFiles();

  // 각 엔트리 빌드
  for (const entry of entries) {
    await esbuild.build({
      ...buildOptions,
      entryPoints: [entry.in],
      outfile: entry.out,
    });
  }

  console.log('[build] Done!');
}

async function watchMode() {
  console.log('[build] Watch mode...');

  // 초기 빌드
  await build();

  // watch 모드
  for (const entry of entries) {
    const ctx = await esbuild.context({
      ...buildOptions,
      entryPoints: [entry.in],
      outfile: entry.out,
    });
    await ctx.watch();
  }

  console.log('[build] Watching for changes...');
}

if (watch) {
  watchMode();
} else {
  build();
}
