/**
 * 鹈鹕骑行——游戏引擎（纯逻辑，零 DOM 依赖，vitest 直接可测）。
 *
 * 分工：update(dt, input) 推进 running 模拟并返回事件流（音效 / UI 反应挂在事件上）；
 * idle(dt) 只推进标题画面的巡游动画。渲染读 state，画在 render.ts。
 * 随机数用可播种的 mulberry32——同种子同命运，测试可复现。
 */

import type {
  FloatText,
  GameEvent,
  GameState,
  InputState,
  Obstacle,
  ObstacleKind,
  Particle,
  Pickup,
  Prop,
} from "./types";

// ── 世界常量（渲染与测试共用同一份） ──
export const WORLD_H = 540;
export const GROUND_Y = 470;
export const PLAYER_X = 180;
export const WHEEL_R = 17;

export const GRAVITY = 2500;
export const JUMP_V = -880;
/** 空中按住 ↓ 的额外下坠加速度 */
export const FAST_FALL_V = 1600;

export const BASE_SPEED = 340;
/** 标题画面的巡游速度（不计分） */
export const CRUISE_SPEED = 250;
/** 每秒速度爬升 */
export const SPEED_RAMP = 8.5;
export const MAX_SPEED = 780;

export const PLAYER_W = 80;
export const PLAYER_H_STAND = 90;
export const PLAYER_H_DUCK = 56;
/** 判定内缩——玩家永远觉得判定比画面小，手感才公平 */
export const HIT_MARGIN = 7;

export const START_HEARTS = 3;
export const INVINCIBLE_T = 1.5;
export const COMBO_MAX = 5;
export const COMBO_WINDOW = 4;
export const FISH_BASE = 10;
export const GOLDEN_BASE = 60;

/** 一整个昼夜循环的秒数 */
export const DAY_LENGTH = 90;

/** 生成 x——任何合理窗口宽度下都在屏幕右侧之外 */
export const SPAWN_X = 1600;
export const DESPAWN_X = -160;

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function playerBox(s: GameState): Box {
  const h = (s.ducking ? PLAYER_H_DUCK : PLAYER_H_STAND) - HIT_MARGIN * 2;
  return { x: PLAYER_X - 26 + HIT_MARGIN, y: s.playerY - h - HIT_MARGIN, w: PLAYER_W - HIT_MARGIN * 2, h };
}

/** gull 的飞行上下浮动——渲染与碰撞必须用同一个函数 */
export function gullBob(o: Obstacle): number {
  return Math.sin(o.t * 5 + o.phase) * 7;
}

/** 鱼的上下浮动——同上 */
export function pickupY(p: Pickup): number {
  return p.baseY + Math.sin(p.t * 5 + p.phase) * 8;
}

export function obstacleBox(o: Obstacle): Box {
  if (o.kind === "gull") {
    const bob = gullBob(o);
    return { x: o.x - o.w / 2 + 3, y: o.y - o.h / 2 + bob + 3, w: o.w - 6, h: o.h - 6 };
  }
  return { x: o.x - o.w / 2 + 2, y: o.y - o.h + 2, w: o.w - 4, h: o.h - 2 };
}

export function pickupBox(p: Pickup): Box {
  const y = pickupY(p);
  return { x: p.x - 15, y: y - 10, w: 30, h: 20 };
}

