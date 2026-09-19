/**
 * 鹈鹕骑行——引擎单测：物理手感 / 判定公平性 / 连击计分 / 生成节奏 / 确定性。
 * 引擎纯逻辑零 DOM，jsdom 下直接跑。
 */

import { describe, expect, it } from "vitest";
import {
  COMBO_MAX,
  FISH_BASE,
  GOLDEN_BASE,
  GameEngine,
  GROUND_Y,
  INVINCIBLE_T,
  MAX_SPEED,
  PLAYER_X,
  SPAWN_X,
  START_HEARTS,
} from "../game/engine";
import type { Obstacle, Pickup } from "../game/types";

const DT = 1 / 60;
const noInput = { jumpPressed: false, duckHeld: false };

/** 关掉自然生成——测试只考自己摆的局 */
function quiet(e: GameEngine): void {
  e.state.spawnTimer = 999;
  e.state.pickupTimer = 999;
  e.state.propTimer = 999;
}

function makeCone(e: GameEngine, x = PLAYER_X): Obstacle {
  const o: Obstacle = { id: 9001, kind: "cone", x, y: GROUND_Y, w: 34, h: 46, vx: 0, t: 0, dead: false, deadT: 0, phase: 0 };
  e.state.obstacles.push(o);
  return o;
}

function makeGull(e: GameEngine, y: number, x = PLAYER_X): Obstacle {
  const o: Obstacle = { id: 9002, kind: "gull", x, y, w: 56, h: 26, vx: 0, t: 0, dead: false, deadT: 0, phase: 0 };
  e.state.obstacles.push(o);
  return o;
}

function makeFish(e: GameEngine, kind: "fish" | "golden", baseY = GROUND_Y - 40): Pickup {
  const p: Pickup = { id: 9100 + e.state.pickups.length, kind, x: PLAYER_X, baseY, t: 0, phase: 0 };
  e.state.pickups.push(p);
  return p;
}

function freshGame(seed: number): GameEngine {
  const e = new GameEngine(seed);
  e.start();
  quiet(e);
  return e;
}

describe("开局与巡游", () => {
  it("ready 态巡游：滚画面、不出障碍、不计分", () => {
    const e = new GameEngine(1);
    expect(e.state.phase).toBe("ready");
    for (let i = 0; i < 120; i++) e.idle(DT);
    expect(e.state.phase).toBe("ready");
    expect(e.state.obstacles).toHaveLength(0);
    expect(e.state.score).toBe(0);
    expect(e.state.distance).toBeGreaterThan(0);
  });

  it("start 后进入 running 且计时归零", () => {
    const e = new GameEngine(1);
    e.idle(3);
    e.start();
    expect(e.state.phase).toBe("running");
    expect(e.state.time).toBe(0);
  });
});

describe("纵向物理", () => {
  it("起跳后落回地面，最高点约 155px", () => {
    const e = freshGame(2);
    e.update(DT, { jumpPressed: true, duckHeld: false });
    expect(e.state.onGround).toBe(false);
    let minY = e.state.playerY;
    let landed = false;
    for (let i = 0; i < 240; i++) {
      e.update(DT, noInput);
      minY = Math.min(minY, e.state.playerY);
      if (e.state.onGround) {
        landed = true;
        break;
      }
    }
    expect(landed).toBe(true);
    const apex = GROUND_Y - minY;
    expect(apex).toBeGreaterThan(120);
    expect(apex).toBeLessThan(170);
  });

  it("空中按住 ↓ 加速下落（更快落地）", () => {
    const landTime = (duck: boolean) => {
      const e = freshGame(3);
      let t = 0;
      let jumped = false;
      for (let i = 0; i < 600; i++) {
        const evs = e.update(DT, { jumpPressed: !jumped, duckHeld: duck });
        if (!jumped && evs.some((v) => v.type === "jump")) jumped = true;
        if (jumped && e.state.onGround) return t;
        t += DT;
      }
      return Number.POSITIVE_INFINITY;
    };
    expect(landTime(true)).toBeLessThan(landTime(false));
  });
});

