/**
 * 鹈鹕骑行——LinkDesk 插件主视图。
 *
 * 契约（作者文档 01-plugin-api-contract.md）：壳以 { isActive, tabId?, sourceId? } 渲染本文件
 * default 导出的组件。keep-alive 下标签常驻挂载——isActive 只用来：
 *   ① gate 模拟推进（切走时游戏自动暂停，回来点一下继续）；
 *   ② gate 全局键盘（不抢其他标签的按键）。
 * 绝不用它 blank 内容。
 *
 * 纪律：文案一律 t()（key=中文原文，英文在 i18n/en.json）；界面铬件颜色一律 var(--xxx)；
 * 持久化（最高分 / 音乐开关）走 window.linkdesk.configuration，绝不碰 localStorage。
 */

import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AudioManager } from "./game/audio";
import { GameEngine, START_HEARTS, WORLD_H } from "./game/engine";
import { drawWorld } from "./game/render";
import type { InputState, Phase } from "./game/types";
import "./index.css";

const BEST_KEY = "geme-tihu-bicycle.best";
const MUSIC_KEY = "geme-tihu-bicycle.music";

/** 壳注入的配置面（vitest.setup.ts 与真壳同形） */
interface ConfigApi {
  get(key: string): Promise<unknown>;
  set(key: string, value: unknown): Promise<void>;
}
const config = (): ConfigApi | undefined =>
  (window as unknown as { linkdesk?: { configuration?: ConfigApi } }).linkdesk?.configuration;

interface Hud {
  phase: Phase;
  score: number;
  meters: number;
  hearts: number;
  combo: number;
}

async function cfgSet(key: string, value: unknown): Promise<void> {
  try {
    await config()?.set(key, value);
  } catch {
    /* 配置不可用（浏览器裸开等）——静默降级为内存态 */
  }
}

