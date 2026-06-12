import { useEffect, useMemo, useRef, useState } from "react";
import { useGSAP } from "@gsap/react";
import gsap from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { BookOpen, CalendarDays, ChevronDown, Eye, EyeOff, Heart, Home, Images, ListChecks, LockKeyhole, Mail, Pause, Play, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Link, Navigate, NavLink, Route, Routes, useLocation, useParams } from "react-router-dom";
import { api, jsonBody } from "./api";
import type { Album, Anniversary, Content, HomepageModuleKey, Letter } from "./types";

gsap.registerPlugin(ScrollTrigger, useGSAP);

type AuthState = "checking" | "locked" | "open";

const navigation = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/stories", label: "故事", icon: BookOpen },
  { to: "/gallery", label: "相册", icon: Images },
  { to: "/letters", label: "情书", icon: Mail },
  { to: "/wishes", label: "愿望", icon: ListChecks }
] as const;

function shanghaiDate() {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const get = (type: string) => parts.find((part) => part.type === type)?.value || "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function daysBetween(start: string, end: string) {
  return Math.max(0, Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000));
}

function calendarDuration(start: string, end: string) {
  const [sy, sm, sd] = start.split("-").map(Number);
  const [ey, em, ed] = end.split("-").map(Number);
  let years = ey - sy;
  let months = em - sm;
  let days = ed - sd;
  if (days < 0) {
    months -= 1;
    days += new Date(Date.UTC(ey, em - 1, 0)).getUTCDate();
  }
  if (months < 0) {
    years -= 1;
    months += 12;
  }
  return { years: Math.max(0, years), months: Math.max(0, months), days: Math.max(0, days) };
}

function nextAnniversary(items: Anniversary[]) {
  const today = shanghaiDate();
  const [year] = today.split("-").map(Number);
  return items.flatMap((item) => {
    if (!item.enabled || item.title.includes("生日")) return [];
    const suffix = item.eventDate.slice(4);
    let date = item.annual ? `${year}${suffix}` : item.eventDate;
    if (item.annual && date < today) date = `${year + 1}${suffix}`;
    if (date < today) return [];
    return [{ ...item, nextDate: date, remaining: daysBetween(today, date) }];
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
}

function LoginCover({ onOpen }: { onOpen: () => void }) {
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
      onOpen();
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

  useEffect(() => { window.scrollTo({ top: 0, behavior: "auto" }); }, [location.pathname]);

  useGSAP(() => {
    const media = gsap.matchMedia();
    media.add("(prefers-reduced-motion: no-preference)", () => {
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
          scrollTrigger: { trigger: element, start: "top 88%", once: true }
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
          scrollTrigger: { trigger: container, start: "top 88%", once: true }
        });
      });
    });
    return () => media.revert();
  }, { scope: root, dependencies: [location.pathname], revertOnUpdate: true });

  return <main ref={root} className={`journal-page ${className}`}>{children}</main>;
}