function aabb(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function freshState(): GameState {
  return {
    phase: "ready",
    time: 0,
    distance: 0,
    rideDistance: 0,
    speed: CRUISE_SPEED,
    score: 0,
    fishScore: 0,
    combo: 1,
    comboTimer: 0,
    hearts: START_HEARTS,
    invincible: 0,
    flash: 0,
    shake: 0,
    playerY: GROUND_Y,
    vy: 0,
    onGround: true,
    ducking: false,
    legPhase: 0,
    wheelRot: 0,
    obstacles: [],
    pickups: [],
    props: [],
    particles: [],
    floats: [],
    spawnTimer: 1.6,
    pickupTimer: 0.9,
    propTimer: 0.4,
    lastSpawnGap: 0,
    viewW: 0,
    dayT: 0,
  };
}

export class GameEngine {
  state: GameState = freshState();
  private rng: () => number;
  private nextId = 1;

  constructor(seed = 1) {
    this.rng = mulberry32(seed);
  }

  /** 重开一局（换种子换命运）；从 ready 进入 running 用 start() */
  reset(seed?: number): void {
    if (seed !== undefined) this.rng = mulberry32(seed);
    this.state = freshState();
  }

  start(): void {
    const s = this.state;
    if (s.phase !== "ready") return;
    s.phase = "running";
    s.time = 0;
    s.rideDistance = 0;
    s.speed = BASE_SPEED;
  }

  /** 渲染侧回报可视世界宽——超宽窗口下生成点跟着右移，路障永远从屏外进场 */
  setViewport(worldW: number): void {
    this.state.viewW = worldW;
  }

  /** 本局实体进场 x：至少屏外 80px */
  private spawnX(): number {
    return Math.max(SPAWN_X, this.state.viewW + 80);
  }

  /** 标题画面巡游——只滚动画（云 / 海 / 车轮），不生成不计分不碰撞 */
  idle(dt: number): void {
    const s = this.state;
    if (s.phase !== "ready") return;
    s.time += dt;
    s.dayT = (s.time % DAY_LENGTH) / DAY_LENGTH;
    s.distance += CRUISE_SPEED * dt;
    this.animateRide(dt, CRUISE_SPEED);
  }

  update(dt: number, input: InputState): GameEvent[] {
    const s = this.state;
    const evs: GameEvent[] = [];
    if (s.phase !== "running") return evs;

    s.time += dt;
    s.dayT = (s.time % DAY_LENGTH) / DAY_LENGTH;
    s.speed = Math.min(MAX_SPEED, BASE_SPEED + s.time * SPEED_RAMP);
    s.distance += s.speed * dt;
    s.rideDistance += s.speed * dt;

    // ── 纵向物理 ──
    if (input.jumpPressed && s.onGround) {
      s.vy = JUMP_V;
      s.onGround = false;
      s.ducking = false;
      this.burst("dust", PLAYER_X, GROUND_Y, 6, 90);
      evs.push({ type: "jump" });
    }
    const g = GRAVITY + (!s.onGround && input.duckHeld ? FAST_FALL_V : 0);
    s.vy += g * dt;
    s.playerY += s.vy * dt;
    if (s.playerY >= GROUND_Y) {
      if (!s.onGround) {
        this.burst("dust", PLAYER_X, GROUND_Y, 8, 110);
        evs.push({ type: "land" });
      }
      s.playerY = GROUND_Y;
      s.vy = 0;
      s.onGround = true;
    }
    s.ducking = s.onGround && input.duckHeld;

    // ── 计时器 ──
    s.invincible = Math.max(0, s.invincible - dt);
    s.flash = Math.max(0, s.flash - dt * 1.4);
    s.shake = Math.max(0, s.shake - dt * 1.1);
    if (s.combo > 1) {
      s.comboTimer -= dt;
      if (s.comboTimer <= 0) s.combo = 1;
    }

    // ── 生成 ──
    s.spawnTimer -= dt;
    if (s.spawnTimer <= 0) {
      this.spawnObstacle();
      s.spawnTimer = this.obstacleGap();
    }
    s.pickupTimer -= dt;
    if (s.pickupTimer <= 0) {
      this.spawnPickups();
      s.pickupTimer = 1.2 + this.rng() * 1.6;
    }
    s.propTimer -= dt;
    if (s.propTimer <= 0) {
      this.spawnProp();
      s.propTimer = 2.5 + this.rng() * 4;
    }

    this.animateRide(dt, s.speed);
    this.moveEntities(dt);

    // ── 碰撞：路障 ──
    const pb = playerBox(s);
    for (const o of s.obstacles) {
      if (o.dead) continue;
      if (s.invincible > 0) break;
      if (aabb(pb, obstacleBox(o))) {
        o.dead = true;
        o.deadT = 0;
        s.hearts -= 1;
        s.invincible = INVINCIBLE_T;
        s.shake = 0.55;
        s.flash = 0.4;
        s.combo = 1;
        s.comboTimer = 0;
        this.burst("feather", PLAYER_X + 10, s.playerY - 60, 12, 200);
        evs.push({ type: "hit" });
        if (s.hearts <= 0) {
          s.hearts = 0;
          s.phase = "over";
          evs.push({ type: "gameover" });
        }
        break;
      }
    }

    // ── 碰撞：鱼 ──
    const grab: Box = { x: pb.x - 14, y: pb.y - 14, w: pb.w + 28, h: pb.h + 28 };
    for (const p of s.pickups) {
      if (!aabb(grab, pickupBox(p))) continue;
      p.kind === "golden" ? evs.push({ type: "golden" }) : evs.push({ type: "fish" });
      const pts = p.kind === "golden" ? GOLDEN_BASE : FISH_BASE * s.combo;
      s.fishScore += pts;
      s.combo = Math.min(COMBO_MAX, s.combo + 1);
      s.comboTimer = COMBO_WINDOW;
      s.floats.push({ x: p.x, y: pickupY(p) - 14, text: `+${pts}`, t: 0, life: 0.9 });
      this.burst("spark", p.x, pickupY(p), 8, 130);
      this.removePickup(p.id);
    }

    s.score = Math.floor(s.rideDistance / 40) + s.fishScore;
    return evs;
  }

  // ── 内部 ──

  private animateRide(dt: number, speed: number): void {
    const s = this.state;
    s.legPhase += speed * dt * 0.045;
    s.wheelRot += (speed * dt) / WHEEL_R;
  }

  private moveEntities(dt: number): void {
    const s = this.state;
    for (const o of s.obstacles) {
      o.t += dt;
      if (o.dead) {
        o.deadT += dt;
        o.x -= s.speed * 0.4 * dt;
        o.y -= 150 * dt;
      } else {
        o.x -= (s.speed + o.vx) * dt;
      }
    }
    s.obstacles = s.obstacles.filter((o) => o.x > DESPAWN_X && o.deadT < 1.4);
    for (const p of s.pickups) {
      p.t += dt;
      p.x -= s.speed * dt;
    }
    s.pickups = s.pickups.filter((p) => p.x > DESPAWN_X);
    for (const pr of s.props) pr.x -= s.speed * dt;
    s.props = s.props.filter((pr) => pr.x > DESPAWN_X);
    for (const pt of s.particles) {
      pt.t += dt;
      pt.x += pt.vx * dt;
      pt.y += pt.vy * dt;
      pt.vy += (pt.kind === "feather" ? 260 : 480) * dt;
      pt.rot += pt.vr * dt;
      if (pt.kind === "feather") pt.vx *= 1 - dt * 1.8;
    }
    s.particles = s.particles.filter((pt) => pt.t < pt.life);
    for (const f of s.floats) {
      f.t += dt;
      f.y -= 44 * dt;
    }
    s.floats = s.floats.filter((f) => f.t < f.life);
  }

  /** 路障最小间隔 1.23s（公平下限），随时间收紧到 1.45s 基线 */
  private obstacleGap(): number {
    const s = this.state;
    const base = clamp(2.7 - s.time * 0.016, 1.45, 2.7);
    const gap = base * (0.85 + this.rng() * 0.45);
    s.lastSpawnGap = gap;
    return gap;
  }

  private spawnObstacle(): void {
    const s = this.state;
    const r = this.rng();
    let kind: ObstacleKind;
    if (s.time < 6) {
      // 开局 6 秒只有地面障碍——给玩家热身
      kind = r < 0.7 ? "cone" : "crab";
    } else if (r < 0.36) {
      kind = "cone";
    } else if (r < 0.6) {
      kind = "crab";
    } else {
      kind = "gull";
    }
    const id = this.nextId++;
    const phase = this.rng() * Math.PI * 2;
    const sx = this.spawnX();
    if (kind === "gull") {
      // 高海鸥出现在 25s 后：惩罚乱跳（跳起必撞），贴地跑反而安全。
      // 高度按判定盒反推：低飞 80（站立撞、俯冲过），高空 172（只有满跳才会撞上）
      const high = s.time > 25 && this.rng() < 0.3;
      s.obstacles.push({
        id, kind, x: sx + 40, y: GROUND_Y - (high ? 172 : 80),
        w: 56, h: 26, vx: 20 + this.rng() * 40, t: 0, dead: false, deadT: 0, phase,
      });
    } else if (kind === "crab") {
      s.obstacles.push({
        id, kind, x: sx, y: GROUND_Y, w: 44, h: 26,
        vx: -(60 + this.rng() * 50), t: 0, dead: false, deadT: 0, phase,
      });
    } else {
      s.obstacles.push({
        id, kind, x: sx, y: GROUND_Y, w: 34, h: 46, vx: 0, t: 0, dead: false, deadT: 0, phase,
      });
      // 双锥：跳一次要跨两格
      if (s.time > 12 && this.rng() < 0.22) {
        s.obstacles.push({
          id: this.nextId++, kind, x: sx + 48, y: GROUND_Y, w: 34, h: 46,
          vx: 0, t: 0, dead: false, deadT: 0, phase,
        });
      }
    }
  }

  private spawnPickups(): void {
    const s = this.state;
    const id = this.nextId++;
    const sx = this.spawnX();
    if (this.rng() < 0.07) {
      // 金鱼：又高又值钱
      s.pickups.push({
        id, kind: "golden", x: sx + 60, baseY: GROUND_Y - (125 + this.rng() * 60),
        t: 0, phase: this.rng() * Math.PI * 2,
      });
      return;
    }
    const pat = this.rng();
    const mk = (i: number, baseY: number) => {
      s.pickups.push({
        id: this.nextId++, kind: "fish", x: sx + i * 44, baseY,
        t: 0, phase: this.rng() * Math.PI * 2,
      });
    };
    if (pat < 0.4) {
      // 顺路直线
      for (let i = 0; i < 3; i++) mk(i, GROUND_Y - 58);
    } else if (pat < 0.75) {
      // 小跳弧线
      const ys = [GROUND_Y - 66, GROUND_Y - 104, GROUND_Y - 120, GROUND_Y - 104];
      ys.forEach((y, i) => mk(i, y));
    } else {
      // 高空线——要大跳
      for (let i = 0; i < 3; i++) mk(i, GROUND_Y - 185);
    }
  }

  private spawnProp(): void {
    const s = this.state;
    const r = this.rng();
    const kind: Prop["kind"] = r < 0.4 ? "palm" : r < 0.7 ? "umbrella" : "rock";
    s.props.push({ kind, x: this.spawnX(), s: 0.8 + this.rng() * 0.5, phase: this.rng() * Math.PI * 2 });
  }

  private removePickup(id: number): void {
    this.state.pickups = this.state.pickups.filter((p) => p.id !== id);
  }

  private burst(kind: Particle["kind"], x: number, y: number, n: number, spread: number): void {
    const s = this.state;
    for (let i = 0; i < n; i++) {
      const a = this.rng() * Math.PI * 2;
      const v = spread * (0.35 + this.rng() * 0.65);
      s.particles.push({
        kind,
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - (kind === "feather" ? 120 : 60),
        t: 0,
        life: kind === "feather" ? 1.1 : kind === "spark" ? 0.55 : 0.45,
        size: kind === "feather" ? 4 + this.rng() * 3 : 2 + this.rng() * 2.5,
        rot: this.rng() * Math.PI * 2,
        vr: (this.rng() - 0.5) * 12,
      });
    }
  }
}
