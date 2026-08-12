'use strict';

/* =========================================================
   ブロックくずし(高齢の親向け・低ストレス版)
   - 操作:画面下部の操作エリアを指でなぞってバーを動かす(絶対位置)
   - ボールは常に1個・ずっとゆっくり一定速度
   - バーの当たった位置で跳ね返る向きが変わる(狙える)
   - やさしいライフ制(残機5)、3ステージ、全面クリアでおめでとう
   - 端末の文字サイズ拡大に強い(盤面オートフィット・SVGボタン)
   ========================================================= */

// ----- 色(高コントラスト) -----
const COLORS = {
  C: '#00E5FF', // 水色
  M: '#D500F9', // 紫
  Y: '#FFD600', // 黄
  G: '#00E676', // 緑
  O: '#FF9100', // 橙
  R: '#FF3D00', // 赤
  B: '#2979FF', // 青
};

// ----- ステージのブロック配置(面ごとに変える) -----
// 文字=色、'.'=空。列は8マス。
const STAGE_PATTERNS = [
  // ステージ1:びっしり
  [
    'CCCCCCCC',
    'MMMMMMMM',
    'YYYYYYYY',
    'GGGGGGGG',
    'OOOOOOOO',
  ],
  // ステージ2:ダイヤ型
  [
    '...CC...',
    '..MMMM..',
    '.YYYYYY.',
    'GGGGGGGG',
    '.OOOOOO.',
    '..RRRR..',
  ],
  // ステージ3:市松+すき間
  [
    'C.C.C.C.',
    '.M.M.M.M',
    'Y.Y.Y.Y.',
    '.G.G.G.G',
    'B.B.B.B.',
    '.O.O.O.O',
  ],
];
const BRICK_COLS = 8;

// ----- ゲーム設定 -----
const LIVES_START = 5;
const LAUNCH_DELAY = 1200;     // 「よーい」の間(ミリ秒)
const BALL_SPEED_FRAC = 0.38;  // ボール速度(画面高さに対する毎秒の割合)
const MAX_BOUNCE = 1.05;       // バー端で曲がる最大角(ラジアン、約60度)
const PADDLE_W_FRAC = 0.24;    // バーの幅(画面幅に対する割合)
const BALL_R_FRAC = 0.022;     // ボール半径(画面幅に対する割合)

// =========================================================
//  DOM
// =========================================================
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
const strip = document.getElementById('control-strip');
const scoreEl = document.getElementById('score');
const stageEl = document.getElementById('stage');
const livesEl = document.getElementById('lives');
const finalScoreEl = document.getElementById('final-score');
const clearScoreEl = document.getElementById('clear-score');

const startScreen = document.getElementById('start-screen');
const pauseScreen = document.getElementById('pause-screen');
const gameoverScreen = document.getElementById('gameover-screen');
const allclearScreen = document.getElementById('allclear-screen');

// =========================================================
//  状態
// =========================================================
let cw, ch;              // 描画サイズ(CSSピクセル)
let bricks;              // ブロック一覧 {col,row,color,alive}
let ball;                // { nx, ny, angle }  位置は0〜1の正規化、角度はラジアン
let paddle;              // { nx }  中心x(0〜1)
let score, stage, lives;
let phase;               // 'ready'(発射待ち) | 'play'
let launchTimer;         // readyの残り(ミリ秒)
let banner;              // 画面中央の一時表示 { text, timer }
let running, paused;
let lastTime;

