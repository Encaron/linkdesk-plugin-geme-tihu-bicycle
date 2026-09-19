/* eslint-disable linkdesk/no-hardcoded-hex -- 内容画布：游戏画面是美术本体（昼夜循环的海边场景），配色自含、刻意不随壳主题走——SDK 约定画布类文件整文件豁免 */
/**
 * 鹈鹕骑行——Canvas 渲染。全部美术矢量绘制：昼夜循环的海边公路 + 鹈鹕骑车。
 * 游戏画面是独立美术（自带配色，不随壳主题走——这正是设计意图）；
 * HUD / 覆盖层等界面铬件在 index.css 里走主题变量。
 * 只读 GameState，零副作用。
 */

import {
  GROUND_Y,
  PLAYER_X,
  WHEEL_R,
  WORLD_H,
  gullBob,
  pickupY,
} from "./engine";
import { mulberry32 } from "./engine";
import type { GameState, Obstacle, Particle, Pickup, Prop } from "./types";

type RGB = [number, number, number];

interface Palette {
  skyTop: RGB;
  skyBot: RGB;
  seaHi: RGB;
  seaLo: RGB;
  sand: RGB;
  road: RGB;
}

const DAY: Palette = {
  skyTop: [63, 162, 247], skyBot: [201, 239, 255],
  seaHi: [46, 155, 224], seaLo: [121, 205, 244],
  sand: [242, 212, 138], road: [86, 96, 114],
};
const SUNSET: Palette = {
  skyTop: [126, 107, 196], skyBot: [255, 193, 120],
  seaHi: [72, 96, 158], seaLo: [150, 126, 180],
  sand: [214, 158, 110], road: [74, 72, 92],
};
const NIGHT: Palette = {
  skyTop: [16, 28, 63], skyBot: [53, 80, 126],
  seaHi: [22, 48, 94], seaLo: [46, 80, 134],
  sand: [110, 94, 142], road: [42, 49, 72],
};
const DAWN: Palette = {
  skyTop: [138, 123, 200], skyBot: [255, 217, 168],
  seaHi: [70, 104, 164], seaLo: [140, 150, 196],
  sand: [226, 182, 130], road: [70, 76, 96],
};

const STOPS: { p: number; c: Palette }[] = [
  { p: 0, c: DAY }, { p: 0.36, c: SUNSET }, { p: 0.52, c: NIGHT },
  { p: 0.8, c: NIGHT }, { p: 0.93, c: DAWN }, { p: 1, c: DAY },
];

const smooth01 = (v: number) => {
  const k = Math.min(1, Math.max(0, v));
  return k * k * (3 - 2 * k);
};
const lerpRGB = (a: RGB, b: RGB, k: number): RGB => [
  a[0] + (b[0] - a[0]) * k,
  a[1] + (b[1] - a[1]) * k,
  a[2] + (b[2] - a[2]) * k,
];
const rgb = (c: RGB, alpha = 1) =>
  alpha >= 1 ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;
const mix = (a: RGB, b: RGB, k: number) => lerpRGB(a, b, k);

function palette(dayT: number): Palette {
  for (let i = 0; i < STOPS.length - 1; i++) {
    const a = STOPS[i];
    const b = STOPS[i + 1];
    if (dayT >= a.p && dayT <= b.p) {
      const k = smooth01((dayT - a.p) / (b.p - a.p));
      return {
        skyTop: mix(a.c.skyTop, b.c.skyTop, k),
        skyBot: mix(a.c.skyBot, b.c.skyBot, k),
        seaHi: mix(a.c.seaHi, b.c.seaHi, k),
        seaLo: mix(a.c.seaLo, b.c.seaLo, k),
        sand: mix(a.c.sand, b.c.sand, k),
        road: mix(a.c.road, b.c.road, k),
      };
    }
  }
  return DAY;
}

