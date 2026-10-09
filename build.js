#!/usr/bin/env node
/**
 * 把 src/ 下的源码合并成一个单文件 index.html。
 * 为什么要合并：浏览器在 file:// 协议下会以 CORS 为由拦掉 ES Module，
 * 多文件 import 会导致用户双击 index.html 直接白屏。发布版必须自包含。
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');

const shell = read('src/shell.html');
const css = read('src/styles.css');
const js = read('src/app.js');

if (/<\/script>/i.test(js)) {
  console.error('构建中止：app.js 中出现了 </script> 字面量，会截断内联脚本。');
  process.exit(1);
}

const out = shell
  .replace('/*__CSS__*/', () => css)
  .replace('/*__JS__*/', () => js);

fs.writeFileSync(path.join(root, 'index.html'), out, 'utf8');

const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(1);
console.log('构建完成 → index.html  (' + kb + ' KB)');