function NumberSecret({ number, title, children, variant }: { number: string; title: string; children: React.ReactNode; variant: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className={`number-secret ${variant} ${open ? "is-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="number-secret-inner">
        <span className="number-face" aria-hidden={open}><b>{number}</b><small>轻触翻开</small></span>
        <span className="number-back" aria-hidden={!open}><strong>{title}</strong><span>{children}</span><small>轻触收起这页</small></span>
      </span>
    </button>
  );
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

function Polaroid({ src, alt, index, width, height, onOpen }: { src?: string | null; alt: string; index: number; width?: number | null; height?: number | null; onOpen?: () => void }) {
  const figure = (
    <figure className={`polaroid rotate-${index % 3} ${mediaAspectClass(width, height)}`}>
      <span className="polaroid-media">
        {src ? <img src={src} alt={alt} width={width || undefined} height={height || undefined} /> : <span className={`drawn-placeholder scene-${index % 6}`} aria-label={`${alt}的插画占位`}><i /></span>}
      </span>
      <figcaption>{alt}</figcaption>
    </figure>
  );
  return onOpen ? <button type="button" className="polaroid-button" onClick={onOpen} aria-label={`查看大图：${alt}`}>{figure}</button> : figure;
}

function MusicPlayer({ src }: { src?: string | null }) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  if (!src) return null;
  const toggle = async () => {
    if (!audioRef.current) return;
    if (audioRef.current.paused) {
      await audioRef.current.play();
      setPlaying(true);
    } else {
      audioRef.current.pause();
      setPlaying(false);
    }
  };
  return (
    <div className="music-player">
      <audio ref={audioRef} src={src} onEnded={() => setPlaying(false)} />
      <button onClick={toggle} aria-label={playing ? "暂停音乐" : "播放音乐"}>{playing ? <Pause /> : <Play />}</button>
      <div><small>OUR SOUNDTRACK</small><strong>属于我们的背景音乐</strong></div>
      <span className={playing ? "sound-wave is-playing" : "sound-wave"}><i /><i /><i /><i /></span>
    </div>
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

  const sections: Record<HomepageModuleKey, React.ReactNode> = {
    hero: <section className="hero scrapbook-section" key="hero">
      <div className="hero-copy" data-page-intro>
        <span className="eyebrow">{home.heroEyebrow}</span>
        {home.heroTitle ? <h1>{home.heroTitle}</h1> : <h1>{settings.manName}<span>{home.heroJoiner}</span>{settings.womanName}</h1>}
        <p className="hero-subtitle">{home.heroSubtitle}</p>
        <div className="hero-stats">
          <div><b>{knownDays}</b><span>相识的日子</span></div>
          <div><b>{loveDays}</b><span>成为恋人的日子</span></div>
          <div><b>{duration.years}<em>年</em>{duration.months}<em>月</em>{duration.days}<em>天</em></b><span>认真相爱至今</span></div>
        </div>
        <Link className="paper-button" to={home.heroCtaTarget}>{home.heroCtaLabel} <ChevronDown size={18} /></Link>
      </div>
      <div className="hero-collage" data-page-art>
        <Polaroid src={heroUrl} alt={home.heroMediaCaption} index={1} width={heroWidth} height={heroHeight} />
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
      <div className="number-grid" data-stagger>{content.homepage.secrets.map((secret) => <NumberSecret key={secret.id} number={secret.numberText} title={secret.title} variant={`secret-${secret.accent}`}>{secret.body}</NumberSecret>)}</div>
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

  return (
    <AnimatedPage className="home-page">
      {content.homepage.modules.filter((module) => module.enabled).sort((a, b) => a.sortOrder - b.sortOrder).map((module) => sections[module.moduleKey])}
    </AnimatedPage>
  );
}

function StoriesPage({ content, openLightbox }: { content: Content; openLightbox: (src: string) => void }) {
  return (
    <AnimatedPage>
      <PageHeading eyebrow={`CHAPTERS 01—${String(content.timeline.length).padStart(2, "0")}`} title="我们的故事，慢慢写" description={content.settings.heroNote} />
      <section className="story scrapbook-section">
        <div className="timeline">
          {content.timeline.map((event, index) => (
            <article key={event.id} className={`timeline-entry ${index % 2 ? "right" : "left"}`} data-reveal>
              <div className="timeline-number">{String(index + 1).padStart(2, "0")}</div>
              <Polaroid src={event.imageUrl} alt={event.title} index={index} width={event.imageWidth} height={event.imageHeight} onOpen={event.imageUrl ? () => openLightbox(event.imageUrl!) : undefined} />
              <div className="timeline-copy"><time>{event.dateLabel}</time><h3>{event.title}</h3><p>{event.body}</p></div>
            </article>
          ))}
        </div>
      </section>
    </AnimatedPage>
  );
}

function AlbumCover({ album }: { album: Album }) {
  const cover = album.coverUrl || album.media[0]?.thumbUrl;
  return <Link className="album-index-card" to={`/gallery/${album.id}`} data-reveal>{cover ? <img src={cover} alt={album.title} /> : <div className="drawn-placeholder scene-2"><span /></div>}<div><small>{album.eventDate?.replaceAll("-", ".") || `${album.media.length} PHOTOS`}</small><h2>{album.title}</h2><p>{album.description}</p><span>打开这本相册 →</span></div></Link>;
}

function GalleryPage({ content }: { content: Content }) {
  return (
    <AnimatedPage>
      <PageHeading eyebrow={`PHOTO POCKETS · ${content.albums.length} ALBUMS`} title="把平常的日子留下来" description="照片按相册与日期归档，每一本都有自己的页面。" />
      <section className="album-index scrapbook-section" data-stagger>{content.albums.map((album) => <AlbumCover key={album.id} album={album} />)}</section>
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
            const alt = item.displayName || item.caption || item.originalName;
            return <article key={item.id}><Polaroid src={src} alt={alt} index={index} width={item.imageWidth} height={item.imageHeight} onOpen={item.url ? () => openLightbox(item.url!) : undefined} />{item.takenDate && <time>{item.takenDate.replaceAll("-", ".")}</time>}</article>;
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
      <section className="letter-reading scrapbook-section" data-reveal><article className="letter-paper"><span className="tape tape-red" /><ReactMarkdown>{letter.body}</ReactMarkdown><footer>ManJyun</footer></article></section>
    </AnimatedPage>
  );
}

function WishesPage({ content }: { content: Content }) {
  return (
    <AnimatedPage>
      <PageHeading eyebrow="TO BE CONTINUED" title="还想和你一起完成" description="愿望不是任务清单，是未来可以一起期待的页面。" />
      <section className="wish-section scrapbook-section"><div className="wish-grid" data-stagger>{content.wishes.map((wish, index) => <article className={wish.status === "completed" ? "wish-card completed" : "wish-card"} key={wish.id}><span>{String(index + 1).padStart(2, "0")}</span><Heart size={20} /><h3>{wish.title}</h3><p>{wish.description}</p><small>{wish.status === "completed" ? `完成于 ${wish.completedDate || "某个好日子"}` : wish.targetDate ? `期待在 ${wish.targetDate}` : "等待一起出发"}</small></article>)}</div></section>
    </AnimatedPage>
  );
}

function Journal({ content }: { content: Content }) {
  const [lightbox, setLightbox] = useState<string | null>(null);
  return (
    <div className="site-shell">
      <SiteNavigation />
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
      <MusicPlayer src={content.settings.musicUrl} />
      {lightbox && <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}><button aria-label="关闭"><X /></button><img src={lightbox.replace("variant=thumb", "variant=web")} alt="相册大图" onClick={(event) => event.stopPropagation()} /></div>}
    </div>
  );
}

export function App() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [content, setContent] = useState<Content | null>(null);
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const status = await api<{ site: boolean }>("/api/auth/status");
      if (!status.site) return setAuth("locked");
      setContent(await api<Content>("/api/content"));
      setAuth("open");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "加载失败");
      setAuth("locked");
    }
  };
  useEffect(() => { void load(); }, []);

  if (auth === "checking") return <div className="loading-page"><Heart /><span>正在翻开纪念册</span></div>;
  if (auth === "locked") return <LoginCover onOpen={() => void load()} />;
  if (!content) return <div className="loading-page"><p>{error || "暂时无法读取故事"}</p></div>;
  return <Journal content={content} />;
}