// =========================================================
//  キャンバスのオートフィット(文字拡大・画面変化に強い)
// =========================================================
function setupCanvas() {
  const area = canvas.parentElement;
  cw = Math.max(area.clientWidth, 40);
  ch = Math.max(area.clientHeight, 40);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = cw + 'px';
  canvas.style.height = ch + 'px';
  canvas.width = Math.round(cw * dpr);
  canvas.height = Math.round(ch * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  draw();
}

// =========================================================
//  各要素の寸法(現在の画面サイズから毎回計算=リサイズに強い)
// =========================================================
function ballRadius() { return Math.max(cw * BALL_R_FRAC, 6); }
function paddleW()    { return cw * PADDLE_W_FRAC; }
function paddleH()    { return Math.max(ch * 0.022, 12); }
function paddleY()    { return ch * 0.94; } // バーの中心y

function brickMetrics() {
  const gap = Math.max(cw * 0.012, 2);
  const bw = cw / BRICK_COLS;
  const top = ch * 0.10;
  const bh = Math.max(ch * 0.045, 16);
  return { gap, bw, bh, top };
}

function brickRect(b) {
  const { gap, bw, bh, top } = brickMetrics();
  return {
    x: b.col * bw + gap / 2,
    y: top + b.row * bh + gap / 2,
    w: bw - gap,
    h: bh - gap,
  };
}

// =========================================================
//  ステージ読み込み
// =========================================================
function loadStage(n) {
  const pattern = STAGE_PATTERNS[n - 1];
  bricks = [];
  for (let r = 0; r < pattern.length; r++) {
    for (let c = 0; c < pattern[r].length; c++) {
      const ch2 = pattern[r][c];
      if (ch2 !== '.' && COLORS[ch2]) {
        bricks.push({ col: c, row: r, color: COLORS[ch2], alive: true });
      }
    }
  }
  resetBall();
}

function aliveCount() {
  let n = 0;
  for (const b of bricks) if (b.alive) n++;
  return n;
}

// =========================================================
//  ボールの準備・発射
// =========================================================
function resetBall() {
  phase = 'ready';
  launchTimer = LAUNCH_DELAY;
  paddle = paddle || { nx: 0.5 };
  ball = { nx: paddle.nx, ny: 0, angle: -Math.PI / 2 };
  putBallOnPaddle();
}

function putBallOnPaddle() {
  const r = ballRadius();
  ball.nx = paddle.nx;
  ball.ny = (paddleY() - paddleH() / 2 - r - 1) / ch;
}

function launchBall() {
  phase = 'play';
  // ほぼ真上に、少しだけ左右へばらつかせて発射
  ball.angle = -Math.PI / 2 + (Math.random() * 0.5 - 0.25);
  Sound.launch();
}

// =========================================================
//  更新(物理)
// =========================================================
function update(dt) {
  if (phase === 'ready') {
    putBallOnPaddle();
    launchTimer -= dt * 1000;
    if (launchTimer <= 0) launchBall();
    return;
  }

  // --- ボール移動 ---
  const speed = ch * BALL_SPEED_FRAC;
  const r = ballRadius();
  let bx = ball.nx * cw + Math.cos(ball.angle) * speed * dt;
  let by = ball.ny * ch + Math.sin(ball.angle) * speed * dt;

  // --- 壁 ---
  if (bx - r < 0) { bx = r; ball.angle = Math.PI - ball.angle; Sound.wall(); }
  else if (bx + r > cw) { bx = cw - r; ball.angle = Math.PI - ball.angle; Sound.wall(); }
  if (by - r < 0) { by = r; ball.angle = -ball.angle; Sound.wall(); }

  ball.nx = bx / cw;
  ball.ny = by / ch;

  // --- ブロック(1フレームに1個まで) ---
  for (const b of bricks) {
    if (!b.alive) continue;
    const rect = brickRect(b);
    const closestX = Math.max(rect.x, Math.min(bx, rect.x + rect.w));
    const closestY = Math.max(rect.y, Math.min(by, rect.y + rect.h));
    const dx = bx - closestX;
    const dy = by - closestY;
    if (dx * dx + dy * dy <= r * r) {
      b.alive = false;
      score += 10;
      updateHud();
      // 当たった面で反射(はみ出しの少ない軸で判定)
      if (Math.abs(dx) > Math.abs(dy)) ball.angle = Math.PI - ball.angle;
      else ball.angle = -ball.angle;
      Sound.brick();
      break;
    }
  }

  // --- バー ---
  const pw = paddleW();
  const ph = paddleH();
  const px = paddle.nx * cw;
  const py = paddleY();
  if (Math.sin(ball.angle) > 0) { // 下向きに進んでいるとき
    if (by + r >= py - ph / 2 && by - r <= py + ph / 2 &&
        bx >= px - pw / 2 - r && bx <= px + pw / 2 + r) {
      const offset = Math.max(-1, Math.min(1, (bx - px) / (pw / 2)));
      ball.angle = -Math.PI / 2 + offset * MAX_BOUNCE;
      ball.ny = (py - ph / 2 - r - 1) / ch;
      Sound.paddle();
    }
  }

  // --- ミス(バーの下を通過) ---
  if (by - r > ch) {
    loseLife();
    return;
  }

  // --- ステージクリア ---
  if (aliveCount() === 0) {
    stageClear();
  }
}

function loseLife() {
  lives--;
  updateHud();
  Sound.miss();
  if (lives <= 0) {
    gameOver();
  } else {
    resetBall();
  }
}

function stageClear() {
  if (stage < STAGE_PATTERNS.length) {
    // 次のステージへ(短い演出のあと自動で進む)
    phase = 'ready';
    banner = { text: 'ステージ ' + stage + ' クリア！', timer: 1500 };
    const nextStage = stage + 1;
    setTimeout(() => {
      if (!running) return;
      stage = nextStage;
      updateHud();
      loadStage(stage);
      banner = null;
    }, 1500);
    // 演出中はボールを止める
    ball = null;
  } else {
    allClear();
  }
}

function allClear() {
  running = false;
  ball = null;
  Sound.clear();
  clearScoreEl.textContent = score;
  allclearScreen.classList.remove('hidden');
}

function gameOver() {
  running = false;
  ball = null;
  Sound.gameover();
  finalScoreEl.textContent = score;
  gameoverScreen.classList.remove('hidden');
}

// =========================================================
//  描画
// =========================================================
function roundRect(x, y, w, h, radius) {
  const rr = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function drawBrick(rect, color) {
  ctx.fillStyle = color;
  roundRect(rect.x, rect.y, rect.w, rect.h, 5);
  ctx.fill();
  // 立体感
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillRect(rect.x + 2, rect.y + 2, rect.w - 4, Math.max(rect.h * 0.18, 3));
  ctx.strokeStyle = 'rgba(0,0,0,0.45)';
  ctx.lineWidth = 2;
  roundRect(rect.x, rect.y, rect.w, rect.h, 5);
  ctx.stroke();
}

function draw() {
  if (!cw) return;
  ctx.clearRect(0, 0, cw, ch);

  // ブロック
  if (bricks) {
    for (const b of bricks) {
      if (b.alive) drawBrick(brickRect(b), b.color);
    }
  }

  // バー
  if (paddle) {
    const pw = paddleW();
    const ph = paddleH();
    const px = paddle.nx * cw;
    const py = paddleY();
    ctx.fillStyle = 'var(--accent)';
    ctx.fillStyle = '#00E5FF';
    roundRect(px - pw / 2, py - ph / 2, pw, ph, ph / 2);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    roundRect(px - pw / 2 + 3, py - ph / 2 + 2, pw - 6, ph * 0.35, ph * 0.2);
    ctx.fill();
  }

  // ボール
  if (ball) {
    const r = ballRadius();
    const bx = ball.nx * cw;
    const by = ball.ny * ch;
    ctx.beginPath();
    ctx.arc(bx, by, r, 0, Math.PI * 2);
    ctx.fillStyle = '#FFFFFF';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(bx - r * 0.3, by - r * 0.3, r * 0.4, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,255,255,0.9)';
    ctx.fill();
  }

  // 中央バナー(ステージクリアなど)
  if (banner) {
    ctx.fillStyle = '#00E5FF';
    ctx.font = '800 ' + Math.round(cw * 0.075) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(banner.text, cw / 2, ch * 0.45);
  }

  // 「よーい」の間の合図
  if (phase === 'ready' && ball && running && !paused) {
    ctx.fillStyle = 'rgba(174,185,212,0.9)';
    ctx.font = '800 ' + Math.round(cw * 0.05) + 'px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('よーい…', cw / 2, ch * 0.6);
  }
}

// =========================================================
//  HUD
// =========================================================
function updateHud() {
  scoreEl.textContent = score;
  stageEl.textContent = stage;
  livesEl.textContent = lives;
}

// =========================================================
//  メインループ
// =========================================================
function loop(time) {
  if (running && !paused) {
    let dt = (time - lastTime) / 1000;
    lastTime = time;
    if (dt > 0.05) dt = 0.05; // タブ復帰などの大ジャンプを抑制
    if (ball) update(dt);
    if (banner) banner.timer -= dt * 1000;
    draw();
  } else {
    lastTime = time;
  }
  requestAnimationFrame(loop);
}

// =========================================================
//  ゲーム開始・一時停止
// =========================================================
function newGame() {
  score = 0;
  lives = LIVES_START;
  stage = 1;
  paddle = { nx: 0.5 };
  banner = null;
  paused = false;
  running = true;
  updateHud();
  loadStage(stage);
}

function startGame() {
  Sound.init();
  startScreen.classList.add('hidden');
  pauseScreen.classList.add('hidden');
  gameoverScreen.classList.add('hidden');
  allclearScreen.classList.add('hidden');
  newGame();
}

function togglePause(force) {
  if (!running) return;
  const want = (force === undefined) ? !paused : force;
  if (want === paused) return;
  paused = want;
  if (paused) {
    pauseScreen.classList.remove('hidden');
  } else {
    pauseScreen.classList.add('hidden');
    lastTime = performance.now();
  }
}

// =========================================================
//  効果音(Web Audio のシンプルなビープ)
// =========================================================
const Sound = {
  ctx: null,
  muted: false,
  init() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },
  beep(freq, dur, type = 'square', vol = 0.15) {
    if (this.muted || !this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(this.ctx.destination);
    osc.start(t);
    osc.stop(t + dur);
  },
  paddle()  { this.beep(320, 0.05); },
  wall()    { this.beep(240, 0.04); },
  brick()   { this.beep(520, 0.05, 'square', 0.12); },
  launch()  { this.beep(440, 0.08); },
  miss()    { this.beep(150, 0.25, 'sawtooth'); },
  clear()   { this.beep(523, 0.12); setTimeout(() => this.beep(784, 0.16), 110); setTimeout(() => this.beep(1046, 0.2), 240); },
  gameover(){ this.beep(200, 0.3, 'sawtooth'); setTimeout(() => this.beep(120, 0.4, 'sawtooth'), 160); },
};

// =========================================================
//  入力(操作エリアを指でなぞる=バーの絶対位置)
// =========================================================
function pointerToPaddle(clientX) {
  const rect = canvas.getBoundingClientRect();
  const halfW = PADDLE_W_FRAC / 2;
  let nx = (clientX - rect.left) / rect.width;
  nx = Math.max(halfW, Math.min(1 - halfW, nx));
  paddle.nx = nx;
  if (phase === 'ready') putBallOnPaddle();
}

let dragging = false;
strip.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  if (!running || paused || !paddle) return;
  dragging = true;
  try { strip.setPointerCapture(e.pointerId); } catch (_) {}
  pointerToPaddle(e.clientX);
});
strip.addEventListener('pointermove', (e) => {
  if (!dragging || !running || paused || !paddle) return;
  pointerToPaddle(e.clientX);
});
const endDrag = () => { dragging = false; };
strip.addEventListener('pointerup', endDrag);
strip.addEventListener('pointercancel', endDrag);

