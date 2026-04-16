/**
 * Smart Log AI — JS 문법 체크 (Node 파서)
 * 사용:
 *   node tools/check-js-syntax.js
 *
 * 대상: 프로젝트 루트의 js 폴더 아래의 모든 .js 파일
 */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const JS_DIR = path.join(ROOT, 'js');

function walkDir(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walkDir(full, out);
    else if (ent.isFile() && ent.name.endsWith('.js')) out.push(full);
  }
  return out;
}

function checkFile(absPath) {
  const code = fs.readFileSync(absPath, 'utf8');
  try {
    new vm.Script(code, { filename: path.relative(ROOT, absPath).replace(/\\/g, '/') });
  } catch (e) {
    const rel = path.relative(ROOT, absPath);
    console.error(`\n[JS-SYNTAX] Parse error: ${rel}`);
    console.error(String(e && e.stack ? e.stack : e));
    process.exitCode = 1;
  }
}

function main() {
  if (!fs.existsSync(JS_DIR)) {
    console.error(`[JS-SYNTAX] Missing folder: ${path.relative(ROOT, JS_DIR)}`);
    process.exit(1);
  }

  const files = walkDir(JS_DIR).sort((a, b) => a.localeCompare(b));
  if (files.length === 0) {
    console.error('[JS-SYNTAX] No .js files found under js/');
    process.exit(1);
  }

  for (const f of files) checkFile(f);
  if (process.exitCode === 1) process.exit(1);
  console.log(`[JS-SYNTAX] OK — ${files.length} file(s) under js/`);
}

main();
