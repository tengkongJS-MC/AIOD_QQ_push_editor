/* 把宣传片渲染成 20 秒视频。

   为什么不用录屏：无头浏览器里 rAF 的时钟不跟 virtual-time 走（老问题了），
   实时录屏还会丢帧。这里换成「逐帧定格」——
   用 Web Animations API 把页面上所有 CSS 动画 pause() 后写 currentTime，
   就能把画面精确停到时间轴上的任意一刻，帧率完全由我们说了算。

   时间映射：原片 54 秒 → 20 秒，整体线性压缩（2.7x）。
   动画本身只有 .6~.9 秒，压完约 .2~.35 秒，配 --ease 是干脆利落的节奏；
   用 60fps 采样来保证不卡（60 / 2.7 ≈ 22fps 等效采样，肉眼够顺）。

   用法：
     node src/_promo-video.js            全片渲染 + 合成
     node src/_promo-video.js --frames=0-59   只渲前 60 帧（调试）
     node src/_promo-video.js --keep     保留帧文件，不合成
*/
const { spawn } = require('child_process');
const { pathToFileURL } = require('url');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const FILE = path.join(ROOT, 'QQ推送批改-宣传片.html');
const OUT = path.join(__dirname, '_tmp', 'video');

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

/* ffmpeg 用 imageio-ffmpeg 带的那份（隔离目录里，不污染系统）。
   版本号会变，所以按文件名扫，别写死。 */
const FFMPEG = (function () {
  const base = path.join('C:\\Users\\TENGKONG\\.workbuddy\\binaries\\python\\envs\\default',
    'Lib', 'site-packages', 'imageio_ffmpeg', 'binaries');
  try {
    const hit = fs.readdirSync(base)
      .filter((n) => /^ffmpeg-.*\.exe$/i.test(n)).sort().pop();
    if (hit) return path.join(base, hit);
  } catch (e) {}
  return 'ffmpeg';   /* 退回 PATH 上的 */
})();

/* ---------- 成片参数 ---------- */
const W = 1280;                      /* 设计稿 CSS 尺寸（舞台写死的 1280x720） */
const H = 720;
/* 渲染倍率。舞台是固定像素稿，1x 渲染出来细字发虚 —— 720p 成片就是这么来的。
   这里按 2x 出帧（2560x1440），文字才有 Retina 级锐度。 */
const RENDER_SCALE = 2;
/* 成片尺寸。从 2x 超采样降下来，比直接按 1.5x 渲染更锐（超采样抗锯齿）。
   要更极致的清晰度，把这里改成 2560x1440 即可。 */
const OUT_W = 1920;
const OUT_H = 1080;
const FPS = 60;
const DUR_S = 20;                    /* 目标时长 */
const SRC_TOTAL = 54000;             /* 原片总长（要跟 HTML 里的 data-dur 之和对上） */
const FRAMES = DUR_S * FPS;          /* 1200 帧 */
const SPEED = SRC_TOTAL / (DUR_S * 1000);   /* 2.7x */

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* 输出第 f 帧对应的「原片时刻」（ms） */
function srcTimeOf(f) {
  return Math.min(SRC_TOTAL - 1, (f / FPS) * 1000 * SPEED);
}

/* ---------- 极简 CDP 客户端（Node 22 自带 WebSocket，不用装包） ---------- */
function connect(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    const pending = new Map();
    let id = 0;
    ws.addEventListener('open', () => {
      resolve({
        send(method, params) {
          return new Promise((rs, rj) => {
            const mid = ++id;
            pending.set(mid, { rs, rj });
            ws.send(JSON.stringify({ id: mid, method, params: params || {} }));
          });
        },
        close() { try { ws.close(); } catch (e) {} }
      });
    });
    ws.addEventListener('message', (ev) => {
      let m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      if (m.id != null && pending.has(m.id)) {
        const { rs, rj } = pending.get(m.id);
        pending.delete(m.id);
        if (m.error) rj(new Error(m.method + ' ' + JSON.stringify(m.error)));
        else rs(m.result);
      }
    });
    ws.addEventListener('error', () => reject(new Error('调试端口连不上：' + url)));
  });
}