// パソコンでの確認用(矢印キー)
window.addEventListener('keydown', (e) => {
  if (!running || paused || !paddle) return;
  const step = 0.05;
  if (e.key === 'ArrowLeft') { paddle.nx = Math.max(PADDLE_W_FRAC / 2, paddle.nx - step); if (phase === 'ready') putBallOnPaddle(); }
  else if (e.key === 'ArrowRight') { paddle.nx = Math.min(1 - PADDLE_W_FRAC / 2, paddle.nx + step); if (phase === 'ready') putBallOnPaddle(); }
  else if (e.key === ' ') { togglePause(); e.preventDefault(); }
});

// ボタン
document.getElementById('start-btn').addEventListener('click', startGame);
document.getElementById('retry-btn').addEventListener('click', startGame);
document.getElementById('again-btn').addEventListener('click', startGame);
document.getElementById('resume-btn').addEventListener('click', () => togglePause(false));
document.getElementById('pause-btn').addEventListener('click', () => togglePause());

// ミュート
const ICON_SOUND_ON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"/></svg>';
const ICON_MUTED = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.5 12c0-1.77-1.02-3.29-2.5-4.03v2.21l2.45 2.45c.03-.2.05-.41.05-.63zm2.5 0c0 .94-.2 1.82-.54 2.64l1.51 1.51C20.63 14.91 21 13.5 21 12c0-4.28-2.99-7.86-7-8.77v2.06c2.89.86 5 3.54 5 6.71zM4.27 3L3 4.27 7.73 9H3v6h4l5 5v-6.73l4.25 4.25c-.67.52-1.42.93-2.25 1.18v2.06c1.38-.31 2.63-.95 3.69-1.81L19.73 21 21 19.73l-9-9L4.27 3zM12 4L9.91 6.09 12 8.18V4z"/></svg>';
document.getElementById('mute-btn').addEventListener('click', (e) => {
  Sound.muted = !Sound.muted;
  e.currentTarget.innerHTML = Sound.muted ? ICON_MUTED : ICON_SOUND_ON;
});

// バックグラウンドで自動一時停止
document.addEventListener('visibilitychange', () => {
  if (document.hidden) togglePause(true);
});

// 画面や文字サイズの変化に追従して盤面をフィット
window.addEventListener('resize', setupCanvas);
window.addEventListener('orientationchange', setupCanvas);
if ('ResizeObserver' in window) {
  const ro = new ResizeObserver(() => setupCanvas());
  ro.observe(canvas.parentElement);
}
if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', setupCanvas);
}

// =========================================================
//  Service Worker 登録(PWA・オフライン対応)
// =========================================================
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* 失敗しても通常どおり遊べる */ });
  });
}

// =========================================================
//  起動
// =========================================================
setupCanvas();
requestAnimationFrame(loop);
requestAnimationFrame(setupCanvas);
setTimeout(setupCanvas, 300);
window.addEventListener('load', setupCanvas);