describe("判定与公平性", () => {
  it("低飞海鸥：站立会撞、低头滑行安全", () => {
    const e = freshGame(4);
    makeGull(e, GROUND_Y - 80);
    e.update(DT, noInput);
    expect(e.state.hearts).toBe(START_HEARTS - 1);
    expect(e.state.invincible).toBeGreaterThan(0);
    expect(e.state.phase).toBe("running");

    const e2 = freshGame(5);
    makeGull(e2, GROUND_Y - 80);
    e2.update(DT, { jumpPressed: false, duckHeld: true });
    expect(e2.state.hearts).toBe(START_HEARTS);
  });

  it("高空海鸥：贴地跑安全、腾空会撞", () => {
    const e = freshGame(6);
    makeGull(e, GROUND_Y - 172);
    e.update(DT, noInput);
    expect(e.state.hearts).toBe(START_HEARTS);

    const e2 = freshGame(7);
    makeGull(e2, GROUND_Y - 172);
    e2.state.playerY = GROUND_Y - 150; // 跳到半空
    e2.state.onGround = false;
    e2.update(DT, noInput);
    expect(e2.state.hearts).toBe(START_HEARTS - 1);
  });

  it("无敌帧：命中后短时间内不再扣血；血尽进入 gameover", () => {
    const e = freshGame(8);
    makeCone(e);
    e.update(DT, noInput);
    expect(e.state.hearts).toBe(2);

    makeCone(e);
    e.update(DT, noInput);
    expect(e.state.hearts).toBe(2);

    const waitInvincible = () => {
      for (let i = 0; i < Math.ceil(INVINCIBLE_T / DT) + 2; i++) e.update(DT, noInput);
    };
    waitInvincible();
    makeCone(e);
    e.update(DT, noInput);
    expect(e.state.hearts).toBe(1);

    waitInvincible();
    makeCone(e);
    const evs = e.update(DT, noInput);
    expect(e.state.hearts).toBe(0);
    expect(e.state.phase).toBe("over");
    expect(evs.some((v) => v.type === "gameover")).toBe(true);
    expect(e.update(DT, noInput)).toHaveLength(0);
  });

  it("生成公平性：300 秒内路障最小间隔 ≥ 1.2 秒", () => {
    const e = new GameEngine(99);
    e.start();
    let minGap = Number.POSITIVE_INFINITY;
    let last = -1;
    for (let i = 0; i < 60 * 300; i++) {
      e.update(DT, noInput);
      e.state.invincible = 9999; // 别被撞死——只看生成节奏
      if (e.state.lastSpawnGap > 0 && e.state.lastSpawnGap !== last) {
        last = e.state.lastSpawnGap;
        minGap = Math.min(minGap, last);
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(1.2);
  });
});

describe("计分与连击", () => {
  it("连吃 7 条鱼：×1 ×2 ×3 ×4 ×5 ×5 ×5 = 350 分，连击封顶", () => {
    const e = freshGame(9);
    for (let i = 0; i < 7; i++) makeFish(e, "fish");
    const evs = e.update(DT, noInput);
    expect(evs.filter((v) => v.type === "fish")).toHaveLength(7);
    const total = FISH_BASE * (1 + 2 + 3 + 4 + 5 + 5 + 5);
    expect(e.state.fishScore).toBe(total);
    expect(e.state.combo).toBe(COMBO_MAX);
  });

  it("金鱼固定 +60 且计入连击", () => {
    const e = freshGame(10);
    makeFish(e, "golden");
    const evs = e.update(DT, noInput);
    expect(evs.some((v) => v.type === "golden")).toBe(true);
    expect(e.state.fishScore).toBe(GOLDEN_BASE);
    expect(e.state.combo).toBe(2);
  });

  it("连击超时回落到 ×1", () => {
    const e = freshGame(11);
    makeFish(e, "fish");
    e.update(DT, noInput);
    expect(e.state.combo).toBe(2);
    for (let i = 0; i < 60 * 5; i++) e.update(DT, noInput);
    expect(e.state.combo).toBe(1);
  });

  it("总分 = 里程分 + 鱼分；速度爬升封顶", () => {
    const e = new GameEngine(12);
    e.start();
    for (let i = 0; i < 1300; i++) {
      e.update(0.1, noInput);
      e.state.invincible = 9999;
    }
    expect(e.state.speed).toBe(MAX_SPEED);
    expect(e.state.score).toBe(Math.floor(e.state.rideDistance / 40) + e.state.fishScore);
  });
});

describe("生成与确定性", () => {
  it("路障从右侧屏外生成、向左移动", () => {
    const e = new GameEngine(13);
    e.start();
    for (let i = 0; i < 60 * 5; i++) e.update(DT, noInput);
    expect(e.state.obstacles.length).toBeGreaterThan(0);
    for (const o of e.state.obstacles) expect(o.x).toBeGreaterThan(0);
    for (const o of e.state.obstacles) expect(o.x).toBeLessThan(SPAWN_X + 100);
  });

  it("同种子同命运：30 秒生成序列逐帧一致", () => {
    const run = (seed: number) => {
      const e = new GameEngine(seed);
      e.start();
      const trace: string[] = [];
      for (let i = 0; i < 1800; i++) {
        e.update(DT, { jumpPressed: i % 90 === 0, duckHeld: i % 180 === 0 });
        e.state.invincible = 9999;
        if (i % 10 === 0) {
          trace.push(
            e.state.obstacles.map((o) => `${o.kind}:${Math.round(o.x)}`).join(",") +
              "|" +
              e.state.pickups.map((p) => `${p.kind}:${Math.round(p.x)}`).join(","),
          );
        }
      }
      return trace;
    };
    expect(run(42)).toEqual(run(42));
  });
});
