import { useEffect, useMemo, useState } from "react";
import { Album as AlbumIcon, CalendarDays, Check, Eye, FileText, Heart, Image, LayoutDashboard, LogOut, Music, Pencil, Plus, Save, Settings, Trash2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, jsonBody } from "./api";
import type { Content, Media, Settings as SiteSettings } from "./types";

type Tab = "overview" | "anniversaries" | "timeline" | "albums" | "letters" | "wishes" | "settings";
type AnyRecord = Record<string, unknown> & { id?: number };

const nav: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "anniversaries", label: "纪念日", icon: CalendarDays },
  { id: "timeline", label: "时间线", icon: FileText },
  { id: "albums", label: "相册", icon: AlbumIcon },
  { id: "letters", label: "情书", icon: Heart },
  { id: "wishes", label: "愿望", icon: Check },
  { id: "settings", label: "设置与音乐", icon: Settings }
];

const definitions = {
  anniversaries: {
    title: "纪念日",
    empty: { title: "", eventDate: "", annual: 1, description: "", enabled: 1, sortOrder: 0 },
    fields: [
      ["title", "名称", "text"], ["eventDate", "日期", "date"], ["description", "说明", "textarea"],
      ["annual", "每年重复", "checkbox"], ["enabled", "前台显示", "checkbox"], ["sortOrder", "排序", "number"]
    ]
  },
  timeline: {
    title: "时间线章节",
    empty: { dateLabel: "", eventDate: null, title: "", body: "", mediaId: null, published: 1, sortOrder: 0 },
    fields: [
      ["dateLabel", "展示日期", "text"], ["eventDate", "具体日期（可留空）", "date"], ["title", "章节标题", "text"],
      ["body", "故事正文", "textarea"], ["mediaId", "配图", "media"], ["published", "前台显示", "checkbox"], ["sortOrder", "排序", "number"]
    ]
  },
  albums: {
    title: "相册",
    empty: { title: "", description: "", coverMediaId: null, published: 1, sortOrder: 0 },
    fields: [["title", "相册名称", "text"], ["description", "相册说明", "textarea"], ["coverMediaId", "封面照片", "media"], ["published", "前台显示", "checkbox"], ["sortOrder", "排序", "number"]]
  },
  letters: {
    title: "情书",
    empty: { title: "", body: "", published: 1, sortOrder: 0 },
    fields: [["title", "标题", "text"], ["body", "Markdown 正文", "markdown"], ["published", "前台显示", "checkbox"], ["sortOrder", "排序", "number"]]
  },
  wishes: {
    title: "愿望",
    empty: { title: "", description: "", status: "pending", targetDate: null, completedDate: null, mediaId: null, sortOrder: 0 },
    fields: [["title", "愿望标题", "text"], ["description", "说明", "textarea"], ["status", "状态", "status"], ["targetDate", "目标日期", "date"], ["completedDate", "完成日期", "date"], ["mediaId", "配图", "media"], ["sortOrder", "排序", "number"]]
  }
} as const;

function AdminLogin({ onOpen }: { onOpen: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault(); setLoading(true); setError("");
    try { await api("/api/auth/admin", { method: "POST", body: jsonBody({ password }) }); onOpen(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "登录失败"); }
    finally { setLoading(false); }
  };
  return <main className="admin-login"><section><span className="tiny-label">PRIVATE CONTROL ROOM</span><h1>M × J<br />纪念册管理</h1><p>这里的修改会直接写进你们的故事。</p><form onSubmit={submit}><label>管理员密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label><button disabled={loading || !password}>{loading ? "验证中" : "进入后台"}</button>{error && <p className="form-error">{error}</p>}</form><a href="/">返回纪念册</a></section></main>;
}

