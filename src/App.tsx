import { useEffect, useMemo, useRef, useState } from "react";
import { CalendarDays, ChevronDown, Headphones, Heart, LockKeyhole, Pause, Play, Sparkles, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, jsonBody } from "./api";
import type { Anniversary, Content } from "./types";

type AuthState = "checking" | "locked" | "open";

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
    if (!item.enabled) return [];
    const suffix = item.eventDate.slice(4);
    let date = item.annual ? `${year}${suffix}` : item.eventDate;
    if (item.annual && date < today) date = `${year + 1}${suffix}`;
    if (date < today) return [];
    return [{ ...item, nextDate: date, remaining: daysBetween(today, date) }];
  }).sort((a, b) => a.nextDate.localeCompare(b.nextDate))[0];
}

function LoginCover({ onOpen }: { onOpen: () => void }) {
  const [password, setPassword] = useState("");
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
        <span className="tiny-label">PRIVATE JOURNAL · 2025—FOREVER</span>
        <div className="lock-monogram"><span>M</span><i /><span>J</span></div>
        <h1 id="lock-title">有些故事，只想说给你听</h1>
        <p>输入那组和生日有关的数字，翻开我们的纪念册。</p>
        <form onSubmit={submit} className="lock-form">
          <label htmlFor="site-password"><LockKeyhole size={17} /> 专属密码</label>
          <div className="password-row">
            <input id="site-password" value={password} onChange={(event) => setPassword(event.target.value)} inputMode="numeric" autoComplete="current-password" maxLength={20} placeholder="••••••" autoFocus />
            <button disabled={loading || !password}>{loading ? "正在翻页" : "打开"}</button>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
        </form>
        <div className="lock-clues"><span>11 · 22</span><span>red thread</span><span>11 · 26</span></div>
      </section>
    </main>
  );
}

function NumberSecret({ number, title, children, variant }: { number: string; title: string; children: React.ReactNode; variant: string }) {
  const [open, setOpen] = useState(false);
  return (
    <button className={`number-secret ${variant} ${open ? "is-open" : ""}`} onClick={() => setOpen((value) => !value)} aria-expanded={open}>
      <span className="number-face"><b>{number}</b><small>{open ? "收起这页" : "轻触翻开"}</small></span>
      <span className="number-back"><strong>{title}</strong><span>{children}</span></span>
    </button>
  );
}

