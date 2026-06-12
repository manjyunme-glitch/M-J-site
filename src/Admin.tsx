import { useEffect, useMemo, useRef, useState } from "react";
import { Album as AlbumIcon, AlertCircle, CalendarDays, Check, CheckCircle2, Eye, FileText, GitCommit, Heart, Image, LayoutDashboard, LogOut, Music, Pencil, Plus, RefreshCw, Save, Settings, Trash2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, jsonBody } from "./api";
import type { Content, Media, Settings as SiteSettings } from "./types";

type Tab = "overview" | "anniversaries" | "timeline" | "albums" | "letters" | "wishes" | "settings";
type AnyRecord = Record<string, unknown> & { id?: number };
type DeploymentStatus = {
  repository: string;
  branch: string;
  status: "synced" | "outdated" | "unknown";
  current: { sha: string; message: string; committedAt: string; builtAt: string; source: string };
  latest: { sha: string; message: string; committedAt: string } | null;
  checkedAt: string;
  errorMessage?: string;
};
type PendingImage = { id: string; file: File; previewUrl: string; displayName: string; takenDate: string; caption: string };

const mediaName = (item: Media) => item.displayName || item.caption || item.originalName;
const shortSha = (sha: string) => sha ? sha.slice(0, 7) : "unknown";
const formatDateTime = (value: string) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "未知";

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
    empty: { title: "", eventDate: null, description: "", coverMediaId: null, published: 1, sortOrder: 0 },
    fields: [["title", "相册名称", "text"], ["eventDate", "相册日期（可留空）", "date"], ["description", "相册说明", "textarea"], ["coverMediaId", "封面照片", "media"], ["published", "前台显示", "checkbox"], ["sortOrder", "排序", "number"]]
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
  if (type === "media") {
    const images = media.filter((item) => item.kind === "image");
    const selected = images.find((item) => item.id === Number(value));
    return <div className="field full-field media-select-field"><span>{label}</span><select value={String(value ?? "")} onChange={(event) => onChange(key, event.target.value ? Number(event.target.value) : null)}><option value="">不使用</option>{images.map((item) => <option key={item.id} value={item.id}>{mediaName(item)}{item.takenDate ? ` · ${item.takenDate}` : ""}</option>)}</select>{selected ? <div className="media-choice-preview"><img src={selected.thumbUrl || selected.url} alt={mediaName(selected)} /><div><strong>{mediaName(selected)}</strong><span>{selected.takenDate || "未填写拍摄日期"}</span><small>{selected.originalName}</small></div></div> : <div className="media-choice-empty">选择照片后会在这里显示预览、名称和日期。</div>}</div>;
  }
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
  const [pending, setPending] = useState<PendingImage[]>([]);
  const pendingRef = useRef<PendingImage[]>([]);
  useEffect(() => { pendingRef.current = pending; }, [pending]);
  useEffect(() => () => pendingRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl)), []);
  const uploadAudio = async (files: FileList | null) => {
    if (!files?.length) return;
    setUploading(true);
    const form = new FormData();
    Array.from(files).forEach((file) => form.append("files", file));
    try { await api("/api/admin/media", { method: "POST", body: form }); await reload(); }
    catch (error) { window.alert(error instanceof Error ? error.message : "上传失败"); }
    finally { setUploading(false); }
  };
  const chooseImages = (files: FileList | null) => {
    if (!files?.length) return;
    setPending((current) => [...current, ...Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      displayName: file.name.replace(/\.[^.]+$/, ""),
      takenDate: "",
      caption: ""
    }))]);
  };
  const updatePending = (id: string, key: keyof Pick<PendingImage, "displayName" | "takenDate" | "caption">, value: string) => setPending((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
  const removePending = (id: string) => setPending((current) => current.filter((item) => {
    if (item.id === id) URL.revokeObjectURL(item.previewUrl);
    return item.id !== id;
  }));
  const uploadImages = async () => {
    if (!pending.length) return;
    setUploading(true);
    const form = new FormData();
    pending.forEach((item) => {
      form.append("files", item.file);
      form.append("displayNames", item.displayName);
      form.append("takenDates", item.takenDate);
      form.append("captions", item.caption);
    });
    if (albumId) form.append("albumId", String(albumId));
    try {
      await api("/api/admin/media", { method: "POST", body: form });
      pending.forEach((item) => URL.revokeObjectURL(item.previewUrl));
      setPending([]);
      await reload();
    } catch (error) { window.alert(error instanceof Error ? error.message : "上传失败"); }
    finally { setUploading(false); }
  };
  const isAudio = accept.startsWith("audio");
  return <div className="upload-workflow"><label className="upload-box"><Upload /><span>{uploading ? "正在处理文件" : "选择或拖入文件"}</span><small>{isAudio ? "MP3 / M4A / OGG，最大 30MB" : "JPEG / PNG / WebP，单张最大 15MB；选择后可逐张填写名称和日期"}</small><input type="file" accept={accept} multiple={!isAudio} onChange={(event) => { if (isAudio) void uploadAudio(event.target.files); else chooseImages(event.target.files); event.target.value = ""; }} disabled={uploading} /></label>{!isAudio && pending.length > 0 && <div className="upload-queue"><header><div><small>UPLOAD QUEUE</small><h4>上传前整理照片信息</h4></div><span>{pending.length} 张待上传</span></header>{pending.map((item) => <article className="upload-queue-item" key={item.id}><img src={item.previewUrl} alt="待上传预览" /><div className="upload-meta-grid"><label className="field"><span>展示名称</span><input value={item.displayName} onChange={(event) => updatePending(item.id, "displayName", event.target.value)} /></label><label className="field"><span>拍摄日期</span><input type="date" value={item.takenDate} onChange={(event) => updatePending(item.id, "takenDate", event.target.value)} /></label><label className="field full-field"><span>照片说明</span><textarea rows={2} value={item.caption} onChange={(event) => updatePending(item.id, "caption", event.target.value)} /></label><small>{item.file.name}</small></div><button className="icon-action danger" onClick={() => removePending(item.id)} aria-label="移除待上传照片" title="移除"><X size={16} /></button></article>)}<footer><span>信息以后仍可在照片卡片中修改。</span><button className="primary-action" onClick={() => void uploadImages()} disabled={uploading}><Upload size={17} /> {uploading ? "上传中" : `上传 ${pending.length} 张照片`}</button></footer></div>}</div>;
}

function MediaEditor({ item, albums, onClose, reload }: { item: Media; albums: Content["albums"]; onClose: () => void; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ albumId: item.albumId, displayName: item.displayName || "", caption: item.caption || "", takenDate: item.takenDate || "", sortOrder: item.sortOrder });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const save = async () => {
    setSaving(true); setError("");
    try {
      await api(`/api/admin/media/${item.id}`, { method: "PUT", body: jsonBody({ ...form, takenDate: form.takenDate || null }) });
      await reload(); onClose();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "保存失败"); }
    finally { setSaving(false); }
  };
  return <div className="editor-backdrop"><div className="editor-dialog media-editor"><header><div><small>PHOTO METADATA</small><h2>编辑照片信息</h2></div><button onClick={onClose} aria-label="关闭"><X /></button></header><div className="media-editor-layout"><div className="media-editor-preview"><img src={item.url || item.thumbUrl || undefined} alt={mediaName(item)} /><small>原始文件</small><span>{item.originalName}</span></div><div className="editor-grid"><label className="field full-field"><span>展示名称</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label className="field"><span>拍摄日期</span><input type="date" value={form.takenDate} onChange={(event) => setForm({ ...form, takenDate: event.target.value })} /></label><label className="field"><span>所属相册</span><select value={form.albumId || ""} onChange={(event) => setForm({ ...form, albumId: event.target.value ? Number(event.target.value) : null })}><option value="">暂不归档</option>{albums.map((album) => <option value={album.id} key={album.id}>{album.title}</option>)}</select></label><label className="field full-field"><span>照片说明</span><textarea rows={5} value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} /></label><label className="field"><span>排序</span><input type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label></div></div>{error && <p className="form-error">{error}</p>}<footer><button onClick={onClose}>取消</button><button className="primary-action" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "保存中" : "保存照片信息"}</button></footer></div></div>;
}

