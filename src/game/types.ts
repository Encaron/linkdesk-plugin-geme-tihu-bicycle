/**
 * 鹈鹕骑行——游戏共享类型。
 * 引擎（engine.ts）只操作这些纯数据；渲染（render.ts）只读它们；
 * 组件（index.tsx）负责输入与 React 状态桥接。
 */

export type Phase = "ready" | "running" | "over";

export type ObstacleKind = "cone" | "crab" | "gull";

/** 路障 / 敌人。cone·crab 落在路面（y = 底边），gull 以 y 为中心飞行 */
export interface Obstacle {
  id: number;
  kind: ObstacleKind;
  /** 中心 x（世界坐标，随路面向左移动） */
  x: number;
  y: number;
  w: number;
  h: number;
  /** 相对路面的附加速度：crab 向左爬（负）、gull 向右飞（正，逼近更慢） */
  vx: number;
  /** 存活时间——驱动翅膀 / 腿 / 上下浮动动画 */
  t: number;
  /** 被撞后进入残骸状态（翻飞出屏） */
  dead: boolean;
  deadT: number;
  /** 动画相位（错开同类个体的动作） */
  phase: number;
}

export interface Pickup {
  id: number;
  kind: "fish" | "golden";
  x: number;
  baseY: number;
  t: number;
  phase: number;
}

/** 路边装饰：棕榈树 / 遮阳伞 / 礁石 */
export interface Prop {
  kind: "palm" | "umbrella" | "rock";
  x: number;
  s: number;
  phase: number;
}

export interface Particle {
  kind: "dust" | "feather" | "spark";
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  life: number;
  size: number;
  rot: number;
  vr: number;
}

export interface FloatText {
  x: number;
  y: number;
  text: string;
  t: number;
  life: number;
}

export type GameEventType = "jump" | "land" | "fish" | "golden" | "hit" | "gameover";

export interface GameEvent {
  type: GameEventType;
}

export interface InputState {
  /** 本帧请求起跳（引擎消费后由组件清零） */
  jumpPressed: boolean;
  /** 按住：地面=低头滑行，空中=加速下落 */
  duckHeld: boolean;
}

export interface GameState {
  phase: Phase;
  /** 本局运行时间（驱动速度爬升与昼夜循环） */
  time: number;
  /** 里程（含标题巡游）——纯视觉滚动用 */
  distance: number;
  /** 计分里程（只累计 running 阶段） */
  rideDistance: number;
  speed: number;
  score: number;
  fishScore: number;
  /** 1..COMBO_MAX，吃到鱼 +1，超时/被撞回落 */
  combo: number;
  comboTimer: number;
  hearts: number;
  invincible: number;
  /** 撞击白闪 0..0.4 */
  flash: number;
  shake: number;
  /** 车轮触地点 y（空中 < GROUND_Y） */
  playerY: number;
  vy: number;
  onGround: boolean;
  ducking: boolean;
  /** 踩踏相位（蹬腿动画） */
  legPhase: number;
  wheelRot: number;
  obstacles: Obstacle[];
  pickups: Pickup[];
  props: Prop[];
  particles: Particle[];
  floats: FloatText[];
  spawnTimer: number;
  pickupTimer: number;
  propTimer: number;
  /** 最近一次路障间隔（秒）——测试公平性用 */
  lastSpawnGap: number;
  /** 视口世界宽（渲染侧每帧回报；0=未知，生成点退回 SPAWN_X） */
  viewW: number;
  /** 昼夜循环相位 0..1 */
  dayT: number;
}