/* ---------- 页面里注入的「定格」函数 ---------- */
const RENDER_FN = `
window.__RENDER__ = function (vt) {
  var P = window.__PROMO__;
  if (!P) return 'no-promo';
  var starts = P.starts, T = P.total;
  if (vt < 0) vt = 0;
  if (vt > T - 1) vt = T - 1;
  var n = 0;
  while (n < starts.length - 1 && vt >= starts[n + 1]) n++;
  var off = vt - starts[n];

  /* show() 只在幕变的时候真的切，同幕内是空操作 */
  P.show(n);
  /* 强制一次样式重算，保证刚挂上的 CSS 动画/过渡已经进了 getAnimations() */
  void document.documentElement.offsetHeight;

  var list = document.getAnimations(), k = 0;
  for (var i = 0; i < list.length; i++) {
    try { list[i].pause(); list[i].currentTime = off; k++; } catch (e) {}
  }
  return n + ':' + Math.round(off) + ':' + k;
};
1;
`;

/* 视频模式：舞台铺满整屏，去掉圆角/投影/预览 HUD */
const VIDEO_CSS = `
html,body{background:#fff!important;}
.viewport{background:#fff!important;display:block!important;}
.stage{transform:none!important;border-radius:0!important;box-shadow:none!important;
  width:${W}px!important;height:${H}px!important;}
.hud,.hint{display:none!important;}
`;