function AlbumManager({ content, reload }: { content: Content; reload: () => Promise<void> }) {
  const [editingMedia, setEditingMedia] = useState<Media | null>(null);
  const removeMedia = async (id: number) => { if (!window.confirm("删除这张照片？")) return; await api(`/api/admin/media/${id}`, { method: "DELETE" }); await reload(); };
  return <div className="album-admin"><ResourcePanel resource="albums" items={content.albums as unknown as AnyRecord[]} media={content.media || []} reload={reload} />{content.albums.map((album) => <section className="media-album" key={album.id}><header><div><small>ALBUM #{album.id}{album.eventDate ? ` · ${album.eventDate}` : " · 未设置日期"}</small><h3>{album.title}</h3></div><span>{album.media.length} 张照片</span></header><UploadBox albumId={album.id} reload={reload} /><div className="media-grid">{album.media.map((item) => <figure key={item.id}><img src={item.thumbUrl || item.url || undefined} alt={mediaName(item)} /><figcaption><strong>{mediaName(item)}</strong><time>{item.takenDate || "未填写拍摄日期"}</time><small>{item.originalName}</small></figcaption><div className="media-card-actions"><button onClick={() => setEditingMedia(item)} aria-label="编辑照片" title="编辑照片"><Pencil size={15} /></button><button className="danger" onClick={() => void removeMedia(item.id)} aria-label="删除照片" title="删除照片"><Trash2 size={15} /></button></div></figure>)}</div></section>)}{editingMedia && <MediaEditor item={editingMedia} albums={content.albums} onClose={() => setEditingMedia(null)} reload={reload} />}</div>;
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

function UpdateCheckPanel() {
  const [result, setResult] = useState<DeploymentStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true);
    try { setResult(await api<DeploymentStatus>("/api/admin/deployment-status")); }
    catch (error) { setResult((current) => current ? { ...current, status: "unknown", errorMessage: error instanceof Error ? error.message : "检查失败" } : null); }
    finally { setChecking(false); }
  };
  useEffect(() => { void check(); }, []);
  const status = result?.status || "unknown";
  const label = checking ? "检查中" : status === "synced" ? "已是最新" : status === "outdated" ? "发现更新" : "状态未知";
  const StatusIcon = status === "synced" ? CheckCircle2 : AlertCircle;
  return <section className="update-panel"><header><div><small>DEPLOYMENT STATUS</small><h3>检查 GitHub 更新</h3><p>比较当前 Docker 构建与 GitHub 主分支，只提供状态，不会自动操作 Portainer。</p></div><button className="primary-action" onClick={() => void check()} disabled={checking}><RefreshCw size={17} className={checking ? "is-spinning" : ""} /> {checking ? "检查中" : "检查更新"}</button></header><div className="update-status-line"><span className={`update-pill ${status}`}><StatusIcon size={14} /> {label}</span><span>{result?.errorMessage || (status === "synced" ? "当前部署与远端提交一致。" : status === "outdated" ? "GitHub 已有新提交，请前往 Portainer 手动重新拉取并部署。" : "当前镜像没有可比较的提交信息，重新构建后即可识别。")}</span></div><div className="commit-grid"><article><span>当前版本</span><strong title={result?.current.sha}>{shortSha(result?.current.sha || "")}</strong><p>{result?.current.message || "未记录提交信息"}</p><small>{result?.current.builtAt ? `构建于 ${formatDateTime(result.current.builtAt)}` : `来源：${result?.current.source || "unknown"}`}</small></article><article><span>GitHub 最新提交</span><strong title={result?.latest?.sha}><GitCommit size={17} /> {shortSha(result?.latest?.sha || "")}</strong><p>{result?.latest?.message || "尚未取得远端提交"}</p><small>{result?.latest?.committedAt ? formatDateTime(result.latest.committedAt) : result ? `${result.repository} · ${result.branch}` : "正在读取"}</small></article></div><footer><span>检查时间：{result?.checkedAt ? formatDateTime(result.checkedAt) : "尚未完成"}</span>{result && <a href={`https://github.com/${result.repository}/commits/${result.branch}`} target="_blank" rel="noreferrer">查看提交记录</a>}</footer></section>;
}

function Overview({ content }: { content: Content }) {
  const stats = [{ label: "时间线章节", value: content.timeline.length, icon: FileText }, { label: "相册", value: content.albums.length, icon: Image }, { label: "照片与音乐", value: content.media?.length || 0, icon: Music }, { label: "未完成愿望", value: content.wishes.filter((wish) => wish.status === "pending").length, icon: Heart }];
  return <section className="overview"><header className="panel-header"><div><small>GOOD TO SEE YOU</small><h2>故事还在继续</h2><p>这里的每一次保存，都会成为前台纪念册的新一页。</p></div><a className="primary-action" href="/" target="_blank"><Eye size={17} /> 打开前台</a></header><div className="admin-stats">{stats.map(({ label, value, icon: Icon }) => <article key={label}><Icon /><strong>{value}</strong><span>{label}</span></article>)}</div><UpdateCheckPanel /><div className="preview-card"><header><div><small>LIVE PREVIEW</small><h3>实时预览</h3></div><span>桌面视图</span></header><iframe title="纪念册实时预览" src="/" /></div></section>;
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