function FormField({ field, value, onChange, media }: { field: readonly [string, string, string]; value: unknown; onChange: (key: string, value: unknown) => void; media: Media[] }) {
  const [key, label, type] = field;
  if (type === "checkbox") return <label className="check-field"><input type="checkbox" checked={Boolean(value)} onChange={(event) => onChange(key, event.target.checked ? 1 : 0)} /><span>{label}</span></label>;
  if (type === "textarea" || type === "markdown") return <label className={type === "markdown" ? "field full-field markdown-field" : "field full-field"}><span>{label}</span><textarea rows={type === "markdown" ? 12 : 5} value={String(value ?? "")} onChange={(event) => onChange(key, event.target.value)} /></label>;
  if (type === "media") return <label className="field"><span>{label}</span><select value={String(value ?? "")} onChange={(event) => onChange(key, event.target.value ? Number(event.target.value) : null)}><option value="">不使用</option>{media.filter((item) => item.kind === "image").map((item) => <option key={item.id} value={item.id}>{item.caption || item.originalName}</option>)}</select></label>;
  if (type === "status") return <label className="field"><span>{label}</span><select value={String(value)} onChange={(event) => onChange(key, event.target.value)}><option value="pending">待实现</option><option value="completed">已完成</option></select></label>;
  return <label className="field"><span>{label}</span><input type={type} value={String(value ?? "")} onChange={(event) => onChange(key, type === "number" ? Number(event.target.value) : event.target.value || (type === "date" ? null : ""))} /></label>;
}

function ResourcePanel({ resource, items, media, reload }: { resource: keyof typeof definitions; items: AnyRecord[]; media: Media[]; reload: () => Promise<void> }) {
  const definition = definitions[resource];
  const [editing, setEditing] = useState<AnyRecord | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const openNew = () => setEditing({ ...definition.empty });
  const save = async () => {
    if (!editing) return;
    setSaving(true); setError("");
    try {
      const method = editing.id ? "PUT" : "POST";
      const url = editing.id ? `/api/admin/${resource}/${editing.id}` : `/api/admin/${resource}`;
      const { id: _id, ...body } = editing;
      await api(url, { method, body: jsonBody(body) });
      setEditing(null); await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setSaving(false); }
  };
  const remove = async (id: number) => {
    if (!window.confirm("确定删除这条内容？此操作无法撤销。")) return;
    await api(`/api/admin/${resource}/${id}`, { method: "DELETE" });
    await reload();
  };
  return <section className="admin-panel"><header className="panel-header"><div><small>CONTENT MANAGER</small><h2>{definition.title}</h2></div><button className="primary-action" onClick={openNew}><Plus size={17} /> 新建</button></header><div className="record-list">{items.map((item) => <article className="record-card" key={item.id}><div><small>{String(item.dateLabel || item.eventDate || (item.status === "completed" ? "已完成" : "草稿与排序"))}</small><h3>{String(item.title)}</h3><p>{String(item.description || item.body || "").slice(0, 110)}</p></div><span className="status-pill">{item.published === 0 || item.enabled === 0 ? "隐藏" : "显示"}</span><div className="record-actions"><button onClick={() => setEditing({ ...item })} aria-label="编辑"><Pencil size={16} /></button><button className="danger" onClick={() => remove(Number(item.id))} aria-label="删除"><Trash2 size={16} /></button></div></article>)}{!items.length && <div className="empty-state">还没有内容，点击“新建”写下第一条。</div>}</div>{editing && <div className="editor-backdrop"><div className="editor-dialog"><header><div><small>{editing.id ? "EDIT" : "NEW"}</small><h2>{editing.id ? `编辑${definition.title}` : `新建${definition.title}`}</h2></div><button onClick={() => setEditing(null)}><X /></button></header><div className="editor-grid">{definition.fields.map((field) => <FormField key={field[0]} field={field} value={editing[field[0]]} onChange={(key, value) => setEditing((current) => current ? { ...current, [key]: value } : current)} media={media} />)}{resource === "letters" && <div className="markdown-preview"><small>实时预览</small><ReactMarkdown>{String(editing.body || "")}</ReactMarkdown></div>}</div>{error && <p className="form-error">{error}</p>}<footer><button onClick={() => setEditing(null)}>取消</button><button className="primary-action" onClick={save} disabled={saving}><Save size={17} /> {saving ? "保存中" : "保存"}</button></footer></div></div>}</section>;
}

