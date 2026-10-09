/* 把宣传片的每一幕渲染成静帧，肉眼核对排版。
   宣传片里 #still=N 会让该幕直接停在动画终态，所以这里拍到的都是「定稿那一帧」，
   不会卡在动画中途。

   想只拍某几幕：node src/_promo-shot.js 3 5   （只出第 4、6 幕）
   产物落在 src/_tmp/out/promo-N-幕名.png */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const OUT = path.join(__dirname, '_tmp', 'out');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.join(root, 'QQ推送批改-宣传片.html');

if (!fs.existsSync(FILE)) { console.error('找不到宣传片文件：' + FILE); process.exit(1); }
fs.mkdirSync(OUT, { recursive: true });

/* 幕名只用来拼文件名；真正的幕表在 HTML 里，这里改了不影响播放 */
const NAMES = ['开场', '痛点', '一句话', '操作流程', '图片批改', '工具', '写意见', '导出', '结束'];

const only = process.argv.slice(2).map(Number).filter(function (n) { return !isNaN(n); });
const list = only.length ? only : NAMES.map(function (_, i) { return i; });

let bad = 0;
list.forEach(function (n) {
  const out = path.join(OUT, 'promo-' + n + '-' + (NAMES[n] || n) + '.png');
  const url = 'file:///' + FILE.replace(/\\/g, '/') + '#still=' + n;
  try {
    execFileSync(EDGE, [
      '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
      '--hide-scrollbars',
      '--user-data-dir=' + path.join(os.tmpdir(), 'qpr-promo-profile'),
      '--window-size=1400,800',
      '--virtual-time-budget=3000',
      '--screenshot=' + out,
      url
    ], { stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 });
    console.log('OK    ' + n + ' ' + (NAMES[n] || '') + '  →  ' + path.relative(root, out));
  } catch (e) {
    bad++;
    console.log('FAIL  ' + n + ' ' + (NAMES[n] || '') + '  ' + String(e.message).split('\n')[0]);
  }
});
process.exit(bad ? 1 : 0);