async function main() {
  if (!fs.existsSync(FILE)) { console.error('找不到宣传片：' + FILE); process.exit(1); }
  if (!fs.existsSync(EDGE)) { console.error('找不到 Edge：' + EDGE); process.exit(1); }

  const argv = process.argv.slice(2);
  const keep = argv.includes('--keep');
  const rangeArg = (argv.find((a) => a.startsWith('--frames=')) || '').split('=')[1];
  let f0 = 0, f1 = FRAMES - 1;
  if (rangeArg) {
    const p = rangeArg.split('-');
    f0 = Math.max(0, parseInt(p[0], 10) || 0);
    f1 = Math.min(FRAMES - 1, p[1] != null ? parseInt(p[1], 10) : f0 + 59);
  }
  const partial = f0 !== 0 || f1 !== FRAMES - 1;

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  const port = 9333;
  const profile = path.join(os.tmpdir(), 'qpr-video-profile');
  fs.rmSync(profile, { recursive: true, force: true });

  const pageUrl = pathToFileURL(FILE).href;
  const proc = spawn(EDGE, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--hide-scrollbars', '--mute-audio', '--disable-extensions',
    '--force-device-scale-factor=' + RENDER_SCALE, '--disable-lcd-text',
    '--remote-debugging-port=' + port,
    '--user-data-dir=' + profile,
    '--window-size=' + W + ',' + H,
    pageUrl
  ], { stdio: ['ignore', 'ignore', 'ignore'], detached: false });

  let cdp = null;
  try {
    /* 等调试端口起来 */
    let target = null;
    for (let i = 0; i < 120; i++) {
      try {
        const list = await (await fetch('http://127.0.0.1:' + port + '/json/list')).json();
        const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
        target = pages.find((t) => (t.url || '').startsWith('file:')) || pages[0];
        if (target) break;
      } catch (e) {}
      await sleep(150);
    }
    if (!target) throw new Error('调试端口没起来');
    cdp = await connect(target.webSocketDebuggerUrl);

    await cdp.send('Page.enable');
    await cdp.send('Runtime.enable');
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: W, height: H, deviceScaleFactor: RENDER_SCALE, mobile: false
    });

    /* 等页面就绪 */
    let ready = false;
    for (let i = 0; i < 120; i++) {
      const r = await cdp.send('Runtime.evaluate', {
        expression: '!!(window.__PROMO__ && document.querySelector(".scene"))',
        returnByValue: true
      });
      if (r.result && r.result.value) { ready = true; break; }
      await sleep(120);
    }
    if (!ready) throw new Error('页面没加载出 __PROMO__');

    /* 注入视频模式样式 + 定格函数 */
    await cdp.send('Runtime.evaluate', { expression: RENDER_FN });
    await cdp.send('Runtime.evaluate', {
      expression: '(function(){var s=document.createElement("style");s.id="__video__";' +
        's.textContent=' + JSON.stringify(VIDEO_CSS) + ';document.head.appendChild(s);' +
        'window.__PROMO__.play(false);return 1;})()'
    });
    await sleep(220);

    /* 校对原片总长，和脚本里的常量对不上就直接报，别默默合成错时长的片子 */
    const meta = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({total:window.__PROMO__.total,names:window.__PROMO__.names})',
      returnByValue: true
    });
    const info = JSON.parse(meta.result.value);
    if (info.total !== SRC_TOTAL) {
      throw new Error('原片总长变了：' + info.total + 'ms（脚本里写的是 ' + SRC_TOTAL +
        'ms）—— 请同步 SRC_TOTAL 或改 DUR_S');
    }

    console.log('幕表  ' + info.names.join(' / '));
    console.log('映射  ' + SRC_TOTAL + 'ms → ' + (DUR_S * 1000) + 'ms（' +
      SPEED.toFixed(3) + 'x） · ' + FPS + 'fps · 共 ' + (f1 - f0 + 1) + ' 帧');
    console.log('画质  ' + RENDER_SCALE + 'x 渲染 ' + (W * RENDER_SCALE) + 'x' +
      (H * RENDER_SCALE) + ' → 成片 ' + OUT_W + 'x' + OUT_H);

    const t0 = Date.now();
    for (let f = f0; f <= f1; f++) {
      const vt = srcTimeOf(f);
      await cdp.send('Runtime.evaluate', { expression: '__RENDER__(' + vt + ')' });
      const shot = await cdp.send('Page.captureScreenshot', {
        format: 'png', captureBeyondViewport: false, fromSurface: true
      });
      fs.writeFileSync(path.join(OUT, 'f' + String(f).padStart(5, '0') + '.png'),
        Buffer.from(shot.data, 'base64'));
      if ((f - f0) % 60 === 0 || f === f1) {
        const done = f - f0 + 1, tot = f1 - f0 + 1;
        const el = (Date.now() - t0) / 1000;
        console.log('  ' + String(Math.round(done / tot * 100)).padStart(3) + '%  ' +
          done + '/' + tot + ' 帧   ' + el.toFixed(0) + 's   ' +
          '预计还需 ' + Math.max(0, Math.round(el / done * (tot - done))) + 's');
      }
    }

    if (partial) {
      console.log('只渲了一段（调试用），没合成视频。帧在 ' + path.relative(ROOT, OUT));
      return;
    }

    /* ---------- 合成 ---------- */
    if (!fs.existsSync(FFMPEG)) {
      console.log('没找到 ffmpeg（' + FFMPEG + '），帧已留在这里：' + path.relative(ROOT, OUT));
      console.log('手动合成：ffmpeg -framerate ' + FPS + ' -i f%05d.png -vf "scale=' +
        OUT_W + ':' + OUT_H + ':flags=lanczos:in_range=full:out_range=tv,format=yuv420p" ' +
        '-c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p out.mp4');
      return;
    }
    const outFile = path.join(ROOT, 'QQ推送批改-宣传片-20秒.mp4');
    console.log('合成中 → ' + path.basename(outFile));
    const fargs = [
      '-y',
      '-framerate', String(FPS),
      '-i', path.join(OUT, 'f%05d.png'),
      /* 静音音轨：有些平台/剪辑软件碰到没音轨的视频会别扭 */
      '-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo',
      /* 2x 超采样降回成片尺寸（lanczos），顺手把 full range 压到 tv(16-235)：
         不压的话视频会标成 yuvj420p，部分平台二压时整体发灰。 */
      '-vf', 'scale=' + OUT_W + ':' + OUT_H +
        ':flags=lanczos:in_range=full:out_range=tv,format=yuv420p',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '16',
      /* stillimage 让静态画面更忠实；I 帧加密到 2 秒一个，避免细字随 P 帧累积误差 */
      '-tune', 'stillimage', '-g', '120',
      '-pix_fmt', 'yuv420p', '-color_range', 'tv',
      '-c:a', 'aac', '-b:a', '96k', '-shortest',
      '-movflags', '+faststart',
      outFile
    ];
    const ff = spawn(FFMPEG, fargs, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    ff.stderr.on('data', (d) => { err += d.toString(); });
    await new Promise((res, rej) => {
      ff.on('exit', (c) => (c === 0 ? res() : rej(new Error('ffmpeg 退出码 ' + c + '\n' + err.slice(-1200)))));
    });

    const size = fs.statSync(outFile).size;
    console.log('完成  ' + outFile);
    console.log('      ' + (size / 1048576).toFixed(2) + ' MB · ' + OUT_W + 'x' + OUT_H +
      ' · ' + FPS + 'fps · ' + DUR_S + 's');

    if (!keep) fs.rmSync(OUT, { recursive: true, force: true });
  } finally {
    if (cdp) cdp.close();
    try { proc.kill(); } catch (e) {}
    /* 无头进程有时不肯马上退，补一刀 */
    await sleep(300);
    try { spawn('taskkill', ['/F', '/T', '/PID', String(proc.pid)], { stdio: 'ignore' }); } catch (e) {}
  }
}

main().catch((e) => { console.error('失败：' + e.message); process.exit(1); });