function UploadBox({ albumId, reload, accept = "image/jpeg,image/png,image/webp" }: { albumId?: number; reload: () => Promise<void>; accept?: string }) {
  const [uploading, setUploading] = useState(false);
  const upload = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    if (albumId) form.append("albumId", String(albumId));
    try { await api("/api/admin/media", { method: "POST", body: form }); await reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : "上传失败"); }
    finally { setUploading(false); }
  };
  return <label className="upload-box"><Upload /><span>{uploading ? "正在处理文件" : "选择或拖入文件"}</span><small>{accept.startsWith("audio") ? "MP3 / M4A / OGG，最大 30MB" : "JPEG / PNG / WebP，单张最大 15MB"}</small><input type="file" accept={accept} multiple={!accept.startsWith("audio")} onChange={(event) => void upload(event.target.files)} disabled={uploading} /></label>;
}

function AlbumManager({ content, reload }: { content: Content; reload: () => Promise<void> }) {
  const removeMedia = async (id: number) => { if (!window.confirm("删除这张照片？")) return; await api(`/api/admin/media/${id}`, { method: "DELETE" }); await reload(); };
  return <div className="album-admin"><ResourcePanel resource="albums" items={content.albums as unknown as AnyRecord[]} media={content.media || []} reload={reload} />{content.albums.map((album) => <section className="media-album" key={album.id}><header><div><small>ALBUM #{album.id}</small><h3>{album.title}</h3></div><span>{album.media.length} 张照片</span></header><UploadBox albumId={album.id} reload={reload} /><div className="media-grid">{album.media.map((item) => <figure key={item.id}><img src={item.thumbUrl || item.url} alt={item.caption || item.originalName} /><figcaption>{item.caption || item.originalName}</figcaption><button onClick={() => void removeMedia(item.id)}><Trash2 size={15} /></button></figure>)}</div></section>)}</div>;
}

function SettingsPanel({ content, reload }: { content: Content; reload: () => Promise<void> }) {
  const [form, setForm] = useState<SiteSettings>({ ...content.settings });
  const [saving, setSaving] = useState(false);
  useEffect(() => setForm({ ...content.settings }), [content.settings]);
  const update = (key: keyof SiteSettings, value: string | number | null) => setForm((current) => ({ ...current, [key]: value }));
  const save = async () => { setSaving(true); try { const { id: _id, musicUrl: _musicUrl, ...body } = form; await api("/api/admin/settings", { method: "PUT", body: jsonBody(body) }); await reload(); } finally { setSaving(false); } };
  const audio = (content.media || []).filter((item) => item.kind === "audio");
  return <section className="admin-panel"><header className="panel-header"><div><small>SITE SETTINGS</small><h2>基本信息与音乐</h2></div><button className="primary-action" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "保存中" : "保存设置"}</button></header><div className="settings-grid"><label className="field full-field"><span>网站标题</span><input value={form.siteTitle} onChange={(event) => update("siteTitle", event.target.value)} /></label><label className="field full-field"><span>副标题</span><input value={form.subtitle} onChange={(event) => update("subtitle", event.target.value)} /></label><label className="field full-field"><span>首页寄语</span><textarea rows={4} value={form.heroNote} onChange={(event) => update("heroNote", event.target.value)} /></label><label className="field"><span>相识日期</span><input type="date" value={form.metDate} onChange={(event) => update("metDate", event.target.value)} /></label><label className="field"><span>恋爱日期</span><input type="date" value={form.togetherDate} onChange={(event) => update("togetherDate", event.target.value)} /></label><label className="field"><span>他的名字</span><input value={form.manName} onChange={(event) => update("manName", event.target.value)} /></label><label className="field"><span>他的生日</span><input type="date" value={form.manBirthday} onChange={(event) => update("manBirthday", event.target.value)} /></label><label className="field"><span>她的名字</span><input value={form.womanName} onChange={(event) => update("womanName", event.target.value)} /></label><label className="field"><span>她的生日</span><input type="date" value={form.womanBirthday} onChange={(event) => update("womanBirthday", event.target.value)} /></label><div className="music-settings"><div><Music /><h3>背景音乐</h3><p>浏览器不会强制自动播放，访客点击播放器后开始。</p></div><UploadBox reload={reload} accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg" /><label className="field full-field"><span>当前音乐</span><select value={form.musicMediaId || ""} onChange={(event) => update("musicMediaId", event.target.value ? Number(event.target.value) : null)}><option value="">不播放音乐</option>{audio.map((item) => <option key={item.id} value={item.id}>{item.originalName}</option>)}</select></label></div></div></section>;
}

function Overview({ content }: { content: Content }) {
  const stats = [{ label: "时间线章节", value: content.timeline.length, icon: FileText }, { label: "相册", value: content.albums.length, icon: Image }, { label: "照片与音乐", value: content.media?.length || 0, icon: Music }, { label: "未完成愿望", value: content.wishes.filter((wish) => wish.status === "pending").length, icon: Heart }];
  return <section className="overview"><header className="panel-header"><div><small>GOOD TO SEE YOU</small><h2>故事还在继续</h2><p>这里的每一次保存，都会成为前台纪念册的新一页。</p></div><a className="primary-action" href="/" target="_blank"><Eye size={17} /> 打开前台</a></header><div className="admin-stats">{stats.map(({ label, value, icon: Icon }) => <article key={label}><Icon /><strong>{value}</strong><span>{label}</span></article>)}</div><div className="preview-card"><header><div><small>LIVE PREVIEW</small><h3>实时预览</h3></div><span>桌面视图</span></header><iframe title="纪念册实时预览" src="/" /></div></section>;
}

export function Admin() {
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [content, setContent] = useState<Content | null>(null);
  const [tab, setTab] = useState<Tab>("overview");
  const reload = async () => setContent(await api<Content>("/api/admin/content"));
  const enter = async () => { const status = await api<{ admin: boolean }>("/api/auth/status"); setAuthorized(status.admin); if (status.admin) await reload(); };
  useEffect(() => { void enter(); }, []);
  const items = useMemo(() => content ? ({ anniversaries: content.anniversaries, timeline: content.timeline, albums: content.albums, letters: content.letters, wishes: content.wishes }) : null, [content]);
  const logout = async () => { await api("/api/auth/logout", { method: "POST" }); window.location.href = "/admin"; };
  if (authorized === null) return <div className="loading-page"><Heart /><span>正在验证后台会话</span></div>;
  if (!authorized) return <AdminLogin onOpen={() => void enter()} />;
  if (!content || !items) return <div className="loading-page">正在读取内容</div>;
  return <div className="admin-shell"><aside className="admin-sidebar"><a className="admin-brand" href="/"><span>M</span><i /><span>J</span><small>STORY STUDIO</small></a><nav>{nav.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}><Icon size={18} />{label}</button>)}</nav><button className="logout-button" onClick={() => void logout()}><LogOut size={18} />退出登录</button></aside><main className="admin-main"><div className="mobile-admin-nav"><select value={tab} onChange={(event) => setTab(event.target.value as Tab)}>{nav.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>{tab === "overview" && <Overview content={content} />}{tab === "albums" && <AlbumManager content={content} reload={reload} />}{tab === "settings" && <SettingsPanel content={content} reload={reload} />}{tab !== "overview" && tab !== "albums" && tab !== "settings" && <ResourcePanel resource={tab} items={items[tab] as unknown as AnyRecord[]} media={content.media || []} reload={reload} />}</main></div>;
}