function Polaroid({ src, alt, index }: { src?: string | null; alt: string; index: number }) {
  return (
    <figure className={`polaroid rotate-${index % 3}`}>
      {src ? <img src={src} alt={alt} /> : <div className={`drawn-placeholder scene-${index % 6}`} aria-label={`${alt}的插画占位`}><span /></div>}
      <figcaption>{alt}</figcaption>
    </figure>
  );
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

function Journal({ content }: { content: Content }) {
  const { settings } = content;
  const today = shanghaiDate();
  const knownDays = daysBetween(settings.metDate, today);
  const loveDays = daysBetween(settings.togetherDate, today);
  const duration = calendarDuration(settings.togetherDate, today);
  const next = useMemo(() => nextAnniversary(content.anniversaries), [content.anniversaries]);
  const [lightbox, setLightbox] = useState<string | null>(null);

  return (
    <div className="site-shell">
      <header className="site-header">
        <a href="#top" className="wordmark">M <i /> J</a>
        <nav aria-label="主要导航">
          <a href="#story">故事</a><a href="#album">相册</a><a href="#letter">情书</a><a href="#wishes">愿望</a>
        </nav>
        <a className="admin-link" href="/admin">管理</a>
      </header>

      <main id="top">
        <section className="hero scrapbook-section">
          <div className="hero-copy">
            <span className="eyebrow">OUR LITTLE ARCHIVE · NO. 0520</span>
            <h1>{settings.manName}<span>与</span>{settings.womanName}</h1>
            <p className="hero-subtitle">{settings.subtitle}</p>
            <div className="hero-stats">
              <div><b>{knownDays}</b><span>相识的日子</span></div>
              <div><b>{loveDays}</b><span>成为恋人的日子</span></div>
              <div><b>{duration.years}<em>年</em>{duration.months}<em>月</em>{duration.days}<em>天</em></b><span>认真相爱至今</span></div>
            </div>
            <a className="paper-button" href="#story">从第一页开始 <ChevronDown size={18} /></a>
          </div>
          <div className="hero-collage">
            <Polaroid src={content.timeline[7]?.imageUrl} alt="红与蓝，牵住同一颗心" index={1} />
            <div className="date-stamp">SINCE<br /><b>2026.03.14</b></div>
            <span className="doodle-heart"><Heart /></span>
          </div>
          <div className="thread thread-blue" /><div className="thread thread-red" />
        </section>

        <section className="next-date scrapbook-section">
          <div className="section-kicker"><CalendarDays size={18} /> NEXT PAGE</div>
          {next ? <><p>距离「{next.title}」还有</p><strong>{next.remaining}<span>天</span></strong><small>{next.nextDate.replaceAll("-", ".")} · {next.description}</small></> : <p>今天也值得被纪念。</p>}
        </section>

        <section className="people scrapbook-section">
          <div className="person-card blue-note"><span className="tape tape-blue" /><small>ABOUT HIM</small><h2>{settings.manName}</h2><p>{settings.manBirthday.replaceAll("-", ".")}</p><i>“会慢慢学会，把在意说得更清楚。”</i></div>
          <div className="between-note"><span>两个普通的人</span><Heart /><b>写一本不普通的故事</b></div>
          <div className="person-card red-note"><span className="tape tape-red" /><small>ABOUT HER</small><h2>{settings.womanName}</h2><p>{settings.womanBirthday.replaceAll("-", ".")}</p><i>“认真感受，也认真期待被坚定选择。”</i></div>
        </section>

        <section className="numbers scrapbook-section" aria-labelledby="number-title">
          <div className="section-heading"><small>THREE SECRET NUMBERS</small><h2 id="number-title">故事留下的暗号</h2><p>有些数字，只有我们知道它为什么特别。</p></div>
          <div className="number-grid">
            <NumberSecret number="520" title="故事开始的日子" variant="secret-blue">加上微信的那一天。是巧合，还是故事提前写好的第一行？</NumberSecret>
            <NumberSecret number="167" title="奶茶小票" variant="secret-ticket">取餐号码落在手里，刚好聊到那些还没开窍的感情。粤语里，它好像还藏着另一句话。</NumberSecret>
            <NumberSecret number="3·14" title="终于说出口" variant="secret-red">鼓起勇气表白以后才知道，原来这一天也是白色情人节。</NumberSecret>
          </div>
        </section>

        <section id="story" className="story scrapbook-section">
          <div className="section-heading"><small>CHAPTERS 01—{String(content.timeline.length).padStart(2, "0")}</small><h2>我们的故事，慢慢写</h2><p>{settings.heroNote}</p></div>
          <div className="timeline">
            {content.timeline.map((event, index) => (
              <article key={event.id} className={`timeline-entry ${index % 2 ? "right" : "left"}`}>
                <div className="timeline-number">{String(index + 1).padStart(2, "0")}</div>
                <Polaroid src={event.imageUrl} alt={event.title} index={index} />
                <div className="timeline-copy"><time>{event.dateLabel}</time><h3>{event.title}</h3><p>{event.body}</p></div>
              </article>
            ))}
          </div>
        </section>

        <section id="album" className="album-section scrapbook-section">
          <div className="section-heading"><small>PHOTO POCKETS</small><h2>把平常的日子留下来</h2><p>真实照片会慢慢替换这些画面，位置先为未来留好。</p></div>
          {content.albums.map((album, albumIndex) => (
            <article className="album" key={album.id}>
              <div className="album-title"><span>0{albumIndex + 1}</span><div><h3>{album.title}</h3><p>{album.description}</p></div></div>
              <div className="photo-grid">
                {(album.media.length ? album.media : content.timeline.slice(albumIndex * 3, albumIndex * 3 + 3)).map((item, index) => {
                  const src = "kind" in item ? item.thumbUrl : item.imageUrl;
                  const alt = "kind" in item ? item.caption || item.originalName : item.title;
                  return <button className={`photo-button photo-${index + 1}`} key={item.id} onClick={() => src && setLightbox(src)}><Polaroid src={src} alt={alt} index={index + albumIndex} /></button>;
                })}
              </div>
            </article>
          ))}
        </section>

        <section id="letter" className="letter-section scrapbook-section">
          <div className="letter-envelope"><span>TO: {settings.womanName}</span><i /><span>FROM: {settings.manName}</span></div>
          {content.letters.map((letter) => <article className="letter-paper" key={letter.id}><span className="tape tape-red" /><small>PRIVATE LETTER · {letter.title}</small><ReactMarkdown>{letter.body}</ReactMarkdown><footer>ManJyun</footer></article>)}
        </section>

        <section id="wishes" className="wish-section scrapbook-section">
          <div className="section-heading"><small>TO BE CONTINUED</small><h2>还想和你一起完成</h2><p>愿望不是任务清单，是未来可以一起期待的页面。</p></div>
          <div className="wish-grid">
            {content.wishes.map((wish, index) => <article className={wish.status === "completed" ? "wish-card completed" : "wish-card"} key={wish.id}><span>{String(index + 1).padStart(2, "0")}</span><Heart size={20} /><h3>{wish.title}</h3><p>{wish.description}</p><small>{wish.status === "completed" ? `完成于 ${wish.completedDate || "某个好日子"}` : wish.targetDate ? `期待在 ${wish.targetDate}` : "等待一起出发"}</small></article>)}
          </div>
        </section>

        <section className="ending scrapbook-section"><Sparkles /><p>故事没有写完。</p><h2>下一页，还是我们。</h2><span>MANJYUN × JSHAORII · 2025—FOREVER</span></section>
      </main>

      <MusicPlayer src={settings.musicUrl} />
      {lightbox && <div className="lightbox" role="dialog" aria-modal="true" onClick={() => setLightbox(null)}><button aria-label="关闭"><X /></button><img src={lightbox.replace("variant=thumb", "variant=web")} alt="相册大图" /></div>}
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
