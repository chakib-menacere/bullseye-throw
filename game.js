const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// Logical drawing resolution. The canvas is scaled via CSS/DPR to fit any
// screen size, but every draw call below works in this fixed coordinate space.
const WIDTH = 800;
const HEIGHT = 600;
const dpr = window.devicePixelRatio || 1;
canvas.width = WIDTH * dpr;
canvas.height = HEIGHT * dpr;
ctx.scale(dpr, dpr);

const HAND_X = WIDTH / 2;
const HAND_Y = HEIGHT - 40;
const MAX_DARTS = 10;
const THROW_DURATION = 250;
const RESPAWN_DELAY = 1500;
const DART_COST = 15;
const BUY_BUTTON = { x: WIDTH / 2 - 120, y: HEIGHT / 2 - 40, w: 240, h: 80 };
const RESET_BUTTON = { x: WIDTH / 2 - 90, y: BUY_BUTTON.y + BUY_BUTTON.h + 65, w: 180, h: 38 };
const SHOP_BUTTON = { x: WIDTH - 110, y: 44, w: 90, h: 44 };
const LEADERBOARD_BUTTON = { x: WIDTH - 210, y: 44, w: 90, h: 44 };
const LEADERBOARD_SIZE = 10;
const PLAYER_NAME_KEY = 'bullseyePlayerName';
const PROGRESS_KEY = 'bullseyeProgress';

// Throwing arm animation: a windup (pull back), a release (dart leaves the
// hand partway through the forward swing), then an easing recovery to idle.
const ARM_ANIM_DURATION = 480;
const RELEASE_FRACTION = 0.5;
const ARM_KEYFRAMES = [
  { t: 0, o: 0 },
  { t: 0.32, o: -0.55 },
  { t: RELEASE_FRACTION, o: -0.1 },
  { t: 0.72, o: 0.4 },
  { t: 1, o: 0 },
];

// Ring thresholds as a fraction of target radius, ordered inner to outer.
const RING_SCORES = [
  { t: 0.12, points: 50 },
  { t: 0.25, points: 30 },
  { t: 0.5, points: 20 },
  { t: 0.75, points: 10 },
  { t: 1.0, points: 5 },
];

let mouse = { x: WIDTH / 2, y: HEIGHT / 2 };
let score = 0;
let money = 0;
let dartsLeft = MAX_DARTS;
let state = 'playing'; // 'playing' | 'shop' | 'leaderboard' | 'gameover'
let armAnim = null; // { startTime, toX, toY, released }
let flyingDart = null;
let popups = [];
let targets = [];
let lastTime = 0;
let leaderboard = [];
let leaderboardStatus = 'idle'; // 'idle' | 'loading' | 'ready' | 'error'

class Target {
  constructor(baseX, baseY, radius, moves) {
    this.baseX = baseX;
    this.baseY = baseY;
    this.radius = radius;
    this.moves = moves;
    this.phase = Math.random() * Math.PI * 2;
    this.speed = 1.2 + Math.random() * 0.8;
    this.range = 90;
    this.alive = true;
    this.respawnAt = 0;
  }

  get x() {
    return this.moves ? this.baseX + Math.sin(this.phase) * this.range : this.baseX;
  }

  get y() {
    return this.baseY;
  }

  update(dt, time) {
    if (this.moves) this.phase += dt * 0.001 * this.speed;
    if (!this.alive && time > this.respawnAt) this.alive = true;
  }