// ── 预生成：星星与云（固定种子，稳定构图） ──
const STAR_RNG = mulberry32(7);
const STARS = Array.from({ length: 70 }, () => ({
  fx: STAR_RNG(),
  fy: STAR_RNG() * 0.55,
  r: 0.6 + STAR_RNG() * 1.1,
  tw: STAR_RNG() * Math.PI * 2,
}));
const CLOUD_RNG = mulberry32(11);
interface Cloud { layer: 0 | 1; fx: number; y: number; s: number; spd: number }
const CLOUDS: Cloud[] = Array.from({ length: 11 }, (_, i) => ({
  layer: i < 6 ? 0 : 1,
  fx: CLOUD_RNG(),
  y: 56 + CLOUD_RNG() * 150,
  s: (i < 6 ? 0.6 : 0.95) + CLOUD_RNG() * 0.7,
  spd: i < 6 ? 0.1 : 0.22,
}));

const SEA_TOP = 302;
const SAND_TOP = 432;

/** 主入口：把世界画进 (0,0)-(cssW,cssH)。内部以 WORLD_H 为逻辑高度等比缩放。 */
export function drawWorld(ctx: CanvasRenderingContext2D, s: GameState, cssW: number, cssH: number): void {
  if (cssW <= 0 || cssH <= 0) return;
  const scale = cssH / WORLD_H;
  const wW = cssW / scale;
  ctx.save();
  ctx.scale(scale, scale);
  if (s.shake > 0) {
    ctx.translate((Math.random() - 0.5) * s.shake * 16, (Math.random() - 0.5) * s.shake * 12);
  }

  const pal = palette(s.dayT);
  const nightF = smooth01((s.dayT - 0.4) / 0.12) * (1 - smooth01((s.dayT - 0.8) / 0.1));

  // ── 天空 ──
  const sky = ctx.createLinearGradient(0, 0, 0, SAND_TOP);
  sky.addColorStop(0, rgb(pal.skyTop));
  sky.addColorStop(1, rgb(pal.skyBot));
  ctx.fillStyle = sky;
  ctx.fillRect(-8, -8, wW + 16, WORLD_H + 16);

  // ── 星星 ──
  if (nightF > 0.02) {
    for (const st of STARS) {
      ctx.globalAlpha = nightF * (0.35 + 0.65 * Math.abs(Math.sin(s.time * 1.4 + st.tw)));
      ctx.fillStyle = "#EAF2FF";
      ctx.beginPath();
      ctx.arc(st.fx * wW, st.fy * 270, st.r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  // ── 太阳 / 月亮 ──
  const sunA = Math.min(1, Math.max(0, 1 - smooth01((s.dayT - 0.3) / 0.15) + smooth01((s.dayT - 0.9) / 0.1)));
  if (sunA > 0.02) {
    const sx = wW * 0.76;
    const sy = 108 + 70 * smooth01((s.dayT > 0.5 ? 1 : s.dayT) / 0.45);
    const glow = ctx.createRadialGradient(sx, sy, 8, sx, sy, 56);
    glow.addColorStop(0, `rgba(255,236,170,${0.5 * sunA})`);
    glow.addColorStop(1, "rgba(255,236,170,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(sx - 60, sy - 60, 120, 120);
    ctx.fillStyle = `rgba(255,233,168,${sunA})`;
    ctx.beginPath();
    ctx.arc(sx, sy, 22, 0, Math.PI * 2);
    ctx.fill();
  }
  const moonA = smooth01((s.dayT - 0.5) / 0.1) * (1 - smooth01((s.dayT - 0.86) / 0.08));
  if (moonA > 0.02) {
    const mx = wW * 0.22;
    const my = 104;
    ctx.globalAlpha = moonA;
    ctx.fillStyle = "#E8EEF7";
    ctx.beginPath();
    ctx.arc(mx, my, 18, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = rgb(pal.skyTop, 0.9);
    ctx.beginPath();
    ctx.arc(mx + 7, my - 5, 15, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // ── 云（两层视差） ──
  const cloudWhite = mix([255, 255, 255], [148, 164, 204], nightF);
  const span = wW + 520;
  for (const c of CLOUDS) {
    const x = (((c.fx * span - s.distance * c.spd) % span) + span) % span - 260;
    drawCloud(ctx, x, c.y, c.s, rgb(cloudWhite, c.layer === 0 ? 0.55 : 0.85));
  }

  // ── 海 ──
  const sea = ctx.createLinearGradient(0, SEA_TOP, 0, SAND_TOP);
  sea.addColorStop(0, rgb(pal.seaHi));
  sea.addColorStop(1, rgb(pal.seaLo));
  ctx.fillStyle = sea;
  ctx.fillRect(-8, SEA_TOP, wW + 16, SAND_TOP - SEA_TOP);
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  ctx.fillRect(-8, SEA_TOP, wW + 16, 2);
  // 碎浪
  ctx.strokeStyle = rgb(mix([255, 255, 255], pal.seaLo, 0.3), 0.35);
  ctx.lineWidth = 2.5;
  ctx.lineCap = "round";
  for (let i = 0; i < 9; i++) {
    const y = SEA_TOP + 16 + i * 13;
    const x = ((i * 167 + s.time * 24) % (wW + 120)) - 60;
    const len = 26 + ((i * 53) % 40);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + len / 2, y - 2.5, x + len, y);
    ctx.stroke();
  }

  // ── 沙滩 ──
  ctx.fillStyle = rgb(pal.sand);
  ctx.fillRect(-8, SAND_TOP, wW + 16, GROUND_Y - SAND_TOP);
  ctx.fillStyle = "rgba(0,0,0,0.08)";
  ctx.fillRect(-8, SAND_TOP, wW + 16, 4);

  // ── 公路 ──
  ctx.fillStyle = rgb(pal.road);
  ctx.fillRect(-8, GROUND_Y, wW + 16, WORLD_H - GROUND_Y + 8);
  ctx.fillStyle = rgb(mix(pal.road, [255, 255, 255], 0.25));
  ctx.fillRect(-8, GROUND_Y, wW + 16, 3);
  // 中央虚线
  ctx.fillStyle = "rgba(255,255,255,0.55)";
  const dashW = 46;
  const gap = 34;
  let dx = -((s.distance % (dashW + gap)) + dashW + gap) % (dashW + gap);
  for (; dx < wW + dashW; dx += dashW + gap) {
    ctx.fillRect(dx, GROUND_Y + 36, dashW, 5);
  }
  // 边线
  ctx.fillStyle = "rgba(255,255,255,0.22)";
  ctx.fillRect(-8, GROUND_Y + 8, wW + 16, 2);
  ctx.fillRect(-8, WORLD_H - 5, wW + 16, 2);

  // ── 路边装饰 ──
  for (const pr of s.props) drawProp(ctx, pr);

  // ── 鱼 / 路障 / 鹈鹕 ──
  for (const p of s.pickups) drawPickup(ctx, p);
  for (const o of s.obstacles) drawObstacle(ctx, o);
  drawPlayer(ctx, s);

  // ── 粒子 / 飘字 ──
  for (const pt of s.particles) drawParticle(ctx, pt);
  for (const f of s.floats) {
    const k = f.t / f.life;
    ctx.globalAlpha = 1 - k;
    ctx.font = "800 22px 'Segoe UI', 'Microsoft YaHei UI', sans-serif";
    ctx.textAlign = "center";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(20,30,45,0.4)";
    ctx.strokeText(f.text, f.x, f.y);
    ctx.fillStyle = f.text.includes("60") ? "#FFD35C" : "#FFFFFF";
    ctx.fillText(f.text, f.x, f.y);
    ctx.globalAlpha = 1;
  }

  // ── 夜幕（整体压暗，玩家也在其中）──
  if (nightF > 0.01) {
    ctx.fillStyle = `rgba(16,24,64,${(nightF * 0.24).toFixed(3)})`;
    ctx.fillRect(-8, -8, wW + 16, WORLD_H + 16);
  }

  // ── 撞击白闪 ──
  if (s.flash > 0) {
    ctx.fillStyle = `rgba(255,255,255,${(s.flash * 0.55).toFixed(3)})`;
    ctx.fillRect(-8, -8, wW + 16, WORLD_H + 16);
  }

  ctx.restore();
}

// ── 各部件 ──

function drawCloud(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, fill: string): void {
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.ellipse(x, y, 30 * s, 14 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x - 22 * s, y + 5 * s, 18 * s, 10 * s, 0, 0, Math.PI * 2);
  ctx.ellipse(x + 24 * s, y + 4 * s, 20 * s, 11 * s, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawProp(ctx: CanvasRenderingContext2D, pr: Prop): void {
  ctx.save();
  ctx.translate(pr.x, GROUND_Y + 3);
  ctx.scale(pr.s, pr.s);
  ctx.fillStyle = "rgba(10,20,30,0.14)";
  ctx.beginPath();
  ctx.ellipse(2, 2, 22, 5, 0, 0, Math.PI * 2);
  ctx.fill();
  if (pr.kind === "palm") {
    ctx.strokeStyle = "#8A5A33";
    ctx.lineWidth = 7;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(7, -42, 2, -80);
    ctx.stroke();
    const fronds: [number, number][] = [[-2.7, -8], [-2.1, -14], [-1.35, -17], [-0.7, -14], [0.1, -9], [0.9, -2]];
    ctx.strokeStyle = "#1F7440";
    ctx.lineWidth = 5;
    for (const [a, drop] of fronds) {
      ctx.beginPath();
      ctx.moveTo(2, -80);
      ctx.quadraticCurveTo(2 + Math.cos(a) * 20, -80 - 13, 2 + Math.cos(a) * 34, -80 + drop + 12);
      ctx.stroke();
    }
    ctx.strokeStyle = "#2F9E5F";
    for (const [a, drop] of fronds) {
      ctx.beginPath();
      ctx.moveTo(2, -80);
      ctx.quadraticCurveTo(2 + Math.cos(a) * 20, -80 - 16, 2 + Math.cos(a) * 32, -80 + drop + 6);
      ctx.stroke();
    }
    ctx.fillStyle = "#5C3A1E";
    ctx.beginPath();
    ctx.arc(-1, -74, 3.5, 0, Math.PI * 2);
    ctx.arc(6, -71, 3.5, 0, Math.PI * 2);
    ctx.fill();
  } else if (pr.kind === "umbrella") {
    ctx.strokeStyle = "#C9CDD6";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, -62);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.fillStyle = i % 2 === 0 ? "#FF6B6B" : "#FFD93D";
      ctx.beginPath();
      ctx.moveTo(5, -62);
      ctx.arc(5, -62, 26, Math.PI + (i * Math.PI) / 4, Math.PI + ((i + 1) * Math.PI) / 4);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillStyle = "#C9CDD6";
    ctx.beginPath();
    ctx.arc(5, -62, 2.5, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "#8B93A3";
    ctx.beginPath();
    ctx.ellipse(0, -8, 21, 12, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#A7AEBB";
    ctx.beginPath();
    ctx.ellipse(-5, -13, 9, 5, -0.4, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawPickup(ctx: CanvasRenderingContext2D, p: Pickup): void {
  const y = pickupY(p);
  ctx.save();
  ctx.translate(p.x, y);
  if (p.kind === "golden") {
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 24);
    glow.addColorStop(0, "rgba(255,214,90,0.5)");
    glow.addColorStop(1, "rgba(255,214,90,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(-24, -24, 48, 48);
    ctx.strokeStyle = "rgba(255,240,180,0.9)";
    ctx.lineWidth = 2;
    const a = p.t * 2.2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 16, Math.sin(a) * 16);
    ctx.lineTo(-Math.cos(a) * 16, -Math.sin(a) * 16);
    ctx.moveTo(Math.cos(a + Math.PI / 2) * 16, Math.sin(a + Math.PI / 2) * 16);
    ctx.lineTo(-Math.cos(a + Math.PI / 2) * 16, -Math.sin(a + Math.PI / 2) * 16);
    ctx.stroke();
  }
  const body = p.kind === "golden" ? "#FFC93E" : "#8ECBEE";
  const fin = p.kind === "golden" ? "#E8A020" : "#5FA8DC";
  const dir = Math.sin(p.t * 5 + p.phase) * 0.12;
  ctx.rotate(dir);
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.ellipse(0, 0, 11, 6.5, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(9, 0);
  ctx.lineTo(19, -7);
  ctx.lineTo(19, 7);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = fin;
  ctx.beginPath();
  ctx.moveTo(-2, -4);
  ctx.lineTo(4, -10);
  ctx.lineTo(6, -3);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#22303F";
  ctx.beginPath();
  ctx.arc(-5.5, -1, 1.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawObstacle(ctx: CanvasRenderingContext2D, o: Obstacle): void {
  ctx.save();
  if (o.dead) {
    ctx.globalAlpha = Math.max(0, 1 - o.deadT / 1.2);
    ctx.translate(o.x, o.kind === "gull" ? o.y : o.y - o.h / 2);
    ctx.rotate(o.deadT * 7);
    ctx.translate(-o.x, -(o.kind === "gull" ? o.y : o.y - o.h / 2));
  }
  if (o.kind === "cone") {
    const x = o.x;
    const gb = GROUND_Y;
    ctx.fillStyle = "#C2410C";
    ctx.fillRect(x - 17, gb - 7, 34, 7);
    ctx.fillStyle = "#FF8C42";
    ctx.beginPath();
    ctx.moveTo(x - 13, gb - 6);
    ctx.quadraticCurveTo(x - 4, gb - 26, x - 4.5, gb - 42);
    ctx.lineTo(x + 4.5, gb - 42);
    ctx.quadraticCurveTo(x + 4, gb - 26, x + 13, gb - 6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#FDEFE3";
    ctx.fillRect(x - 9.4, gb - 24, 18.8, 7);
  } else if (o.kind === "crab") {
    const x = o.x;
    const y = GROUND_Y;
    ctx.strokeStyle = "#B34536";
    ctx.lineWidth = 3;
    ctx.lineCap = "round";
    for (let i = 0; i < 3; i++) {
      const kick = Math.sin(o.t * 10 + o.phase + i) * 3;
      ctx.beginPath();
      ctx.moveTo(x - 6 + i * 6, y - 7);
      ctx.lineTo(x - 10 + i * 6 + kick, y - 1);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + 2 + i * 4, y - 7);
      ctx.lineTo(x + 8 + i * 4 - kick, y - 1);
      ctx.stroke();
    }
    ctx.fillStyle = "#E85D4A";
    ctx.beginPath();
    ctx.ellipse(x, y - 11, 16, 10, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FF8A76";
    ctx.beginPath();
    ctx.ellipse(x, y - 8, 10, 5, 0, 0, Math.PI * 2);
    ctx.fill();
    // 朝向玩家的钳（左）
    ctx.fillStyle = "#E85D4A";
    ctx.beginPath();
    ctx.arc(x - 19, y - 12, 5.5, 0, Math.PI * 2);
    ctx.arc(x - 14, y - 19, 4.5, 0, Math.PI * 2);
    ctx.fill();
    // 眼睛
    ctx.strokeStyle = "#B34536";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x + 2, y - 19);
    ctx.lineTo(x + 3, y - 26);
    ctx.moveTo(x + 8, y - 18);
    ctx.lineTo(x + 10, y - 25);
    ctx.stroke();
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.arc(x + 3, y - 27, 3, 0, Math.PI * 2);
    ctx.arc(x + 10.5, y - 26, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#22303F";
    ctx.beginPath();
    ctx.arc(x + 3.8, y - 27, 1.3, 0, Math.PI * 2);
    ctx.arc(x + 11.3, y - 26, 1.3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    const bob = gullBob(o);
    const x = o.x;
    const y = o.y + bob;
    const flap = Math.sin(o.t * 14 + o.phase) * 0.85;
    ctx.save();
    ctx.translate(x, y);
    // 翅膀（后）
    ctx.fillStyle = "#C9D4E4";
    ctx.save();
    ctx.rotate(-flap * 0.7);
    ctx.beginPath();
    ctx.ellipse(2, -4, 13, 5.5, -0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    // 身体 + 头（朝左飞向玩家）
    ctx.fillStyle = "#F4F7FB";
    ctx.beginPath();
    ctx.ellipse(0, 0, 14, 6.5, -0.06, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(-13, -3, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "#FF9F45";
    ctx.beginPath();
    ctx.moveTo(-17, -4);
    ctx.lineTo(-25, -2);
    ctx.lineTo(-17, -1);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#22303F";
    ctx.beginPath();
    ctx.arc(-14.5, -4, 1.3, 0, Math.PI * 2);
    ctx.fill();
    // 翅膀（前）
    ctx.fillStyle = "#DDE5F0";
    ctx.save();
    ctx.rotate(flap * 0.9);
    ctx.beginPath();
    ctx.ellipse(1, -5, 15, 6, -0.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    ctx.restore();
  }
  ctx.restore();
}

function wheel(ctx: CanvasRenderingContext2D, x: number, y: number, rot: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.strokeStyle = "#2A3346";
  ctx.lineWidth = 5;
  ctx.beginPath();
  ctx.arc(0, 0, WHEEL_R, 0, Math.PI * 2);
  ctx.stroke();
  ctx.rotate(rot);
  ctx.strokeStyle = "rgba(255,255,255,0.7)";
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    const a = (i * Math.PI) / 3;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 3, Math.sin(a) * 3);
    ctx.lineTo(Math.cos(a) * (WHEEL_R - 3), Math.sin(a) * (WHEEL_R - 3));
    ctx.moveTo(-Math.cos(a) * 3, -Math.sin(a) * 3);
    ctx.lineTo(-Math.cos(a) * (WHEEL_R - 3), -Math.sin(a) * (WHEEL_R - 3));
    ctx.stroke();
  }
  ctx.fillStyle = "#F97316";
  ctx.beginPath();
  ctx.arc(0, 0, 3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function legTo(ctx: CanvasRenderingContext2D, hx: number, hy: number, px: number, py: number): void {
  const kx = (hx + px) / 2 + 7;
  const ky = (hy + py) / 2 - 9;
  ctx.strokeStyle = "#F8F9FB";
  ctx.lineWidth = 5;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.quadraticCurveTo(kx, ky, px, py);
  ctx.stroke();
  ctx.fillStyle = "#F97316";
  ctx.beginPath();
  ctx.arc(px, py, 2.6, 0, Math.PI * 2);
  ctx.fill();
}

function drawPlayer(ctx: CanvasRenderingContext2D, s: GameState): void {
  const duck = s.ducking;
  const bodyDip = duck ? 16 : 0;
  ctx.save();
  ctx.translate(PLAYER_X, s.playerY);
  if (s.invincible > 0 && s.phase === "running") {
    ctx.globalAlpha = 0.45 + 0.4 * Math.abs(Math.sin(s.time * 22));
  }
  // 影子
  const airH = GROUND_Y - s.playerY;
  const sh = Math.min(1, Math.max(0.25, 1 - airH / 280));
  ctx.fillStyle = `rgba(15,25,40,${(0.22 * sh).toFixed(3)})`;
  ctx.beginPath();
  ctx.ellipse(10, 3, 40 * sh + 10, 6 * sh + 2, 0, 0, Math.PI * 2);
  ctx.fill();

  if (!duck) ctx.rotate(Math.min(0.14, Math.max(-0.1, s.vy / 5200)));

  // ── 车 ──
  wheel(ctx, -13, -17, s.wheelRot);
  wheel(ctx, 48, -17, s.wheelRot);
  ctx.strokeStyle = "#F97316";
  ctx.lineWidth = 4.5;
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(-13, -17);
  ctx.lineTo(20, -14);
  ctx.lineTo(8, -48);
  ctx.lineTo(44, -52);
  ctx.lineTo(48, -17);
  ctx.moveTo(20, -14);
  ctx.lineTo(44, -52);
  ctx.moveTo(8, -48);
  ctx.lineTo(4, -53);
  ctx.moveTo(44, -52);
  ctx.lineTo(50, -58);
  ctx.stroke();
  ctx.fillStyle = "#2B3444";
  ctx.fillRect(0, -56, 15, 5);
  ctx.beginPath();
  ctx.arc(51, -59, 3.2, 0, Math.PI * 2);
  ctx.fill();

  // ── 腿（踩踏）──
  const a = s.legPhase;
  const hipY = -46 + bodyDip;
  legTo(ctx, 8, hipY, 20 + Math.cos(a) * 13, -14 + Math.sin(a) * 13);
  legTo(ctx, 8, hipY, 20 + Math.cos(a + Math.PI) * 13, -14 + Math.sin(a + Math.PI) * 13);

  // ── 身体组 ──
  ctx.save();
  ctx.translate(0, bodyDip);
  // 尾羽
  ctx.fillStyle = "#FDFEFF";
  ctx.beginPath();
  ctx.moveTo(-4, -56);
  ctx.lineTo(-14, -60);
  ctx.lineTo(-9, -54);
  ctx.lineTo(-16, -53);
  ctx.lineTo(-8, -49);
  ctx.closePath();
  ctx.fill();
  // 身体
  ctx.beginPath();
  ctx.ellipse(14, -58, 20, 12.5, -0.12, 0, Math.PI * 2);
  ctx.fill();
  // 翅膀（空中扇动）
  const flap = s.onGround ? Math.sin(s.legPhase * 0.9) * 0.06 : Math.sin(s.time * 16) * 0.3;
  ctx.save();
  ctx.translate(10, -61);
  ctx.rotate(-0.28 + flap);
  ctx.fillStyle = "#DCE4EF";
  ctx.beginPath();
  ctx.ellipse(0, 0, 11.5, 6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
  // 脖子 + 头
  ctx.strokeStyle = "#FDFEFF";
  ctx.lineWidth = 9;
  ctx.beginPath();
  ctx.moveTo(27, -62);
  ctx.quadraticCurveTo(34, -70, 39, -77);
  ctx.stroke();
  ctx.fillStyle = "#FDFEFF";
  ctx.beginPath();
  ctx.arc(41, -80, 7.5, 0, Math.PI * 2);
  ctx.fill();
  // 红帽
  ctx.fillStyle = "#E8453C";
  ctx.beginPath();
  ctx.arc(41, -80.5, 8, Math.PI * 1.02, Math.PI * 1.95);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(36, -88.5, 2.4, 0, Math.PI * 2);
  ctx.fill();
  // 眼睛
  ctx.fillStyle = "#22303F";
  ctx.beginPath();
  ctx.arc(44, -80.5, 1.7, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath();
  ctx.arc(44.6, -81.2, 0.6, 0, Math.PI * 2);
  ctx.fill();
  // 大喙 + 喉囊（速度越快晃得越欢）
  const sag = Math.sin(s.time * 9) * (1.2 + s.speed / 500);
  ctx.fillStyle = "#F08A2C";
  ctx.beginPath();
  ctx.moveTo(47, -77.5);
  ctx.quadraticCurveTo(61, -63 + sag, 77, -73.5);
  ctx.lineTo(46.5, -81);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = "#FFA243";
  ctx.beginPath();
  ctx.moveTo(46.5, -81);
  ctx.lineTo(78, -74.5);
  ctx.lineTo(47, -77.5);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = "rgba(180,90,20,0.55)";
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(52, -79.5);
  ctx.lineTo(72, -75.5);
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

function drawParticle(ctx: CanvasRenderingContext2D, pt: Particle): void {
  const k = pt.t / pt.life;
  ctx.save();
  ctx.globalAlpha = Math.max(0, 1 - k);
  ctx.translate(pt.x, pt.y);
  ctx.rotate(pt.rot);
  if (pt.kind === "dust") {
    ctx.fillStyle = "rgba(222,227,233,0.75)";
    ctx.beginPath();
    ctx.arc(0, 0, pt.size * (1 - k * 0.5), 0, Math.PI * 2);
    ctx.fill();
  } else if (pt.kind === "feather") {
    ctx.fillStyle = "#FFFFFF";
    ctx.beginPath();
    ctx.ellipse(0, 0, pt.size + 2, (pt.size + 2) * 0.42, 0, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.strokeStyle = "#FFE082";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.moveTo(-pt.size * 2, 0);
    ctx.lineTo(pt.size * 2, 0);
    ctx.moveTo(0, -pt.size * 2);
    ctx.lineTo(0, pt.size * 2);
    ctx.stroke();
  }
  ctx.restore();
}
