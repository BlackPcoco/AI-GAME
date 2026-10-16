// =============================================================
// game.js — 三線跑酷遊戲主程式
// =============================================================

// ── 透視渲染常數 ──────────────────────────────────────────────
const CANVAS_W = 480;
const CANVAS_H = 640;
const VANISH_X = 240;
const VANISH_Y = 192;
const BOTTOM_Y = 544;
const LANE_CENTERS_BOTTOM = [120, 240, 360];
const MIN_SCALE = 0.15;
const BASE_SPEED = 0.003;
const BASE_SPAWN_INTERVAL = 1500;
const COIN_VALUE = 50;
const COIN_SPAWN_RATE = 0.6;

// ── Canvas 與 2D Context 參照 ─────────────────────────────────
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// ── 遊戲狀態物件 ──────────────────────────────────────────────
const gameState = {
  status: 'IDLE',
  score: 0,
  speed: BASE_SPEED,
  elapsed: 0,
  playerLane: 1,
  playerX: 0,
  targetX: 0,
  laneChanging: false,
};

let obstacles = [];
let coins = [];
let spawnTimer = 0;
let lastTimestamp = 0;
let currentSpeed = BASE_SPEED;
let spawnInterval = BASE_SPAWN_INTERVAL;
let loopStarted = false;

// ── 透視投影函式 ──────────────────────────────────────────────
function projectToCanvas(lane, z) {
  const y = VANISH_Y + z * (BOTTOM_Y - VANISH_Y);
  const x = VANISH_X + (LANE_CENTERS_BOTTOM[lane] - VANISH_X) * z;
  const scale = MIN_SCALE + z * (1 - MIN_SCALE);
  return { x, y, scale };
}