  draw(ctx) {
    if (!this.alive) return;
    const colors = ['#c72c2c', '#f2f2f2', '#c72c2c', '#f2f2f2', '#c72c2c'];
    for (let i = 0; i < colors.length; i++) {
      const r = this.radius * (1 - i / colors.length);
      ctx.beginPath();
      ctx.arc(this.x, this.y, r, 0, Math.PI * 2);
      ctx.fillStyle = colors[i];
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.radius, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  scoreAt(px, py) {
    if (!this.alive) return null;
    const t = Math.hypot(px - this.x, py - this.y) / this.radius;
    if (t > 1) return null;
    return RING_SCORES.find((r) => t <= r.t).points;
  }
}

function spawnTargets() {
  targets = [
    new Target(150, 180, 55, false),
    new Target(400, 140, 45, true),
    new Target(650, 200, 55, false),
    new Target(280, 330, 40, true),
    new Target(560, 340, 50, false),
  ];
}

function resetGame() {
  score = 0;
  money = 0;
  dartsLeft = MAX_DARTS;
  state = 'playing';
  armAnim = null;
  flyingDart = null;
  popups = [];
  spawnTargets();
}

function startNewRound() {
  score = 0;
  dartsLeft = MAX_DARTS;
  state = 'playing';
  armAnim = null;
  flyingDart = null;
  popups = [];
  spawnTargets();
  saveProgress();
}

function saveProgress() {
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify({ score, money, dartsLeft }));
  } catch (err) {
    console.error('Failed to save progress', err);
  }
}

function loadProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (err) {
    console.error('Failed to load progress', err);
    return null;
  }
}

function resetProgress() {
  const ok = window.confirm('Reset all local progress (score, money, darts) and your saved name for a new player? This cannot be undone.');
  if (!ok) return;
  localStorage.removeItem(PROGRESS_KEY);
  localStorage.removeItem(PLAYER_NAME_KEY);
  resetGame();
  saveProgress();
  setTimeout(() => ensurePlayerName('New player! Enter your name for the leaderboard:'), 50);
}

function addPopup(x, y, text, color) {
  popups.push({ x, y, text, color, life: 1 });
}

function pointInRect(px, py, rect) {
  return px >= rect.x && px <= rect.x + rect.w && py >= rect.y && py <= rect.y + rect.h;
}

function toggleShop() {
  if (state === 'shop') {
    state = dartsLeft > 0 ? 'playing' : 'gameover';
  } else if ((state === 'playing' || state === 'gameover') && !armAnim) {
    state = 'shop';
  }
}

function toggleLeaderboard() {
  if (state === 'leaderboard') {
    state = dartsLeft > 0 ? 'playing' : 'gameover';
  } else if ((state === 'playing' || state === 'gameover') && !armAnim) {
    state = 'leaderboard';
    fetchLeaderboard();
  }
}

async function fetchLeaderboard() {
  if (!leaderboardDb) {
    leaderboardStatus = 'error';
    return;
  }
  leaderboardStatus = 'loading';
  try {
    const snap = await leaderboardDb.collection('scores').orderBy('score', 'desc').limit(LEADERBOARD_SIZE).get();
    leaderboard = snap.docs.map((doc) => doc.data());
    leaderboardStatus = 'ready';
  } catch (err) {
    console.error('Failed to load leaderboard', err);
    leaderboardStatus = 'error';
  }
}

async function submitScore(name, finalScore) {
  if (!leaderboardDb) return;
  try {
    await leaderboardDb.collection('scores').add({
      name,
      score: finalScore,
      createdAt: firebase.firestore.FieldValue.serverTimestamp(),
    });
  } catch (err) {
    console.error('Failed to submit score', err);
  }
}

function ensurePlayerName(promptText) {
  let name = localStorage.getItem(PLAYER_NAME_KEY);
  if (!name) {
    name = (window.prompt(promptText, '') || '').trim().slice(0, 20);
    if (!name) name = 'Anonymous';
    localStorage.setItem(PLAYER_NAME_KEY, name);
  }
  return name;
}

function handleGameOver() {
  if (!leaderboardDb) return;
  const name = ensurePlayerName('Game over! Enter your name for the leaderboard:');
  submitScore(name, score).then(fetchLeaderboard);
}

