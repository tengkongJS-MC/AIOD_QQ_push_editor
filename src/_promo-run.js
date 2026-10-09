/* 宣传片时间轴自检。
   QQ推送批改-宣传片.html 里的 #probe=1 会把断言结果写进 <pre id="__PROMO_META__">，
   这里用无头 Edge 把 DOM dump 回来解读。

   为什么要绕过 rAF：无头浏览器里 rAF 的时钟不跟着 virtual-time 推进，
   靠截图或等待根本验不出「自动播放」这条路。所以时间轴推进被抽成了
   advance(dt)，自检直接喂 dt 走真实的那段逻辑。

   顺带一个坑：脚本注释里也出现过 <pre id="__PROMO_META__"> 这几个字，
   dump 回来的 DOM 会把注释一起带上，正则必须要求紧跟一个 [ 才不会匹配错。 */
const path = require('path');
const os = require('os');
const fs = require('fs');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
const FILE = path.join(root, 'QQ推送批改-宣传片.html');

if (!fs.existsSync(FILE)) { console.error('找不到宣传片文件：' + FILE); process.exit(1); }

const url = 'file:///' + FILE.replace(/\\/g, '/') + '#probe=1';

let out = '';
try {
  out = execFileSync(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars',
    '--user-data-dir=' + path.join(os.tmpdir(), 'qpr-promo-probe'),
    '--window-size=1400,800',
    '--virtual-time-budget=2500',
    '--dump-dom', url
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024, timeout: 120000 });
} catch (e) {
  out = (e.stdout || '') + (e.stderr || '');
}

const m = out.match(/<pre id="__PROMO_META__">(\[[\s\S]*?)<\/pre>/);
if (!m) {
  console.error('没拿到探针输出（页面里的 #probe=1 分支没跑到？）');
  process.exit(1);
}

const rows = JSON.parse(
  m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
);

let bad = 0;
rows.forEach(function (r) {
  if (!r.p) bad++;
  console.log((r.p ? 'PASS  ' : 'FAIL  ') + String(r.n).padEnd(30) + (r.p ? '' : '  → ' + r.g));
});
console.log('—— 宣传片时间轴：' + rows.length + ' 项断言，' + (bad ? bad + ' 项未通过' : '全部通过 ✓'));
process.exit(bad ? 1 : 0);