// ── 繪製跑道背景（含透視線與橫向紋理） ───────────────────────────
function drawTrack(ctx) {
  // 深灰色底色
  ctx.fillStyle = '#2d2d2d';
  ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

  // 橫向虛線紋理（先畫，避免被邊界線蓋住）
  for (let z = 0.08; z <= 1.0; z += 0.08) {
    const y = VANISH_Y + z * (BOTTOM_Y - VANISH_Y);
    const xLeft  = VANISH_X + (0 - VANISH_X) * z;
    const xRight = VANISH_X + (CANVAS_W - VANISH_X) * z;
    const scale  = MIN_SCALE + z * (1 - MIN_SCALE);
    ctx.beginPath();
    ctx.moveTo(xLeft, y);
    ctx.lineTo(xRight, y);
    ctx.strokeStyle = 'rgba(255,255,255,0.15)';
    ctx.lineWidth = Math.max(0.5, scale * 2);
    ctx.stroke();
  }

  // 輔助：畫從消失點到指定底端點的直線
  function line(toX, toY, color, width) {
    ctx.beginPath();
    ctx.moveTo(VANISH_X, VANISH_Y);
    ctx.lineTo(toX, toY);
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  // 跑道外框邊界線（白色，線寬 2）
  line(0,        BOTTOM_Y, '#ffffff', 2);
  line(CANVAS_W, BOTTOM_Y, '#ffffff', 2);

  // 跑道分隔線（白色半透明，線寬 1）
  line(180, BOTTOM_Y, 'rgba(255,255,255,0.4)', 1);
  line(300, BOTTOM_Y, 'rgba(255,255,255,0.4)', 1);
}

// ── 繪製角色 ──────────────────────────────────────────────────
function drawPlayer(ctx) {
  const cx = gameState.playerX;
  const by = BOTTOM_Y;
  const bodyW = 40, bodyH = 60;
  const headW = 30, headH = 20;

  ctx.fillStyle = '#4fc3f7';
  ctx.fillRect(cx - bodyW / 2, by - bodyH, bodyW, bodyH);

  ctx.fillStyle = '#0288d1';
  ctx.fillRect(cx - headW / 2, by - bodyH - headH, headW, headH);
}

// ── 繪製障礙物 ────────────────────────────────────────────────
function drawObstacles(ctx) {
  const sorted = [...obstacles].sort((a, b) => a.z - b.z);
  for (const obs of sorted) {
    const { x, y, scale } = projectToCanvas(obs.lane, obs.z);
    const w = 60 * scale, h = 80 * scale;
    ctx.fillStyle = '#e53935';
    ctx.fillRect(x - w / 2, y - h, w, h);
  }
}

// ── 繪製金幣 ──────────────────────────────────────────────────
function drawCoins(ctx) {
  const sorted = [...coins].sort((a, b) => a.z - b.z);
  for (const coin of sorted) {
    if (coin.collected) continue;
    const { x, y, scale } = projectToCanvas(coin.lane, coin.z);
    const radius = 18 * scale;
    ctx.beginPath();
    ctx.arc(x, y - radius, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#ffd700';
    ctx.fill();
  }
}

// ── 繪製 HUD 分數 ──────────────────────────────────────────────
function drawHUD(ctx) {
  ctx.save();
  ctx.font = 'bold 24px monospace';
  ctx.fillStyle = 'white';
  ctx.textBaseline = 'top';
  ctx.fillText('分數：' + Math.floor(gameState.score), 16, 16);
  ctx.restore();
}

// ── 障礙物生成 ────────────────────────────────────────────────
function spawnWave() {
  // 避免堆疊過密：若已有 z < 0.3 的物件則跳過
  if (obstacles.some(obs => obs.z < 0.3)) return;

  // 隨機打亂跑道順序
  const lanes = [0, 1, 2].sort(() => Math.random() - 0.5);

  // 隨機 1 或 2 條障礙物跑道
  const count = Math.random() < 0.5 ? 1 : 2;
  const obstacleLanes = lanes.slice(0, count);

  for (const lane of obstacleLanes) {
    obstacles.push({ lane, z: 0 });
  }

  // 空跑道上可能生成金幣
  const emptyLanes = lanes.slice(count);
  if (emptyLanes.length > 0 && Math.random() < COIN_SPAWN_RATE) {
    const coinLane = emptyLanes[Math.floor(Math.random() * emptyLanes.length)];
    coins.push({ lane: coinLane, z: 0, collected: false });
  }
}

// ── 更新物件位置 ──────────────────────────────────────────────
function updateObjects(deltaTime) {
  const zDelta = currentSpeed * (deltaTime / 16.67);

  for (const obs  of obstacles) obs.z  += zDelta;
  for (const coin of coins)     coin.z += zDelta;

  obstacles = obstacles.filter(obs => obs.z < 1);
  coins     = coins.filter(coin => coin.z < 1);

  spawnTimer += deltaTime;
  if (spawnTimer >= spawnInterval) {
    spawnWave();
    spawnTimer = 0;
  }
}

// ── 碰撞判定 ──────────────────────────────────────────────────
function checkCollisions() {
  const lane = gameState.playerLane;

  for (const obs of obstacles) {
    if (obs.lane === lane && obs.z >= 0.85) {
      setGameOver();
      return;
    }
  }

  for (const coin of coins) {
    if (coin.lane === lane && coin.z >= 0.85 && !coin.collected) {
      coin.collected = true;
      gameState.score += COIN_VALUE;
    }
  }
}

// ── 遊戲結束 ──────────────────────────────────────────────────
function setGameOver() {
  gameState.status = 'GAME_OVER';
  document.getElementById('final-score').textContent = Math.floor(gameState.score);
  updateUI('GAME_OVER');
}

// ── 速度漸增 ──────────────────────────────────────────────────
function updateSpeed() {
  const speedMultiplier = Math.min(
    Math.pow(1.1, Math.floor(gameState.elapsed / 5000)),
    3.0
  );
  currentSpeed  = BASE_SPEED * speedMultiplier;
  spawnInterval = BASE_SPAWN_INTERVAL / speedMultiplier;
}

// ── UI 顯示切換 ───────────────────────────────────────────────
function updateUI(status) {
  const screenIdle     = document.getElementById('screen-idle');
  const screenGameOver = document.getElementById('screen-gameover');

  if (status === 'IDLE') {
    screenIdle.style.display     = 'flex';
    screenGameOver.style.display = 'none';
  } else if (status === 'PLAYING') {
    screenIdle.style.display     = 'none';
    screenGameOver.style.display = 'none';
  } else if (status === 'GAME_OVER') {
    screenIdle.style.display     = 'none';
    screenGameOver.style.display = 'flex';
  }
}

// ── 鍵盤輸入 ──────────────────────────────────────────────────
function handleKeyDown(e) {
  if (gameState.status !== 'PLAYING') return;
  if (gameState.laneChanging) return;

  if (e.key === 'ArrowLeft' && gameState.playerLane > 0) {
    gameState.playerLane  -= 1;
    gameState.targetX      = LANE_CENTERS_BOTTOM[gameState.playerLane];
    gameState.laneChanging = true;
    e.preventDefault();
  } else if (e.key === 'ArrowRight' && gameState.playerLane < 2) {
    gameState.playerLane  += 1;
    gameState.targetX      = LANE_CENTERS_BOTTOM[gameState.playerLane];
    gameState.laneChanging = true;
    e.preventDefault();
  }
}

// ── 遊戲主循環 ────────────────────────────────────────────────
function gameLoop(timestamp) {
  const deltaTime = Math.min(timestamp - lastTimestamp, 100);
  lastTimestamp = timestamp;

  if (gameState.status === 'PLAYING') {
    // Update
    gameState.elapsed += deltaTime;
    updateSpeed();
    updateObjects(deltaTime);

    // 換道動畫插值（200ms 完成）
    const diff = gameState.targetX - gameState.playerX;
    gameState.playerX += diff * Math.min(deltaTime / 200, 1);
    if (Math.abs(diff) < 1) {
      gameState.playerX      = gameState.targetX;
      gameState.laneChanging = false;
    }

    checkCollisions();

    // 基礎計分（每幀 +1，約每秒 +60）
    if (gameState.status === 'PLAYING') {
      gameState.score += 1;
    }

    // Draw
    drawTrack(ctx);
    drawCoins(ctx);
    drawObstacles(ctx);
    drawPlayer(ctx);
    drawHUD(ctx);
  }

  requestAnimationFrame(gameLoop);
}

// ── 開始遊戲 ──────────────────────────────────────────────────
function startGame() {
  gameState.status       = 'PLAYING';
  gameState.score        = 0;
  gameState.elapsed      = 0;
  gameState.playerLane   = 1;
  gameState.playerX      = LANE_CENTERS_BOTTOM[1];
  gameState.targetX      = LANE_CENTERS_BOTTOM[1];
  gameState.laneChanging = false;

  obstacles     = [];
  coins         = [];
  spawnTimer    = 0;
  currentSpeed  = BASE_SPEED;
  spawnInterval = BASE_SPAWN_INTERVAL;

  updateUI('PLAYING');

  if (!loopStarted) {
    loopStarted   = true;
    lastTimestamp = performance.now();
    requestAnimationFrame(gameLoop);
  }
}

// ── 頁面初始化與事件綁定 ─────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  document.getElementById('btn-start').addEventListener('click', startGame);
  document.getElementById('btn-restart').addEventListener('click', startGame);
  document.addEventListener('keydown', handleKeyDown);

  updateUI('IDLE');
  drawTrack(ctx);
});