function buyDart() {
  if (money < DART_COST) {
    addPopup(WIDTH / 2, HEIGHT / 2 - 40, 'Not enough money', '#ff5c5c');
    return;
  }
  money -= DART_COST;
  dartsLeft++;
  addPopup(WIDTH / 2, HEIGHT / 2 - 40, '+1 dart', '#7CFC00');
  saveProgress();
}

function startThrow(targetX, targetY) {
  armAnim = { startTime: performance.now(), toX: targetX, toY: targetY, released: false };
  dartsLeft--;
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smoothstep(t) {
  const c = Math.min(Math.max(t, 0), 1);
  return c * c * (3 - 2 * c);
}

function armSwingOffset(progress) {
  for (let i = 0; i < ARM_KEYFRAMES.length - 1; i++) {
    const a = ARM_KEYFRAMES[i];
    const b = ARM_KEYFRAMES[i + 1];
    if (progress <= b.t) {
      return lerp(a.o, b.o, smoothstep((progress - a.t) / (b.t - a.t)));
    }
  }
  return 0;
}

function resolveThrow(toX, toY) {
  let hit = null;
  for (const target of targets) {
    const points = target.scoreAt(toX, toY);
    if (points !== null) {
      hit = { target, points };
      break;
    }
  }

  if (hit) {
    score += hit.points;
    money += hit.points;
    addPopup(toX, toY, `+${hit.points}`, '#ffd23f');
    hit.target.alive = false;
    hit.target.respawnAt = performance.now() + RESPAWN_DELAY;
  } else {
    addPopup(toX, toY, 'MISS', '#ff5c5c');
  }

  if (dartsLeft <= 0) {
    state = 'gameover';
    handleGameOver();
  }
  saveProgress();
}

function drawBackground() {
  const grad = ctx.createLinearGradient(0, 0, 0, HEIGHT);
  grad.addColorStop(0, '#3a4a5a');
  grad.addColorStop(1, '#22303c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.fillStyle = '#2a3a2a';
  ctx.fillRect(0, HEIGHT - 80, WIDTH, 80);
}

function drawHandAndDart(aimAngle, swingOffset, holdingDart) {
  ctx.save();
  ctx.translate(HAND_X, HAND_Y);
  ctx.rotate(aimAngle * 0.15 + swingOffset);

  const skin = ctx.createLinearGradient(-20, -40, 20, 40);
  skin.addColorStop(0, '#f2bd8f');
  skin.addColorStop(1, '#c98a54');

  // Sleeve, tapering from off-screen up to the wrist.
  ctx.fillStyle = '#3d5a80';
  ctx.beginPath();
  ctx.moveTo(-24, 90);
  ctx.lineTo(24, 90);
  ctx.lineTo(15, 8);
  ctx.lineTo(-15, 8);
  ctx.closePath();
  ctx.fill();

  // Wrist and palm.
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, 12, 16, 24, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, -12, 18, 22, 0, 0, Math.PI * 2);
  ctx.fill();

  // Thumb.
  ctx.save();
  ctx.rotate(holdingDart ? -0.85 : -1.05);
  ctx.fillStyle = skin;
  ctx.beginPath();
  ctx.ellipse(0, -18, 6.5, 15, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  if (holdingDart) {
    // Dart shaft pinched between the fingers, held back and angled up.
    ctx.save();
    ctx.rotate(-0.6);
    ctx.fillStyle = '#d6d6d6';
    ctx.fillRect(-3, -72, 6, 46);
    ctx.fillStyle = '#c72c2c';
    ctx.beginPath();
    ctx.moveTo(-3, -72);
    ctx.lineTo(3, -72);
    ctx.lineTo(0, -84);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Fingers curled over the shaft.
    const fingerAngles = [-0.5, -0.25, 0, 0.25];
    for (const fa of fingerAngles) {
      ctx.save();
      ctx.rotate(fa);
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(0, -30, 5.5, 13, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  } else {
    // Open hand, fingers splayed forward after the release.
    const fingerAngles = [-0.45, -0.16, 0.13, 0.42];
    for (const fa of fingerAngles) {
      ctx.save();
      ctx.rotate(fa);
      ctx.fillStyle = skin;
      ctx.beginPath();
      ctx.ellipse(0, -34, 5, 17, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  ctx.restore();
}

function drawFlyingDart(time) {
  if (!flyingDart) return;
  const t = Math.min((time - flyingDart.startTime) / THROW_DURATION, 1);
  const x = flyingDart.fromX + (flyingDart.toX - flyingDart.fromX) * t;
  const y = flyingDart.fromY + (flyingDart.toY - flyingDart.fromY) * t - Math.sin(t * Math.PI) * 60;
  const angle = Math.atan2(flyingDart.toY - flyingDart.fromY, flyingDart.toX - flyingDart.fromX);

  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = '#d6d6d6';
  ctx.fillRect(-12, -3, 24, 6);
  ctx.fillStyle = '#c72c2c';
  ctx.beginPath();
  ctx.moveTo(12, -3);
  ctx.lineTo(12, 3);
  ctx.lineTo(20, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawCrosshair() {
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.7)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(mouse.x, mouse.y, 14, 0, Math.PI * 2);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(mouse.x - 20, mouse.y);
  ctx.lineTo(mouse.x - 8, mouse.y);
  ctx.moveTo(mouse.x + 8, mouse.y);
  ctx.lineTo(mouse.x + 20, mouse.y);
  ctx.moveTo(mouse.x, mouse.y - 20);
  ctx.lineTo(mouse.x, mouse.y - 8);
  ctx.moveTo(mouse.x, mouse.y + 8);
  ctx.lineTo(mouse.x, mouse.y + 20);
  ctx.stroke();
}

function drawPopups() {
  for (const p of popups) {
    ctx.globalAlpha = p.life;
    ctx.fillStyle = p.color;
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(p.text, p.x, p.y - (1 - p.life) * 40);
  }
  ctx.globalAlpha = 1;
  ctx.textAlign = 'left';
}

function drawHUD() {
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'left';
  ctx.fillText(`Score: ${score}`, 20, 34);

  ctx.fillStyle = '#ffd23f';
  ctx.font = 'bold 18px Arial';
  ctx.fillText(`Money: $${money}`, 20, 60);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 22px Arial';
  ctx.textAlign = 'right';
  ctx.fillText(`Darts: ${dartsLeft}`, WIDTH - 20, 34);

  ctx.textAlign = 'left';
  drawShopButton();
  drawLeaderboardButton();
}

function drawButton(rect, label) {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.55)';
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 16px Arial';
  ctx.textAlign = 'center';
  ctx.fillText(label, rect.x + rect.w / 2, rect.y + rect.h / 2 + 5);
  ctx.textAlign = 'left';
}

function drawShopButton() {
  drawButton(SHOP_BUTTON, state === 'shop' ? 'Close' : 'Shop');
}

function drawLeaderboardButton() {
  drawButton(LEADERBOARD_BUTTON, state === 'leaderboard' ? 'Close' : '🏆');
}

function drawLeaderboard() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 36px Arial';
  ctx.fillText('Leaderboard', WIDTH / 2, 90);

  ctx.font = '18px Arial';
  if (leaderboardStatus === 'error') {
    ctx.fillStyle = '#ff5c5c';
    ctx.fillText('Leaderboard not set up yet', WIDTH / 2, 150);
  } else if (leaderboardStatus === 'loading') {
    ctx.fillStyle = '#cccccc';
    ctx.fillText('Loading...', WIDTH / 2, 150);
  } else if (leaderboard.length === 0) {
    ctx.fillStyle = '#cccccc';
    ctx.fillText('No scores yet -- be the first!', WIDTH / 2, 150);
  } else {
    leaderboard.forEach((entry, i) => {
      const y = 140 + i * 36;
      ctx.fillStyle = i < 3 ? '#ffd23f' : '#ffffff';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'left';
      ctx.fillText(`${i + 1}. ${entry.name}`, WIDTH / 2 - 160, y);
      ctx.textAlign = 'right';
      ctx.fillText(`${entry.score}`, WIDTH / 2 + 160, y);
    });
  }

  ctx.textAlign = 'center';
  ctx.font = '16px Arial';
  ctx.fillStyle = '#cccccc';
  ctx.fillText('Tap Close (or press L) to leave', WIDTH / 2, HEIGHT - 40);

  ctx.textAlign = 'left';
  drawShopButton();
  drawLeaderboardButton();
}

function drawShop() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 40px Arial';
  ctx.fillText('Shop', WIDTH / 2, HEIGHT / 2 - 100);

  ctx.font = 'bold 22px Arial';
  ctx.fillStyle = '#ffd23f';
  ctx.fillText(`Money: $${money}`, WIDTH / 2, HEIGHT / 2 - 60);

  const canAfford = money >= DART_COST;
  ctx.fillStyle = canAfford ? '#2e8b57' : '#555555';
  ctx.fillRect(BUY_BUTTON.x, BUY_BUTTON.y, BUY_BUTTON.w, BUY_BUTTON.h);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.strokeRect(BUY_BUTTON.x, BUY_BUTTON.y, BUY_BUTTON.w, BUY_BUTTON.h);

  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 18px Arial';
  ctx.fillText(`Buy Dart - $${DART_COST}`, WIDTH / 2, BUY_BUTTON.y + BUY_BUTTON.h / 2 + 6);

  ctx.font = '16px Arial';
  ctx.fillStyle = '#cccccc';
  ctx.fillText('Tap Close (or press S) to leave', WIDTH / 2, BUY_BUTTON.y + BUY_BUTTON.h + 40);

  ctx.fillStyle = 'rgba(120, 30, 30, 0.6)';
  ctx.fillRect(RESET_BUTTON.x, RESET_BUTTON.y, RESET_BUTTON.w, RESET_BUTTON.h);
  ctx.strokeStyle = '#ff8080';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(RESET_BUTTON.x, RESET_BUTTON.y, RESET_BUTTON.w, RESET_BUTTON.h);
  ctx.fillStyle = '#ffffff';
  ctx.font = '14px Arial';
  ctx.fillText('New Player / Reset', RESET_BUTTON.x + RESET_BUTTON.w / 2, RESET_BUTTON.y + RESET_BUTTON.h / 2 + 5);

  ctx.textAlign = 'left';
  drawShopButton();
  drawLeaderboardButton();
}

function drawVignette() {
  const grad = ctx.createRadialGradient(WIDTH / 2, HEIGHT / 2, HEIGHT / 3, WIDTH / 2, HEIGHT / 2, HEIGHT / 1.1);
  grad.addColorStop(0, 'rgba(0, 0, 0, 0)');
  grad.addColorStop(1, 'rgba(0, 0, 0, 0.55)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
}

function drawGameOver() {
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  ctx.fillRect(0, 0, WIDTH, HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.font = 'bold 48px Arial';
  ctx.fillText('Game Over', WIDTH / 2, HEIGHT / 2 - 30);
  ctx.font = 'bold 28px Arial';
  ctx.fillText(`Final Score: ${score}`, WIDTH / 2, HEIGHT / 2 + 20);
  ctx.font = '20px Arial';
  ctx.fillText('Click to play again', WIDTH / 2, HEIGHT / 2 + 60);
  ctx.textAlign = 'left';
}

function update(dt, time) {
  for (const target of targets) target.update(dt, time);

  popups.forEach((p) => (p.life -= dt * 0.0015));
  popups = popups.filter((p) => p.life > 0);

  if (armAnim) {
    const progress = (time - armAnim.startTime) / ARM_ANIM_DURATION;
    if (!armAnim.released && progress >= RELEASE_FRACTION) {
      armAnim.released = true;
      flyingDart = { fromX: HAND_X, fromY: HAND_Y, toX: armAnim.toX, toY: armAnim.toY, startTime: time };
    }
    if (progress >= 1) armAnim = null;
  }

  if (flyingDart && time - flyingDart.startTime >= THROW_DURATION) {
    resolveThrow(flyingDart.toX, flyingDart.toY);
    flyingDart = null;
  }
}

function draw(time) {
  drawBackground();
  for (const target of targets) target.draw(ctx);
  drawPopups();

  const aimAngle = Math.atan2(mouse.y - HAND_Y, mouse.x - HAND_X);
  const swingOffset = armAnim ? armSwingOffset((time - armAnim.startTime) / ARM_ANIM_DURATION) : 0;
  drawHandAndDart(aimAngle, swingOffset, !flyingDart);
  drawFlyingDart(time);

  drawVignette();
  drawHUD();
  drawCrosshair();
  if (state === 'gameover') drawGameOver();
  if (state === 'shop') drawShop();
  if (state === 'leaderboard') drawLeaderboard();
}

function loop(time) {
  const dt = lastTime ? time - lastTime : 0;
  lastTime = time;
  update(dt, time);
  draw(time);
  requestAnimationFrame(loop);
}

function eventToCanvasPos(clientX, clientY) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) * (WIDTH / rect.width),
    y: (clientY - rect.top) * (HEIGHT / rect.height),
  };
}

function handleInput(x, y) {
  if (pointInRect(x, y, SHOP_BUTTON)) {
    toggleShop();
    return;
  }
  if (pointInRect(x, y, LEADERBOARD_BUTTON)) {
    toggleLeaderboard();
    return;
  }
  if (state === 'shop') {
    if (pointInRect(x, y, BUY_BUTTON)) buyDart();
    else if (pointInRect(x, y, RESET_BUTTON)) resetProgress();
    return;
  }
  if (state === 'leaderboard') return;
  if (state === 'gameover') {
    startNewRound();
    return;
  }
  if (armAnim || flyingDart || dartsLeft <= 0) return;
  startThrow(x, y);
}

canvas.addEventListener('mousemove', (e) => {
  const pos = eventToCanvasPos(e.clientX, e.clientY);
  mouse.x = pos.x;
  mouse.y = pos.y;
});

canvas.addEventListener('click', () => handleInput(mouse.x, mouse.y));

canvas.addEventListener(
  'touchstart',
  (e) => {
    e.preventDefault();
    const touch = e.changedTouches[0];
    const pos = eventToCanvasPos(touch.clientX, touch.clientY);
    mouse.x = pos.x;
    mouse.y = pos.y;
    handleInput(pos.x, pos.y);
  },
  { passive: false }
);

window.addEventListener('keydown', (e) => {
  const key = e.key.toLowerCase();
  if (key === 's') toggleShop();
  if (key === 'l') toggleLeaderboard();
});

function fitCanvas() {
  const aspect = WIDTH / HEIGHT;
  let w = window.innerWidth;
  let h = w / aspect;
  if (h > window.innerHeight) {
    h = window.innerHeight;
    w = h * aspect;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

window.addEventListener('resize', fitCanvas);
window.addEventListener('orientationchange', fitCanvas);
fitCanvas();

const savedProgress = loadProgress();
if (savedProgress) {
  score = typeof savedProgress.score === 'number' ? savedProgress.score : 0;
  money = typeof savedProgress.money === 'number' ? savedProgress.money : 0;
  dartsLeft = typeof savedProgress.dartsLeft === 'number' ? savedProgress.dartsLeft : MAX_DARTS;
  state = dartsLeft > 0 ? 'playing' : 'gameover';
  armAnim = null;
  flyingDart = null;
  popups = [];
  spawnTargets();
} else {
  resetGame();
}
saveProgress();
requestAnimationFrame(loop);
setTimeout(() => ensurePlayerName('Welcome! Enter your name for the leaderboard:'), 50);