export default function PelicanRide(_props: { isActive?: boolean; tabId?: string; sourceId?: string }) {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engineRef = useRef<GameEngine | null>(null);
  const audioRef = useRef<AudioManager | null>(null);
  const inputRef = useRef<InputState>({ jumpPressed: false, duckHeld: false });
  const isActiveRef = useRef(true);
  const pausedRef = useRef(false);
  const musicOnRef = useRef(true);
  const bestRef = useRef(0);
  const savedBestRef = useRef(0);

  const [hud, setHud] = useState<Hud>({ phase: "ready", score: 0, meters: 0, hearts: START_HEARTS, combo: 1 });
  const [best, setBest] = useState(0);
  const [musicOn, setMusicOn] = useState(true);
  const [paused, setPaused] = useState(false);
  const [newRecord, setNewRecord] = useState(false);

  // ── 操作（ref 化避免监听器过期闭包）──
  const startGame = useRef(() => {});
  startGame.current = () => {
    const eng = engineRef.current;
    if (!eng || eng.state.phase !== "ready") return;
    const audio = audioRef.current;
    audio?.ensure();
    if (musicOnRef.current) audio?.startMusic();
    eng.start();
  };
  const restart = useRef(() => {});
  restart.current = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.reset(((Date.now() & 0x7fffffff) | 1) >>> 0);
    eng.start();
    setNewRecord(false);
    setPaused(false);
    pausedRef.current = false;
    const audio = audioRef.current;
    audio?.ensure();
    if (musicOnRef.current) audio?.startMusic();
  };
  const togglePause = useRef(() => {});
  togglePause.current = () => {
    if (engineRef.current?.state.phase !== "running") return;
    const v = !pausedRef.current;
    pausedRef.current = v;
    setPaused(v);
    const audio = audioRef.current;
    if (v) audio?.stopMusic();
    else if (musicOnRef.current) audio?.startMusic();
  };
  const toggleMusic = useRef(() => {});
  toggleMusic.current = () => {
    const v = !musicOnRef.current;
    musicOnRef.current = v;
    setMusicOn(v);
    void cfgSet(MUSIC_KEY, v);
    const audio = audioRef.current;
    if (!v) audio?.stopMusic();
    else if (engineRef.current?.state.phase === "running" && !pausedRef.current) audio?.startMusic();
    audio?.sfx("click");
  };
  const action = useRef(() => {});
  action.current = () => {
    const eng = engineRef.current;
    if (!eng) return;
    if (pausedRef.current) {
      togglePause.current();
      return;
    }
    if (eng.state.phase === "ready") startGame.current();
    else if (eng.state.phase === "over") restart.current();
    else inputRef.current.jumpPressed = true;
  };

  // ── 高度兜底：真壳的视图容器有尺寸（root 走 100%）；浏览器裸开 / 简易宿主的父级无高度，
  //    此时按「视口剩余高度」自撑，避免画面塌成一条 —— 只影响无尺寸父级的场景 ──
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const fit = () => {
      const parent = el.parentElement;
      const rect = parent?.getBoundingClientRect();
      // 启发式：父级只把我们包到最小高度（≤min-height+ε）且远小于视口 ⇒ 它没给尺寸
      const unsized =
        !rect || (rect.height <= 344 && rect.height < window.innerHeight * 0.6);
      if (unsized) {
        const top = Math.max(0, el.getBoundingClientRect().top);
        el.style.height = `${Math.max(320, Math.round(window.innerHeight - top))}px`;
      } else if (el.style.height) {
        el.style.height = "";
      }
    };
    // 挂载初期父级尺寸可能未定 / 节点可能被宿主重新挂载——多次择机重测 + 盯住父级尺寸变化
    fit();
    const raf = requestAnimationFrame(fit);
    const t1 = window.setTimeout(fit, 300);
    const t2 = window.setTimeout(fit, 1500);
    const ro = new ResizeObserver(fit);
    if (el.parentElement) ro.observe(el.parentElement);
    ro.observe(document.body);
    window.addEventListener("resize", fit);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      ro.disconnect();
      window.removeEventListener("resize", fit);
    };
  }, []);

  // ── 挂载：引擎 + 音频 + 主循环 + 输入 ──
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const engine = new GameEngine(((Date.now() & 0x7fffffff) | 1) >>> 0);
    const audio = new AudioManager();
    engineRef.current = engine;
    audioRef.current = audio;

    let raf = 0;
    let last = performance.now();
    let hudCache: Hud = { phase: "ready", score: 0, meters: 0, hearts: START_HEARTS, combo: 1 };
    const loop = (now: number) => {
      raf = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      const st = engine.state;
      // 可视世界宽回报给引擎——超宽窗口下生成点跟到屏外
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (ch > 0 && Math.abs((cw / ch) * WORLD_H - st.viewW) > 40) {
        engine.setViewport((cw / ch) * WORLD_H);
      }
      if (st.phase === "running" && isActiveRef.current && !pausedRef.current) {
        const evs = engine.update(dt, inputRef.current);
        inputRef.current.jumpPressed = false;
        for (const e of evs) {
          if (e.type === "jump") audio.sfx("jump");
          else if (e.type === "fish") audio.sfx("fish");
          else if (e.type === "golden") audio.sfx("golden");
          else if (e.type === "hit") audio.sfx("hit");
          else if (e.type === "gameover") {
            audio.sfx("over");
            audio.stopMusic();
            if (st.score > bestRef.current) {
              bestRef.current = st.score;
              savedBestRef.current = st.score;
              setBest(st.score);
              setNewRecord(true);
              void cfgSet(BEST_KEY, st.score);
            } else {
              setNewRecord(false);
            }
          }
        }
      } else if (st.phase === "ready") {
        engine.idle(dt);
      }

      const dpr = window.devicePixelRatio || 1;
      const w = cw;
      const h = ch;
      const bw = Math.round(w * dpr);
      const bh = Math.round(h * dpr);
      if (canvas.width !== bw || canvas.height !== bh) {
        canvas.width = bw;
        canvas.height = bh;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      drawWorld(ctx, st, w, h);

      const next: Hud = {
        phase: st.phase,
        score: st.score,
        meters: Math.floor(st.rideDistance / 40),
        hearts: st.hearts,
        combo: st.combo,
      };
      if (
        next.phase !== hudCache.phase || next.score !== hudCache.score || next.meters !== hudCache.meters ||
        next.hearts !== hudCache.hearts || next.combo !== hudCache.combo
      ) {
        hudCache = next;
        setHud(next);
      }
    };
    raf = requestAnimationFrame(loop);

    const onKeyDown = (e: KeyboardEvent) => {
      if (!isActiveRef.current) return;
      const st = engineRef.current?.state;
      if (!st) return;
      switch (e.code) {
        case "Space":
        case "ArrowUp":
        case "KeyW":
        case "Enter":
          e.preventDefault();
          if (!e.repeat) action.current();
          break;
        case "ArrowDown":
        case "KeyS":
          e.preventDefault();
          inputRef.current.duckHeld = true;
          break;
        case "KeyP":
          togglePause.current();
          break;
        case "KeyM":
          toggleMusic.current();
          break;
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "ArrowDown" || e.code === "KeyS") inputRef.current.duckHeld = false;
    };
    const onBlur = () => {
      if (engineRef.current?.state.phase === "running" && !pausedRef.current) togglePause.current();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      audio.dispose();
      if (bestRef.current > savedBestRef.current) void cfgSet(BEST_KEY, bestRef.current);
    };
  }, []);

  // ── isActive：切走自动暂停，不抢键盘 ──
  useEffect(() => {
    isActiveRef.current = _props.isActive ?? true;
    if (!_props.isActive && engineRef.current?.state.phase === "running" && !pausedRef.current) {
      togglePause.current();
    }
  }, [_props.isActive]);

  // ── 读配置：最高分 / 音乐偏好 ──
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const cfg = config();
        if (!cfg) return;
        const b = await cfg.get(BEST_KEY);
        const m = await cfg.get(MUSIC_KEY);
        if (!alive) return;
        if (typeof b === "number" && b > bestRef.current) {
          bestRef.current = b;
          savedBestRef.current = b;
          setBest(b);
        }
        if (typeof m === "boolean") {
          musicOnRef.current = m;
          setMusicOn(m);
          if (!m) audioRef.current?.stopMusic();
        }
      } catch {
        /* 内存态兜底 */
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const stop = (e: React.SyntheticEvent) => e.stopPropagation();

  return (
    <div ref={wrapRef} className="geme-tihu-bicycle-root">
      <canvas
        ref={canvasRef}
        className="geme-tihu-bicycle-canvas"
        onPointerDown={() => action.current()}
      />

      <div className="geme-tihu-bicycle-hud">
        <div className="geme-tihu-bicycle-chip">
          {t("得分")} <b>{hud.score}</b>
        </div>
        <div className="geme-tihu-bicycle-chip">
          <b>{hud.meters}</b> m
        </div>
        <div className="geme-tihu-bicycle-chip">
          {[0, 1, 2].map((i) => (
            <span
              key={i}
              className={`geme-tihu-bicycle-heart${i < hud.hearts ? "" : " geme-tihu-bicycle-heart--off"}`}
            >
              ♥
            </span>
          ))}
        </div>
        {hud.phase === "running" && hud.combo > 1 && (
          <div className="geme-tihu-bicycle-chip geme-tihu-bicycle-combo">×{hud.combo}</div>
        )}
        <div className="geme-tihu-bicycle-spacer" />
        <div className="geme-tihu-bicycle-chip">
          {t("最高分")} <b>{Math.max(best, hud.score)}</b>
        </div>
        <button
          type="button"
          className="geme-tihu-bicycle-btn"
          title={t("音乐")}
          aria-label={t("音乐")}
          onClick={(e) => {
            stop(e);
            toggleMusic.current();
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
            {musicOn ? (
              <path d="M6 2.5v8.05A2.6 2.6 0 1 0 7.5 13V5.6l5-1.3v4.25A2.6 2.6 0 1 0 14 11V2l-8 2.1z" />
            ) : (
              <path d="M6 2.5v3.4l5.9 5.9c.05-.2.1-.4.1-.63V5.6l1.6-.4V2.6L6 4.6zM2.2 1 1 2.2l4.6 4.6v.05A2.6 2.6 0 1 0 7.5 13c0-.6-.2-1.15-.54-1.6L13 15.4l1.2-1.2L2.2 1z" />
            )}
          </svg>
        </button>
        {hud.phase === "running" && (
          <button
            type="button"
            className="geme-tihu-bicycle-btn"
            title={t("暂停")}
            aria-label={t("暂停")}
            onClick={(e) => {
              stop(e);
              togglePause.current();
            }}
          >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden>
              {paused ? (
                <path d="M4 2.5v11l9-5.5z" />
              ) : (
                <path d="M4 2h3v12H4zM9 2h3v12H9z" />
              )}
            </svg>
          </button>
        )}
      </div>

      {hud.phase === "ready" && (
        <div className="geme-tihu-bicycle-overlay" onPointerDown={() => action.current()}>
          <div className="geme-tihu-bicycle-panel">
            <h1 className="geme-tihu-bicycle-title">{t("鹈鹕骑行")}</h1>
            <p className="geme-tihu-bicycle-sub">
              {t("海边公路无尽骑行——跳跃、俯冲、吃鱼，小心路障和海鸥！")}
            </p>
            <div className="geme-tihu-bicycle-controls">
              <span>
                <kbd className="geme-tihu-bicycle-kbd">{t("空格")}</kbd>
                {"/"}
                <kbd className="geme-tihu-bicycle-kbd">{t("点击")}</kbd> {t("跳跃")}
              </span>
              <span>
                <kbd className="geme-tihu-bicycle-kbd">↓</kbd> {t("俯冲")}
              </span>
              <span>
                <kbd className="geme-tihu-bicycle-kbd">P</kbd> {t("暂停")} ·{" "}
                <kbd className="geme-tihu-bicycle-kbd">M</kbd> {t("音乐")}
              </span>
            </div>
            <p className="geme-tihu-bicycle-tip">{t("吃鱼得分，连击加成！三条命，撞一次少一条。")}</p>
            {best > 0 && (
              <p className="geme-tihu-bicycle-best">
                {t("最高分")} <b>{best}</b>
              </p>
            )}
            <button
              type="button"
              className="geme-tihu-bicycle-start"
              onClick={(e) => {
                stop(e);
                startGame.current();
              }}
            >
              {t("开始游戏")}
            </button>
            <p className="geme-tihu-bicycle-hint">{t("按 空格 或点击开始")}</p>
          </div>
        </div>
      )}

      {paused && hud.phase === "running" && (
        <div className="geme-tihu-bicycle-overlay" onPointerDown={() => action.current()}>
          <div className="geme-tihu-bicycle-panel">
            <h2 className="geme-tihu-bicycle-title geme-tihu-bicycle-title--sm">{t("已暂停")}</h2>
            <button
              type="button"
              className="geme-tihu-bicycle-start"
              onClick={(e) => {
                stop(e);
                togglePause.current();
              }}
            >
              {t("继续")}
            </button>
          </div>
        </div>
      )}

      {hud.phase === "over" && (
        <div className="geme-tihu-bicycle-overlay" onPointerDown={() => action.current()}>
          <div className="geme-tihu-bicycle-panel">
            <h2 className="geme-tihu-bicycle-title geme-tihu-bicycle-title--sm">{t("游戏结束")}</h2>
            {newRecord && <div className="geme-tihu-bicycle-record">{t("新纪录！")}</div>}
            <div className="geme-tihu-bicycle-result">
              <div>
                <span>{t("得分")}</span>
                <b>{hud.score}</b>
              </div>
              <div>
                <span>{t("最高分")}</span>
                <b>{best}</b>
              </div>
            </div>
            <button
              type="button"
              className="geme-tihu-bicycle-start"
              onClick={(e) => {
                stop(e);
                restart.current();
              }}
            >
              {t("再来一局")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
