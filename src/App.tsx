import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BookOpen, CalendarDays, ChevronDown, ChevronRight, Eye, EyeOff, Heart, Home, Images, ListChecks, LockKeyhole, Mail, Music2, Pause, Play, RefreshCw, Repeat, Repeat1, Shuffle, SkipBack, SkipForward, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api, jsonBody } from "./api";
import { addDays, calendarDuration, daysBetween, isValidDateOnly, nextAnnualOccurrence, shanghaiDate } from "./date-utils";
import { fisherYatesShuffle } from "./random-utils";
import type { Album, Anniversary, Content, HomepageCoreType, HomepageModule, Letter, MusicTrack, PlaybackMode } from "./types";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type AuthState = "checking" | "locked" | "open" | "error";

const navigation = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/stories", label: "故事", icon: BookOpen },
  { to: "/gallery", label: "相册", icon: Images },
  { to: "/letters", label: "情书", icon: Mail },
  { to: "/wishes", label: "愿望", icon: ListChecks }
] as const;

const dialogFocusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])"
].join(",");

function useDialogAccessibility<T extends HTMLElement>(open: boolean, onClose: () => void) {
  const root = useRef<T>(null);
  const closeRef = useRef(onClose);
  const previousFocus = useRef<HTMLElement | null>(null);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !root.current) return;
    const element = root.current;
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const frame = window.requestAnimationFrame(() => {
      const initial = element.querySelector<HTMLElement>("[data-dialog-initial-focus]")
        || element.querySelector<HTMLElement>(dialogFocusableSelector)
        || element;
      initial.focus({ preventScroll: true });
    });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(element.querySelectorAll<HTMLElement>(dialogFocusableSelector))
        .filter((item) => item.getClientRects().length > 0);
      if (!focusable.length) {
        event.preventDefault();
        element.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKeyDown);
      if (previousFocus.current?.isConnected) previousFocus.current.focus({ preventScroll: true });
    };
  }, [open]);

  return root;
}

function ResilientImage({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  if (failed) {
    return <div className={`media-load-error ${className}`} role="img" aria-label={`${alt}加载失败`}><Images size={22} /><span>照片暂时无法加载</span></div>;
  }
  return <img className={className} src={src} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />;
}

function sameMonthDay(date: string | null | undefined, today: string) {
  return Boolean(date && nextAnnualOccurrence(date, today) === today);
}

function yearsSince(date: string, today: string) {
  const [year, month, day] = date.split("-").map(Number);
  const [todayYear, todayMonth, todayDay] = today.split("-").map(Number);
  if (![year, month, day, todayYear, todayMonth, todayDay].every(Number.isFinite)) return 0;
  let years = todayYear - year;
  if (todayMonth < month || (todayMonth === month && todayDay < day)) years -= 1;
  return Math.max(0, years);
}

type SpecialSurprise = {
  id: string;
  kicker: string;
  title: string;
  message: string;
  signature: string;
  dateLabel: string;
  accent: "blue" | "red" | "gold";
};

function formatSpecialDate(date: string) {
  return date.replaceAll("-", ".");
}

function birthdayFromAnniversaries(content: Content, name: string) {
  return content.anniversaries.find((item) => item.enabled && item.title.includes(name) && item.title.includes("生日"))?.eventDate || "";
}

function getSpecialSurprise(content: Content, today = shanghaiDate()): SpecialSurprise | null {
  const { settings } = content;
  const signature = `From ${settings.manName}`;
  const womanBirthday = settings.womanBirthday || birthdayFromAnniversaries(content, settings.womanName);
  const manBirthday = settings.manBirthday || birthdayFromAnniversaries(content, settings.manName);
  const candidates: Array<Omit<SpecialSurprise, "storageKey" | "dateLabel">> = [];

  if (sameMonthDay(womanBirthday, today)) {
    candidates.push({
      id: "woman-birthday",
      kicker: "BIRTHDAY LETTER",
      title: `${settings.womanName}，生日快乐`,
      message: "今天你不用努力可爱，也不用证明什么；你出现本身，就已经是我这一年最想感谢的事。愿我能把你照顾得更安心一点，把你的每个小愿望都慢慢陪你实现。",
      signature,
      accent: "red"
    });
  }

  if (sameMonthDay(manBirthday, today)) {
    candidates.push({
      id: "man-birthday",
      kicker: "BIRTHDAY WISH",
      title: "今天，我想把生日愿望也留给我们",
      message: `又长大一岁，最想许的愿望还是和你有关：愿我一直记得珍惜 ${settings.womanName}，也愿我们继续好好说话、好好相爱，把未来过成可以回头微笑的样子。`,
      signature,
      accent: "blue"
    });
  }

  if (addDays(settings.togetherDate, 100) === today || daysBetween(settings.togetherDate, today) === 100) {
    candidates.push({
      id: "love-100",
      kicker: "100 DAYS TOGETHER",
      title: "今天是我们相爱的第 100 天",
      message: "从我们开始恋爱的那一天到今天，我还是想把答案再说一遍：谢谢你愿意走进我的生活。以后每一个普通日子，我都会更认真地爱你，更及时地让你感到被坚定选择。",
      signature,
      accent: "gold"
    });
  }

  const loveYears = yearsSince(settings.togetherDate, today);
  if (loveYears >= 1 && sameMonthDay(settings.togetherDate, today)) {
    candidates.push({
      id: `love-anniversary-${loveYears}`,
      kicker: "LOVE ANNIVERSARY",
      title: loveYears === 1 ? "相爱一周年快乐" : `相爱 ${loveYears} 周年快乐`,
      message: `谢谢你把这一段时间交给我。越喜欢你，越觉得爱不是一句话说完，而是在每一次选择里都把 ${settings.womanName} 放进心里。下一年，也请继续让我牵住你。`,
      signature,
      accent: "red"
    });
  }

  if (today.endsWith("-05-20")) {
    candidates.push({
      id: "may-20",
      kicker: "LOVE CODE · 520",
      title: "520 快乐",
      message: "原来这个数字不是用来说一次就结束，而是提醒我：遇见你以后，连日期都开始偷偷偏心。今天也想认真告诉你，我爱你，且不只在 520 爱你。",
      signature,
      accent: "blue"
    });
  }

  const surprise = candidates[0];
  return surprise ? { ...surprise, dateLabel: formatSpecialDate(today) } : null;
}

function nextAnniversary(items: Anniversary[]) {
  const today = shanghaiDate();
  return items.flatMap((item) => {
    if (!item.enabled) return [];
    const date = item.annual
      ? nextAnnualOccurrence(item.eventDate, today)
      : isValidDateOnly(item.eventDate)
        ? item.eventDate
        : null;
    if (!date) return [];
    if (date < today) return [];
    return [{ ...item, nextDate: date, remaining: daysBetween(today, date) }];
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
}

function LoginCover({ onOpen }: { onOpen: () => Promise<void> }) {
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      await api("/api/auth/site", { method: "POST", body: jsonBody({ password }) });
      await onOpen();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "解锁失败");
    } finally {
      setLoading(false);
    }
  };
  return (
    <main className="lock-page">
      <div className="paper-noise" />
      <section className="lock-card" aria-labelledby="lock-title">
        <span className="tape tape-blue" />
        <span className="tiny-label">PRIVATE JOURNAL · MEMBERS ONLY</span>
        <div className="lock-monogram"><span>M</span><i /><span>J</span></div>
        <h1 id="lock-title">有些故事，只想说给你听</h1>
        <p>输入专属密码，翻开这本私人纪念册。</p>
        <form onSubmit={submit} className="lock-form">
          <label htmlFor="site-password"><LockKeyhole size={17} /> 专属密码</label>
          <div className="password-row">
            <input id="site-password" type={showPassword ? "text" : "password"} value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" autoCapitalize="none" spellCheck={false} maxLength={128} placeholder="输入密码" autoFocus />
            <button type="button" className="password-visibility" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "隐藏密码" : "显示密码"} aria-pressed={showPassword} title={showPassword ? "隐藏密码" : "显示密码"}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
            <button type="submit" className="password-submit" disabled={loading || !password}>{loading ? "正在翻页" : "打开"}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
        <div className="lock-clues"><span>private</span><span>red thread</span><span>memories</span></div>
      </section>
    </main>
  );
}

function AnimatedPage({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  const root = useRef<HTMLElement>(null);
  const location = useLocation();

  useEffect(() => {
    const mobileScroller = root.current?.closest<HTMLElement>(".site-scroll-viewport");
    if (window.matchMedia("(max-width: 900px)").matches && mobileScroller) mobileScroller.scrollTo({ top: 0, behavior: "auto" });
    else window.scrollTo({ top: 0, behavior: "auto" });
  }, [location.pathname]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const scrollViewport = root.current?.closest<HTMLElement>(".site-scroll-viewport");
      const scrollContainer = window.matchMedia("(max-width: 900px)").matches ? scrollViewport : null;
      const scrollTriggerScroller = scrollContainer ? { scroller: scrollContainer } : {};
      const intro = gsap.utils.toArray<HTMLElement>("[data-page-intro] > *");
      const art = gsap.utils.toArray<HTMLElement>("[data-page-art]");
      if (intro.length || art.length) {
        const timeline = gsap.timeline({ defaults: { ease: "power2.out" } });
        if (intro.length) timeline.from(intro, { autoAlpha: 0, y: 18, duration: 0.58, stagger: 0.055 });
        if (art.length) timeline.from(art, { autoAlpha: 0, y: 22, rotate: 1.5, duration: 0.68 }, intro.length ? "<0.1" : 0);
      }

      gsap.utils.toArray<HTMLElement>("[data-reveal]").forEach((element) => {
        gsap.from(element, {
          autoAlpha: 0,
          y: 24,
          duration: 0.62,
          ease: "power2.out",
          scrollTrigger: { trigger: element, start: "top 88%", once: true, ...scrollTriggerScroller }
        });
      });

      gsap.utils.toArray<HTMLElement>("[data-stagger]").forEach((container) => {
        const children = Array.from(container.children);
        if (!children.length) return;
        gsap.from(children, {
          autoAlpha: 0,
          y: 18,
          duration: 0.52,
          stagger: 0.07,
          ease: "power2.out",
          scrollTrigger: { trigger: container, start: "top 88%", once: true, ...scrollTriggerScroller }
        });
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [location.pathname], revertOnUpdate: true });

  return <main ref={root} className={`journal-page ${className}`}>{children}</main>;
}

function NumberSecret({ number, title, children, variant, revealStyle }: { number: string; title: string; children: React.ReactNode; variant: string; revealStyle: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className={`number-secret ${variant} reveal-${revealStyle} ${open ? "is-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="number-secret-inner">
        <span className="number-face" aria-hidden={open}><b>{number}</b><small>轻触翻开</small></span>
        <span className="number-back" aria-hidden={!open}><strong>{title}</strong><span>{children}</span><small>轻触收起这页</small></span>
      </span>
    </button>
  );
}

type QuestionDrawConfig = { eyebrow: string; title: string; description: string; buttonLabel: string; questions: string[] };
type MemoryMatchConfig = { eyebrow: string; title: string; description: string; pairs: string[] };
type AnniversaryDrawConfig = { eyebrow: string; title: string; description: string; buttonLabel: string; options: string[] };

function PlayfulHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <div className="section-heading"><small>{eyebrow}</small><h2>{title}</h2><p>{description}</p></div>;
}

function QuestionDraw({ config }: { config: QuestionDrawConfig }) {
  const [index, setIndex] = useState<number | null>(null);
  const draw = () => setIndex((current) => {
    const choices = config.questions.map((_, itemIndex) => itemIndex).filter((itemIndex) => itemIndex !== current);
    return choices[Math.floor(Math.random() * choices.length)] ?? 0;
  });
  return <section className="playful-module question-draw scrapbook-section" data-reveal><PlayfulHeading eyebrow={config.eyebrow} title={config.title} description={config.description} /><div className={`question-slip ${index !== null ? "is-drawn" : ""}`} aria-live="polite"><small>{index === null ? "WAITING FOR A QUESTION" : `QUESTION ${String(index + 1).padStart(2, "0")}`}</small><strong>{index === null ? "把一张空白纸条留给此刻。" : config.questions[index]}</strong></div><button className="paper-button playful-action" type="button" onClick={draw}><Shuffle size={17} /> {config.buttonLabel}</button></section>;
}

function shuffleLabels(labels: string[]) {
  return fisherYatesShuffle(labels.flatMap((label, pairId) => [
    { label, pairId, key: `${pairId}-a` },
    { label, pairId, key: `${pairId}-b` }
  ]));
}

function MemoryMatch({ config }: { config: MemoryMatchConfig }) {
  const [cards, setCards] = useState(() => shuffleLabels(config.pairs));
  const [open, setOpen] = useState<number[]>([]);
  const [matched, setMatched] = useState<number[]>([]);
  useEffect(() => { setCards(shuffleLabels(config.pairs)); setOpen([]); setMatched([]); }, [config.pairs.join("|")]);
  const choose = (index: number) => {
    if (open.includes(index) || matched.includes(cards[index].pairId) || open.length >= 2) return;
    const next = [...open, index];
    setOpen(next);
    if (next.length === 2) {
      if (cards[next[0]].pairId === cards[next[1]].pairId) { setMatched((current) => [...current, cards[next[0]].pairId]); setOpen([]); }
      else window.setTimeout(() => setOpen([]), 650);
    }
  };
  const reset = () => { setCards(shuffleLabels(config.pairs)); setOpen([]); setMatched([]); };
  return <section className="playful-module memory-match scrapbook-section" data-reveal><PlayfulHeading eyebrow={config.eyebrow} title={config.title} description={config.description} /><div className="memory-board">{cards.map((card, index) => { const visible = open.includes(index) || matched.includes(card.pairId); return <button type="button" key={card.key} className={visible ? "is-visible" : ""} onClick={() => choose(index)} aria-label={visible ? card.label : `翻开第 ${index + 1} 张记忆卡`} disabled={matched.includes(card.pairId)}><span>{visible ? card.label : String(index + 1).padStart(2, "0")}</span></button>; })}</div><div className="game-status" aria-live="polite"><span>{matched.length === config.pairs.length ? "所有记忆都配成了一对。" : `已经找到 ${matched.length} / ${config.pairs.length} 对`}</span><button type="button" onClick={reset} aria-label="重新开始记忆配对"><RefreshCw size={16} /></button></div></section>;
}

function AnniversaryDraw({ config }: { config: AnniversaryDrawConfig }) {
  const [result, setResult] = useState<string | null>(null);
  const draw = () => setResult(config.options[Math.floor(Math.random() * config.options.length)] || null);
  return <section className="playful-module anniversary-draw scrapbook-section" data-reveal><PlayfulHeading eyebrow={config.eyebrow} title={config.title} description={config.description} /><div className="draw-box"><div className={result ? "draw-ticket is-picked" : "draw-ticket"} aria-live="polite"><small>OUR NEXT LITTLE PLAN</small><strong>{result || "抽一张属于下一次见面的安排"}</strong></div><button type="button" className="paper-button playful-action" onClick={draw}><Shuffle size={17} /> {config.buttonLabel}</button></div></section>;
}

function mediaAspectClass(width?: number | null, height?: number | null) {
  if (!width || !height) return "aspect-standard";
  const ratio = width / height;
  if (ratio < .55) return "aspect-tall";
  if (ratio < .9) return "aspect-portrait";
  if (ratio > 1.9) return "aspect-wide";
  if (ratio > 1.15) return "aspect-landscape";
  return "aspect-square";
}

function Polaroid({ src, alt, index, width, height, onOpen, priority = false }: { src?: string | null; alt: string; index: number; width?: number | null; height?: number | null; onOpen?: () => void; priority?: boolean }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [src]);
  const figure = (
    <figure className={`polaroid rotate-${index % 3} ${mediaAspectClass(width, height)}`}>
      <span className="polaroid-media">
        {src && !failed
          ? <img src={src} alt={alt} width={width || undefined} height={height || undefined} loading={priority ? "eager" : "lazy"} decoding={priority ? "auto" : "async"} onError={() => setFailed(true)} />
          : <span className={`drawn-placeholder scene-${index % 6}`} role="img" aria-label={src ? `${alt}加载失败` : `${alt}的插画占位`}><i />{src && <small>照片暂时无法加载</small>}</span>}
      </span>
      <figcaption>{alt}</figcaption>
    </figure>
  );
  return onOpen ? <button type="button" className="polaroid-button" onClick={onOpen} aria-label={`查看大图：${alt}`}>{figure}</button> : figure;
}

const playbackModes: Array<{ id: PlaybackMode; label: string; icon: typeof Repeat }> = [
  { id: "sequence", label: "顺序播放", icon: Repeat },
  { id: "repeat-one", label: "单曲循环", icon: Repeat1 },
  { id: "shuffle", label: "随机播放", icon: Shuffle }
];

function startTrackIndex(tracks: MusicTrack[], startTrackId: number | null) {
  const index = tracks.findIndex((item) => item.id === startTrackId);
  return index >= 0 ? index : 0;
}

function MusicPlayer({ tracks, defaultMode, autoplay, startTrackId }: { tracks: MusicTrack[]; defaultMode: PlaybackMode; autoplay: boolean; startTrackId: number | null }) {
  const location = useLocation();
  const audioRef = useRef<HTMLAudioElement>(null);
  const pendingPlayRef = useRef(false);
  const autoplayArmedRef = useRef(false);
  const pointerStartRef = useRef<number | null>(null);
  const [currentIndex, setCurrentIndex] = useState(() => startTrackIndex(tracks, startTrackId));
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playbackError, setPlaybackError] = useState("");
  const [needsGesture, setNeedsGesture] = useState(false);
  const [collapsed, setCollapsed] = useState(() => window.localStorage.getItem("mj-music-collapsed") === "true");
  const [mode, setMode] = useState<PlaybackMode>(() => {
    const saved = window.localStorage.getItem("mj-music-mode") as PlaybackMode | null;
    return playbackModes.some((item) => item.id === saved) ? saved as PlaybackMode : defaultMode;
  });
  const track = tracks[currentIndex] || tracks[0];

  const tryPlay = async () => {
    const audio = audioRef.current;
    if (!audio) return false;
    try {
      await audio.play();
      setNeedsGesture(false);
      return true;
    } catch {
      setPlaying(false);
      setNeedsGesture(true);
      return false;
    }
  };

  useEffect(() => {
    if (currentIndex >= tracks.length) setCurrentIndex(0);
  }, [currentIndex, tracks.length]);

  useEffect(() => {
    window.localStorage.setItem("mj-music-collapsed", String(collapsed));
  }, [collapsed]);

  useEffect(() => {
    window.localStorage.setItem("mj-music-mode", mode);
  }, [mode]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio || !track) return;
    setCurrentTime(0);
    setDuration(0);
    setPlaybackError("");
    audio.load();
    if (pendingPlayRef.current) {
      pendingPlayRef.current = false;
      void tryPlay();
    }
  }, [track?.id]);

  useEffect(() => {
    if (!autoplay || !track || location.pathname !== "/" || autoplayArmedRef.current) return;
    autoplayArmedRef.current = true;
    let unlocked = false;
    const unlock = () => {
      void tryPlay().then((started) => {
        if (!started || unlocked) return;
        unlocked = true;
        window.removeEventListener("pointerdown", unlock, true);
        window.removeEventListener("keydown", unlock, true);
      });
    };
    pendingPlayRef.current = true;
    void tryPlay().then((ok) => {
      if (ok) {
        unlocked = true;
        return;
      }
      window.addEventListener("pointerdown", unlock, true);
      window.addEventListener("keydown", unlock, true);
    });
    return () => {
      window.removeEventListener("pointerdown", unlock, true);
      window.removeEventListener("keydown", unlock, true);
    };
  }, [autoplay, track?.id, location.pathname]);

  const toggle = async () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      try {
        await audioRef.current.play();
      } catch {
        setPlaying(false);
        setPlaybackError("浏览器未能开始播放这首音乐。");
      }
    } else {
      audioRef.current.pause();
    }
  };

  const playIndex = (index: number, autoplay = playing) => {
    if (!tracks.length) return;
    const normalizedIndex = (index + tracks.length) % tracks.length;
    if (normalizedIndex === currentIndex) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0;
        if (autoplay) {
          void audioRef.current.play().catch(() => {
            setPlaying(false);
            setPlaybackError("这首音乐暂时无法播放。");
          });
        }
      }
      return;
    }
    pendingPlayRef.current = autoplay;
    setCurrentIndex(normalizedIndex);
  };

  const nextTrack = (autoplay = playing) => {
    if (mode === "shuffle" && tracks.length > 1) {
      let next = currentIndex;
      while (next === currentIndex) next = Math.floor(Math.random() * tracks.length);
      playIndex(next, autoplay);
      return;
    }
    playIndex(currentIndex + 1, autoplay);
  };

  const previousTrack = () => {
    const audio = audioRef.current;
    if (audio && audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    playIndex(currentIndex - 1, playing);
  };

  const handleEnded = () => {
    if (mode === "repeat-one" && audioRef.current) {
      audioRef.current.currentTime = 0;
      void audioRef.current.play().catch(() => {
        setPlaying(false);
        setPlaybackError("这首音乐暂时无法继续播放。");
      });
      return;
    }
    nextTrack(true);
  };

  const cycleMode = () => {
    const index = playbackModes.findIndex((item) => item.id === mode);
    setMode(playbackModes[(index + 1) % playbackModes.length].id);
  };

  const formatTime = (value: number) => Number.isFinite(value) ? `${Math.floor(value / 60)}:${String(Math.floor(value % 60)).padStart(2, "0")}` : "0:00";
  const activeMode = playbackModes.find((item) => item.id === mode) || playbackModes[0];
  const ModeIcon = activeMode.icon;

  useEffect(() => {
    if (!track || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: track.title, artist: track.artist, album: "M × J · OUR SOUNDTRACK" });
    try {
      navigator.mediaSession.setActionHandler("play", () => void audioRef.current?.play());
      navigator.mediaSession.setActionHandler("pause", () => audioRef.current?.pause());
      navigator.mediaSession.setActionHandler("previoustrack", previousTrack);
      navigator.mediaSession.setActionHandler("nexttrack", () => nextTrack(true));
    } catch {
      // Some Safari versions expose Media Session without every action.
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler("play", null);
        navigator.mediaSession.setActionHandler("pause", null);
        navigator.mediaSession.setActionHandler("previoustrack", null);
        navigator.mediaSession.setActionHandler("nexttrack", null);
      } catch {
        // Keep normal in-page controls available when platform handlers differ.
      }
    };
  }, [track?.id, mode, currentIndex, playing]);

  useEffect(() => {
    if ("mediaSession" in navigator) navigator.mediaSession.playbackState = playing ? "playing" : "paused";
  }, [playing]);

  if (!track) return null;
  return (
    <div className={collapsed ? "music-drawer is-collapsed" : "music-drawer"} onPointerDown={(event) => { pointerStartRef.current = event.clientX; }} onPointerUp={(event) => { if (pointerStartRef.current === null) return; const delta = event.clientX - pointerStartRef.current; pointerStartRef.current = null; if (!collapsed && delta > 46) setCollapsed(true); if (collapsed && delta < -28) setCollapsed(false); }}>
      <audio
        ref={audioRef}
        src={track.url}
        onPlay={() => { setPlaying(true); setPlaybackError(""); }}
        onPause={() => setPlaying(false)}
        onEnded={handleEnded}
        onError={() => { setPlaying(false); setPlaybackError("这首音乐加载失败，可以跳到下一首。"); }}
        onLoadedMetadata={(event) => setDuration(event.currentTarget.duration || 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
      />
      {collapsed ? <button type="button" className="music-pull-tab" onClick={() => setCollapsed(false)} aria-label="展开音乐播放器"><Music2 size={18} /><span>{playing ? "正在播放" : needsGesture ? "点按播放" : "音乐"}</span></button> : <section className="music-player" data-playing={playing} aria-label="主页音乐播放器">
        <button type="button" className="music-collapse" onClick={() => setCollapsed(true)} aria-label="收起音乐播放器" title="向右滑动也可收起"><ChevronRight size={17} /></button>
        <div className="music-heading"><div className="music-meta"><small>OUR SOUNDTRACK · {String(currentIndex + 1).padStart(2, "0")}/{String(tracks.length).padStart(2, "0")}</small><strong>{track.title}</strong><span>{track.artist}</span></div><span className={playing ? "sound-wave is-playing" : "sound-wave"}><i /><i /><i /><i /></span></div>
        {needsGesture && !playbackError && <div className="music-error" role="status">浏览器拦截了自动播放，点按页面任意处即可开始。</div>}
        {playbackError && <div className="music-error" role="alert"><span>{playbackError}</span><button type="button" onClick={() => { setPlaybackError(""); nextTrack(true); }}>下一首</button></div>}
        <div className="music-progress"><input type="range" min="0" max={duration || 0} step="0.1" value={Math.min(currentTime, duration || 0)} onChange={(event) => { if (audioRef.current) audioRef.current.currentTime = Number(event.target.value); }} aria-label="播放进度" /><div><time>{formatTime(currentTime)}</time><time>{formatTime(duration)}</time></div></div>
        <div className="music-controls"><button type="button" onClick={previousTrack} aria-label="上一首"><SkipBack /></button><button type="button" className="music-play" onClick={toggle} aria-label={playing ? "暂停音乐" : "播放音乐"} aria-pressed={playing}>{playing ? <Pause /> : <Play />}</button><button type="button" onClick={() => nextTrack(playing)} aria-label="下一首"><SkipForward /></button><button type="button" className="music-mode" onClick={cycleMode} aria-label={`当前${activeMode.label}，点击切换`} title={activeMode.label}><ModeIcon /><span>{activeMode.label}</span></button></div>
        <small className="music-gesture-hint">向右滑动收起</small>
      </section>}
    </div>
  );
}

function SpecialDaySurprise({ content }: { content: Content }) {
  const surprise = useMemo(() => getSpecialSurprise(content), [content]);
  const [active, setActive] = useState<SpecialSurprise | null>(null);
  const [hasOpened, setHasOpened] = useState(false);
  const root = useDialogAccessibility<HTMLDivElement>(Boolean(active), () => setActive(null));

  useEffect(() => {
    if (!surprise) {
      setActive(null);
      setHasOpened(false);
      return;
    }
    setHasOpened(false);
    const timer = window.setTimeout(() => {
      setActive(surprise);
      setHasOpened(true);
    }, 420);
    return () => window.clearTimeout(timer);
  }, [surprise?.id]);

  useGSAP(() => {
    if (!active || !root.current) return;
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
      const card = root.current?.querySelector<HTMLElement>(".surprise-card");
      if (!card) return;
      const floaters = Array.from(root.current?.querySelectorAll<HTMLElement>(".surprise-float") || []);
      gsap.fromTo(card, { autoAlpha: 0, y: 28, rotate: -2.2, scale: .96 }, { autoAlpha: 1, y: 0, rotate: 0, scale: 1, duration: .72, ease: "back.out(1.35)" });
      gsap.from(floaters, { autoAlpha: 0, y: -70, rotation: () => gsap.utils.random(-42, 42), duration: 1.15, stagger: .032, ease: "power2.out" });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [active?.id], revertOnUpdate: true });

  const floaters = ["520", "100", "M", "J", "LOVE", "3·14", "♡", "✦", "520", "♡", "M", "J", "100", "✦", "LOVE", "♡"];
  return (
    <>
      {active && <div ref={root} className={`surprise-backdrop accent-${active.accent}`} tabIndex={-1} onClick={() => setActive(null)}>
        <div className="surprise-fall" aria-hidden="true">
          {floaters.map((label, index) => <span className="surprise-float" key={`${label}-${index}`} style={{ left: `${6 + (index * 83) % 88}%`, animationDelay: `${index * .13}s` }}>{label}</span>)}
        </div>
        <section className="surprise-card" role="dialog" aria-modal="true" aria-labelledby="surprise-title" onClick={(event) => event.stopPropagation()}>
          <button type="button" className="surprise-close" aria-label="收起惊喜" data-dialog-initial-focus onClick={() => setActive(null)}><X size={18} /></button>
          <span className="tape tape-red" />
          <div className="surprise-date">{active.dateLabel}</div>
          <div className="surprise-mark"><Heart /><span>M × J</span></div>
          <small>{active.kicker}</small>
          <h2 id="surprise-title">{active.title}</h2>
          <p>{active.message}</p>
          <footer>{active.signature}</footer>
          <button type="button" className="paper-button surprise-action" onClick={() => setActive(null)}><Heart size={17} /> 收好这一天</button>
        </section>
      </div>}
      {surprise && hasOpened && !active && <button type="button" className={`surprise-replay accent-${surprise.accent}`} onClick={() => { setActive(surprise); setHasOpened(true); }} aria-label="重新打开今日惊喜">
        <Sparkles size={18} />
        <span>今日惊喜</span>
      </button>}
    </>
  );
}

function SiteNavigation() {
  const [hidden, setHidden] = useState(false);
  const location = useLocation();
  useEffect(() => {
    setHidden(false);
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let lastY = Math.max(0, window.scrollY);
    let downDistance = 0;
    let upDistance = 0;
    let frame = 0;
    const showHeader = () => {
      downDistance = 0;
      setHidden(false);
    };
    const evaluateScroll = () => {
      frame = 0;
      const currentY = Math.max(0, window.scrollY);
      const delta = currentY - lastY;
      lastY = currentY;
      if (reducedMotion.matches || currentY <= 12) {
        showHeader();
        return;
      }
      if (Math.abs(delta) < 4) return;
      if (delta > 0) {
        downDistance += delta;
        upDistance = 0;
        if (currentY > 72 && downDistance >= 24) setHidden(true);
      } else {
        upDistance += Math.abs(delta);
        downDistance = 0;
        if (upDistance >= 10) showHeader();
      }
    };
    const onScroll = () => {
      if (!frame) frame = window.requestAnimationFrame(evaluateScroll);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") showHeader();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("visibilitychange", onVisibilityChange);
    reducedMotion.addEventListener("change", showHeader);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      reducedMotion.removeEventListener("change", showHeader);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [location.pathname]);
  return (
    <>
      <header className={`site-header ${hidden ? "is-hidden" : ""}`} onFocus={() => setHidden(false)} onPointerDown={() => setHidden(false)}>
        <Link to="/" className="wordmark">M <i /> J</Link>
        <nav aria-label="主要导航">
          {navigation.slice(1).map((item) => <NavLink key={item.to} to={item.to} className={({ isActive }) => isActive ? "active" : ""}>{item.label}</NavLink>)}
        </nav>
        <Link className="admin-link" to="/admin">管理</Link>
      </header>
      <nav className="mobile-site-nav" aria-label="移动端主要导航">
        {navigation.map(({ to, label, icon: Icon, ...item }) => <NavLink key={to} to={to} end={"end" in item ? item.end : false} className={({ isActive }) => isActive ? "active" : ""}><Icon size={18} /><span>{label}</span></NavLink>)}
      </nav>
    </>
  );
}

function PageHeading({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) {
  return <header className="page-heading scrapbook-section" data-page-intro><small>{eyebrow}</small><h1>{title}</h1><p>{description}</p></header>;
}

function HomePage({ content }: { content: Content }) {
  const { settings } = content;
  const home = content.homepage.settings;
  const today = shanghaiDate();
  const knownDays = daysBetween(settings.metDate, today);
  const loveDays = daysBetween(settings.togetherDate, today);
  const duration = calendarDuration(settings.togetherDate, today);
  const next = useMemo(() => nextAnniversary(content.anniversaries), [content.anniversaries]);
  const pendingWishes = content.wishes.filter((wish) => wish.status === "pending").length;
  const fallbackHero = content.timeline.at(-1) || content.timeline[0];
  const heroUrl = home.heroMediaUrl || fallbackHero?.imageUrl;
  const heroWidth = home.heroMediaUrl ? home.heroMediaWidth : fallbackHero?.imageWidth;
  const heroHeight = home.heroMediaUrl ? home.heroMediaHeight : fallbackHero?.imageHeight;

  const sections: Record<HomepageCoreType, React.ReactNode> = {
    hero: <section className="hero scrapbook-section" key="hero">
      <div className="hero-copy" data-page-intro>
        <span className="eyebrow">{home.heroEyebrow}</span>
        {home.heroTitle ? <h1>{home.heroTitle}</h1> : <h1>{settings.manName}<span>{home.heroJoiner}</span>{settings.womanName}</h1>}
        {settings.subtitle && settings.subtitle !== home.heroSubtitle && <p className="site-subtitle">{settings.subtitle}</p>}
        <p className="hero-subtitle">{home.heroSubtitle}</p>
        <div className="hero-stats">
          <div><b>{knownDays}</b><span>相识的日子</span></div>
          <div><b>{loveDays}</b><span>成为恋人的日子</span></div>
          <div><b>{duration.years}<em>年</em>{duration.months}<em>月</em>{duration.days}<em>天</em></b><span>认真相爱至今</span></div>
        </div>
        <Link className="paper-button" to={home.heroCtaTarget}>{home.heroCtaLabel} <ChevronDown size={18} /></Link>
      </div>
      <div className="hero-collage" data-page-art>
        <Polaroid src={heroUrl} alt={home.heroMediaCaption} index={1} width={heroWidth} height={heroHeight} priority />
        <div className="date-stamp">SINCE<br /><b>{settings.togetherDate.replaceAll("-", ".")}</b></div>
        <span className="doodle-heart"><Heart /></span>
      </div>
      <div className="thread thread-blue" /><div className="thread thread-red" />
    </section>,
    nextDate: <section className="next-date scrapbook-section" data-reveal key="nextDate">
      <div className="section-kicker"><CalendarDays size={18} /> {home.nextKicker}</div>
      {next ? <><p>{home.nextPrefix}「{next.title}」还有</p><strong>{next.remaining}<span>天</span></strong><small>{next.nextDate.replaceAll("-", ".")} · {next.description}</small></> : <p>{home.nextFallback}</p>}
    </section>,
    profiles: <section className="people scrapbook-section" data-stagger key="profiles">
      <div className="person-card blue-note"><span className="tape tape-blue" /><small>ABOUT HIM</small><h2>{settings.manName}</h2><i>“{home.manQuote}”</i></div>
      <div className="between-note"><span>{home.profilesIntro}</span><Heart /><b>{home.profilesOutro}</b></div>
      <div className="person-card red-note"><span className="tape tape-red" /><small>ABOUT HER</small><h2>{settings.womanName}</h2><i>“{home.womanQuote}”</i></div>
    </section>,
    secrets: <section className="numbers scrapbook-section" aria-labelledby="number-title" data-reveal key="secrets">
      <div className="section-heading"><small>{home.secretsEyebrow}</small><h2 id="number-title">{home.secretsTitle}</h2><p>{home.secretsDescription}</p></div>
      <div className="number-grid" data-stagger>{content.homepage.secrets.map((secret) => <NumberSecret key={secret.id} number={secret.numberText} title={secret.title} variant={`secret-${secret.accent}`} revealStyle={secret.revealStyle}>{secret.body}</NumberSecret>)}</div>
    </section>,
    contents: <section className="home-index scrapbook-section" data-reveal key="contents">
      <div className="section-heading"><small>{home.contentsEyebrow}</small><h2>{home.contentsTitle}</h2><p>{home.contentsDescription}</p></div>
      <div className="home-index-grid" data-stagger>
        <Link to="/stories"><BookOpen /><small>STORIES · {content.timeline.length}</small><h3>故事</h3><p>{content.timeline.at(-1)?.title || "从第一章开始读"}</p><span>进入时间线 →</span></Link>
        <Link to="/gallery"><Images /><small>ALBUMS · {content.albums.length}</small><h3>相册</h3><p>{content.albums.at(-1)?.title || "把平常的日子留下"}</p><span>翻看相册 →</span></Link>
        <Link to="/letters"><Mail /><small>LETTERS · {content.letters.length}</small><h3>情书</h3><p>{content.letters.at(-1)?.title || "打开写给彼此的话"}</p><span>拆开信封 →</span></Link>
        <Link to="/wishes"><ListChecks /><small>PENDING · {pendingWishes}</small><h3>愿望</h3><p>把未来拆成可以一起期待的小事。</p><span>查看愿望 →</span></Link>
      </div>
    </section>,
    ending: <section className="ending scrapbook-section" data-reveal key="ending"><Sparkles /><p>{home.endingKicker}</p><h2>{home.endingHeadline}</h2><span>{home.endingSignature}</span></section>
  };

  const renderModule = (module: HomepageModule) => {
    if (module.blockType in sections) return sections[module.blockType as HomepageCoreType];
    if (module.blockType === "questionDraw") return <QuestionDraw key={module.id} config={module.config as QuestionDrawConfig} />;
    if (module.blockType === "memoryMatch") return <MemoryMatch key={module.id} config={module.config as MemoryMatchConfig} />;
    if (module.blockType === "anniversaryDraw") return <AnniversaryDraw key={module.id} config={module.config as AnniversaryDrawConfig} />;
    return null;
  };

  return (
    <AnimatedPage className="home-page">
      {content.homepage.modules.filter((module) => module.enabled).sort((a, b) => a.sortOrder - b.sortOrder).map(renderModule)}
    </AnimatedPage>
  );
}

function StoriesPage({ content, openLightbox }: { content: Content; openLightbox: (src: string) => void }) {
  const hasStories = content.timeline.length > 0;
  return (
    <AnimatedPage>
      <PageHeading eyebrow={hasStories ? `CHAPTERS 01—${String(content.timeline.length).padStart(2, "0")}` : "CHAPTERS · 00"} title="我们的故事，慢慢写" description={content.settings.heroNote} />
      <section className={`story scrapbook-section ${hasStories ? "" : "is-empty"}`}>
        <div className="timeline">
          {content.timeline.map((event, index) => (
            <article key={event.id} className={`timeline-entry ${index % 2 ? "right" : "left"}`} data-reveal>
              <div className="timeline-number">{String(index + 1).padStart(2, "0")}</div>
              <Polaroid src={event.imageUrl} alt={event.title} index={index} width={event.imageWidth} height={event.imageHeight} onOpen={event.imageUrl ? () => openLightbox(event.imageUrl!) : undefined} />
              <div className="timeline-copy"><time>{event.dateLabel}</time><h3>{event.title}</h3><p>{event.body}</p></div>
            </article>
          ))}
          {!hasStories && <div className="empty-public">故事页还在等待第一段回忆。</div>}
        </div>
      </section>
    </AnimatedPage>
  );
}

function AlbumCover({ album }: { album: Album }) {
  const cover = album.coverUrl || album.media[0]?.thumbUrl;
  return <Link className="album-index-card" to={`/gallery/${album.id}`} data-reveal>{cover ? <ResilientImage src={cover} alt={album.title} /> : <div className="drawn-placeholder scene-2"><span /></div>}<div><small>{album.eventDate?.replaceAll("-", ".") || `${album.media.length} PHOTOS`}</small><h2>{album.title}</h2><p>{album.description}</p><span>打开这本相册 →</span></div></Link>;
}

function GalleryPage({ content }: { content: Content }) {
  return (
    <AnimatedPage>
      <PageHeading eyebrow={`PHOTO POCKETS · ${content.albums.length} ALBUMS`} title="把平常的日子留下来" description="照片按相册与日期归档，每一本都有自己的页面。" />
      <section className="album-index scrapbook-section" data-stagger>{content.albums.map((album) => <AlbumCover key={album.id} album={album} />)}{!content.albums.length && <div className="empty-public">还没有相册，照片会在这里按册收藏。</div>}</section>
    </AnimatedPage>
  );
}

function AlbumPage({ content, openLightbox }: { content: Content; openLightbox: (src: string) => void }) {
  const { albumId } = useParams();
  const album = content.albums.find((item) => item.id === Number(albumId));
  if (!album) return <Navigate to="/gallery" replace />;
  return (
    <AnimatedPage>
      <header className="page-heading scrapbook-section" data-page-intro><small><Link to="/gallery">相册</Link> / ALBUM {album.id}</small><h1>{album.title}</h1><p>{album.eventDate ? `${album.eventDate.replaceAll("-", ".")} · ` : ""}{album.description}</p></header>
      <section className="album-detail scrapbook-section">
        <div className="album-photo-grid" data-stagger>
          {album.media.map((item, index) => {
            const src = item.url || item.thumbUrl;
            const displayName = item.displayName || item.originalName;
            return <article key={item.id}><Polaroid src={src} alt={displayName} index={index} width={item.imageWidth} height={item.imageHeight} onOpen={item.url ? () => openLightbox(item.url!) : undefined} />{item.takenDate && <time>{item.takenDate.replaceAll("-", ".")}</time>}{item.caption && <p className="album-photo-caption">{item.caption}</p>}</article>;
          })}
        </div>
        {!album.media.length && <div className="empty-public">这本相册还在等待第一张照片。</div>}
      </section>
    </AnimatedPage>
  );
}

function letterExcerpt(letter: Letter) {
  return letter.body.replace(/[#*_>`\[\]()~-]/g, "").replace(/\s+/g, " ").trim().slice(0, 110);
}

function LettersPage({ content }: { content: Content }) {
  return (
    <AnimatedPage>
      <PageHeading eyebrow={`PRIVATE LETTERS · ${content.letters.length}`} title="写给彼此的话" description="每一封信单独收藏，想读的时候再慢慢拆开。" />
      <section className="letter-index scrapbook-section" data-stagger>
        {content.letters.map((letter, index) => <Link to={`/letters/${letter.id}`} className="letter-index-card" key={letter.id}><div className="letter-mini-envelope"><span>{String(index + 1).padStart(2, "0")}</span><i /></div><div><small>PRIVATE LETTER</small><h2>{letter.title}</h2><p>{letterExcerpt(letter)}</p><span>拆开这封信 →</span></div></Link>)}
        {!content.letters.length && <div className="empty-public">还没有公开的情书，写下的话会收藏在这里。</div>}
      </section>
    </AnimatedPage>
  );
}

function LetterPage({ content }: { content: Content }) {
  const { letterId } = useParams();
  const letter = content.letters.find((item) => item.id === Number(letterId));
  if (!letter) return <Navigate to="/letters" replace />;
  return (
    <AnimatedPage>
      <header className="page-heading scrapbook-section compact-heading" data-page-intro><small><Link to="/letters">情书</Link> / PRIVATE LETTER</small><h1>{letter.title}</h1><p>TO: {content.settings.womanName} · FROM: {content.settings.manName}</p></header>
      <section className="letter-reading scrapbook-section" data-reveal><article className="letter-paper"><span className="tape tape-red" /><ReactMarkdown>{letter.body}</ReactMarkdown><footer>{content.settings.manName}</footer></article></section>
    </AnimatedPage>
  );
}

function WishesPage({ content }: { content: Content }) {
  return (
    <AnimatedPage>
      <PageHeading eyebrow="TO BE CONTINUED" title="还想和你一起完成" description="愿望不是任务清单，是未来可以一起期待的页面。" />
      <section className="wish-section scrapbook-section"><div className="wish-grid" data-stagger>{content.wishes.map((wish, index) => <article className={wish.status === "completed" ? "wish-card completed" : "wish-card"} key={wish.id}>{wish.imageUrl && <ResilientImage className="wish-image" src={wish.imageUrl} alt={wish.title} />}<span>{String(index + 1).padStart(2, "0")}</span><Heart size={20} /><h3>{wish.title}</h3><p>{wish.description}</p><small>{wish.status === "completed" ? `完成于 ${wish.completedDate || "某个好日子"}` : wish.targetDate ? `期待在 ${wish.targetDate}` : "等待一起出发"}</small></article>)}{!content.wishes.length && <div className="empty-public">愿望清单还是空白，未来的约定会出现在这里。</div>}</div></section>
    </AnimatedPage>
  );
}

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  const [failed, setFailed] = useState(false);
  const root = useDialogAccessibility<HTMLDivElement>(true, onClose);
  return (
    <div ref={root} className="lightbox" role="dialog" aria-modal="true" aria-label="照片大图预览" tabIndex={-1} onClick={onClose}>
      <button type="button" data-dialog-initial-focus aria-label="关闭照片大图" onClick={onClose}><X /></button>
      <div className="lightbox-content" onClick={(event) => event.stopPropagation()}>
        {failed
          ? <div className="media-load-error lightbox-error" role="img" aria-label="相册大图加载失败"><Images size={28} /><span>大图暂时无法加载</span></div>
          : <img src={src.replace("variant=thumb", "variant=web")} alt="相册大图" decoding="async" onError={() => setFailed(true)} />}
      </div>
    </div>
  );
}

function Journal({ content }: { content: Content }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  useEffect(() => {
    const previousTitle = document.title;
    document.title = content.settings.siteTitle;
    return () => { document.title = previousTitle; };
  }, [content.settings.siteTitle]);
  useLayoutEffect(() => {
    document.documentElement.classList.add("journal-viewport-locked");
    return () => document.documentElement.classList.remove("journal-viewport-locked");
  }, []);
  return (
    <div className="site-shell">
      <SiteNavigation />
      <div className="site-scroll-viewport">
        <Routes>
          <Route path="/" element={<HomePage content={content} />} />
          <Route path="/stories" element={<StoriesPage content={content} openLightbox={setLightbox} />} />
          <Route path="/gallery" element={<GalleryPage content={content} />} />
          <Route path="/gallery/:albumId" element={<AlbumPage content={content} openLightbox={setLightbox} />} />
          <Route path="/letters" element={<LettersPage content={content} />} />
          <Route path="/letters/:letterId" element={<LetterPage content={content} />} />
          <Route path="/wishes" element={<WishesPage content={content} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </div>
      <MusicPlayer tracks={content.settings.musicPlaylist} defaultMode={content.settings.musicMode} autoplay={Boolean(content.settings.musicAutoplay)} startTrackId={content.settings.musicMediaId} />
      <SpecialDaySurprise content={content} />
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    setAuth("checking");
    setError("");
    try {
      const status = await api<{ site: boolean }>("/api/auth/status");
      if (!status.site) {
        setContent(null);
        setAuth("locked");
        return;
      }
      const nextContent = await api<Content>("/api/content");
      setContent(nextContent);
      setAuth("open");
    } catch (caught) {
      setContent(null);
      setError(caught instanceof Error ? caught.message : "加载失败");
      setAuth("error");
    }
  };
  useEffect(() => { void load(); }, []);

  if (auth === "checking") return <div className="loading-page"><Heart /><span>正在翻开纪念册</span></div>;
  if (auth === "error") return <div className="loading-page" role="alert"><p>{error || "暂时无法读取故事"}</p><button type="button" className="paper-button" onClick={() => void load()}><RefreshCw size={17} /> 重试</button></div>;
  if (auth === "locked") return <LoginCover onOpen={load} />;
  if (!content) return <div className="loading-page"><p>暂时无法读取故事</p><button type="button" className="paper-button" onClick={() => void load()}><RefreshCw size={17} /> 重试</button></div>;
  return <Journal content={content} />;
}
