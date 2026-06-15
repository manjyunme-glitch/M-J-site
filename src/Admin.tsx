import { useEffect, useMemo, useRef, useState } from "react";
import { Album as AlbumIcon, AlertCircle, ArchiveRestore, ArrowDown, ArrowUp, CalendarDays, Check, CheckCircle2, Download, Eye, FileText, Gamepad2, GitCommit, Heart, Image, LayoutDashboard, LayoutTemplate, LogOut, Music, Pencil, Plus, RefreshCw, Save, Settings, Trash2, Upload, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { api, jsonBody } from "./api";
import type { Content, HomepageBlockType, HomepageInteractiveType, ImageFilterPreset, Media, PlaybackMode, Settings as SiteSettings } from "./types";

type Tab = "overview" | "homepage" | "anniversaries" | "timeline" | "albums" | "letters" | "wishes" | "backup" | "settings";
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
type PendingImage = { id: string; file: File; previewUrl: string; displayName: string; takenDate: string; caption: string; filterPreset: ImageFilterPreset };
type MusicLibraryItem = { id: number; originalName: string; title: string; artist: string; enabled: boolean; sortOrder: number };
type BackupInspection = {
  token: string;
  filename: string;
  sizeBytes: number;
  format: string;
  version: number;
  createdAt: string;
  expiresAt: string;
  summary: { timeline: number; albums: number; images: number; audio: number; letters: number; wishes: number; anniversaries: number; mediaBytes: number };
};

const filterPresets: Array<{ id: ImageFilterPreset; label: string; note: string }> = [
  { id: "original", label: "原图", note: "保留真实色彩" },
  { id: "warm-pencil", label: "暖纸彩铅", note: "琥珀纸色与铅笔轮廓" },
  { id: "faded-book", label: "旧书褪色", note: "低饱和暖调" },
  { id: "blue-diary", label: "冷蓝手账", note: "克制的旧蓝色" },
  { id: "soft-film", label: "柔和胶片", note: "轻柔低对比" }
];

function originalMediaUrl(item: Media) {
  return item.url?.replace(/variant=(web|thumb)/, "variant=original") || item.url || item.thumbUrl || "";
}

function FilterChooser({ src, value, onChange }: { src: string; value: ImageFilterPreset; onChange: (value: ImageFilterPreset) => void }) {
  return <div className="filter-chooser" role="radiogroup" aria-label="照片滤镜">{filterPresets.map((preset) => <button type="button" key={preset.id} className={value === preset.id ? "filter-option is-selected" : "filter-option"} role="radio" aria-checked={value === preset.id} onClick={() => onChange(preset.id)}><span className={`filter-preview filter-${preset.id}`}><img src={src} alt="" /></span><strong>{preset.label}</strong><small>{preset.note}</small></button>)}</div>;
}

const mediaName = (item: Media) => item.displayName || item.caption || item.originalName;
const shortSha = (sha: string) => sha ? sha.slice(0, 7) : "unknown";
const formatDateTime = (value: string) => value ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Shanghai" }).format(new Date(value)) : "未知";

const nav: Array<{ id: Tab; label: string; icon: typeof LayoutDashboard }> = [
  { id: "overview", label: "总览", icon: LayoutDashboard },
  { id: "homepage", label: "首页编排", icon: LayoutTemplate },
  { id: "anniversaries", label: "纪念日", icon: CalendarDays },
  { id: "timeline", label: "时间线", icon: FileText },
  { id: "albums", label: "相册", icon: AlbumIcon },
  { id: "letters", label: "情书", icon: Heart },
  { id: "wishes", label: "愿望", icon: Check },
  { id: "backup", label: "配置备份", icon: ArchiveRestore },
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
  },
  homeSecrets: {
    title: "首页暗号卡片",
    empty: { numberText: "", title: "", body: "", accent: "blue", revealStyle: "flip", enabled: 1, sortOrder: 0 },
    fields: [["numberText", "正面数字或符号", "text"], ["title", "翻开后的标题", "text"], ["body", "翻开后的说明", "textarea"], ["accent", "纸张样式", "accent"], ["revealStyle", "揭晓方式", "reveal"], ["enabled", "前台显示", "checkbox"], ["sortOrder", "排序", "number"]]
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
    return <div className="field full-field media-select-field"><span>{label}</span><select aria-label={label} value={String(value ?? "")} onChange={(event) => onChange(key, event.target.value ? Number(event.target.value) : null)}><option value="">不使用</option>{images.map((item) => <option key={item.id} value={item.id}>{mediaName(item)}{item.takenDate ? ` · ${item.takenDate}` : ""}</option>)}</select>{selected ? <div className="media-choice-preview"><img src={selected.thumbUrl || selected.url} alt={mediaName(selected)} /><div><strong>{mediaName(selected)}</strong><span>{selected.takenDate || "未填写拍摄日期"}</span><small>{selected.originalName}</small></div></div> : <div className="media-choice-empty">选择照片后会在这里显示预览、名称和日期。</div>}</div>;
  }
  if (type === "status") return <label className="field"><span>{label}</span><select value={String(value)} onChange={(event) => onChange(key, event.target.value)}><option value="pending">待实现</option><option value="completed">已完成</option></select></label>;
  if (type === "accent") return <label className="field"><span>{label}</span><select value={String(value)} onChange={(event) => onChange(key, event.target.value)}><option value="blue">蓝色纪念纸</option><option value="ticket">虚线票据纸</option><option value="red">红色纪念纸</option></select></label>;
  if (type === "reveal") return <label className="field"><span>{label}</span><select value={String(value)} onChange={(event) => onChange(key, event.target.value)}><option value="flip">纸页翻面</option><option value="envelope">拆开信封</option><option value="scratch">擦开遮纸</option><option value="ticket">撕开票根</option></select></label>;
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
    setPending((current) => [...current, ...Array.from(files).map((file): PendingImage => ({
      id: crypto.randomUUID(),
      file,
      previewUrl: URL.createObjectURL(file),
      displayName: file.name.replace(/\.[^.]+$/, ""),
      takenDate: "",
      caption: "",
      filterPreset: "warm-pencil"
    }))]);
  };
  const updatePending = <K extends keyof Pick<PendingImage, "displayName" | "takenDate" | "caption" | "filterPreset">>(id: string, key: K, value: PendingImage[K]) => setPending((current) => current.map((item) => item.id === id ? { ...item, [key]: value } : item));
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
      form.append("filterPresets", item.filterPreset);
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
  return <div className="upload-workflow"><label className="upload-box"><Upload /><span>{uploading ? "正在处理文件" : "选择或拖入文件"}</span><small>{isAudio ? "MP3 / M4A / OGG，可多选，单首最大 30MB" : "JPEG / PNG / WebP，单张最大 15MB；上传前可预览主题滤镜"}</small><input type="file" accept={accept} multiple onChange={(event) => { if (isAudio) void uploadAudio(event.target.files); else chooseImages(event.target.files); event.target.value = ""; }} disabled={uploading} /></label>{!isAudio && pending.length > 0 && <div className="upload-queue"><header><div><small>UPLOAD QUEUE</small><h4>上传前整理照片信息</h4></div><span>{pending.length} 张待上传</span></header>{pending.map((item) => <article className="upload-queue-item" key={item.id}><img className={`filter-${item.filterPreset}`} src={item.previewUrl} alt="待上传预览" /><div className="upload-meta-grid"><label className="field"><span>展示名称</span><input value={item.displayName} onChange={(event) => updatePending(item.id, "displayName", event.target.value)} /></label><label className="field"><span>拍摄日期</span><input type="date" value={item.takenDate} onChange={(event) => updatePending(item.id, "takenDate", event.target.value)} /></label><label className="field full-field"><span>照片说明</span><textarea rows={2} value={item.caption} onChange={(event) => updatePending(item.id, "caption", event.target.value)} /></label><div className="field full-field"><span>主题滤镜</span><FilterChooser src={item.previewUrl} value={item.filterPreset} onChange={(value) => updatePending(item.id, "filterPreset", value)} /></div><small>{item.file.name}</small></div><button className="icon-action danger" onClick={() => removePending(item.id)} aria-label="移除待上传照片" title="移除"><X size={16} /></button></article>)}<footer><span>原始照片会保留，滤镜以后仍可重新选择。</span><button className="primary-action" onClick={() => void uploadImages()} disabled={uploading}><Upload size={17} /> {uploading ? "上传中" : `上传 ${pending.length} 张照片`}</button></footer></div>}</div>;
}

function MediaEditor({ item, albums, onClose, reload }: { item: Media; albums: Content["albums"]; onClose: () => void; reload: () => Promise<void> }) {
  const [form, setForm] = useState({ albumId: item.albumId, displayName: item.displayName || "", caption: item.caption || "", takenDate: item.takenDate || "", filterPreset: item.filterPreset || "original" as ImageFilterPreset, sortOrder: item.sortOrder });
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
  const source = originalMediaUrl(item);
  return <div className="editor-backdrop"><div className="editor-dialog media-editor"><header><div><small>PHOTO METADATA</small><h2>编辑照片信息</h2></div><button onClick={onClose} aria-label="关闭"><X /></button></header><div className="media-editor-layout"><div className="media-editor-preview"><img className={`filter-${form.filterPreset}`} src={source} alt={mediaName(item)} /><small>原始文件始终保留</small><span>{item.originalName}</span></div><div className="editor-grid"><label className="field full-field"><span>展示名称</span><input value={form.displayName} onChange={(event) => setForm({ ...form, displayName: event.target.value })} /></label><label className="field"><span>拍摄日期</span><input type="date" value={form.takenDate} onChange={(event) => setForm({ ...form, takenDate: event.target.value })} /></label><label className="field"><span>所属相册</span><select value={form.albumId || ""} onChange={(event) => setForm({ ...form, albumId: event.target.value ? Number(event.target.value) : null })}><option value="">暂不归档</option>{albums.map((album) => <option value={album.id} key={album.id}>{album.title}</option>)}</select></label><label className="field full-field"><span>照片说明</span><textarea rows={5} value={form.caption} onChange={(event) => setForm({ ...form, caption: event.target.value })} /></label><div className="field full-field"><span>主题滤镜</span><FilterChooser src={source} value={form.filterPreset} onChange={(filterPreset) => setForm({ ...form, filterPreset })} /></div><label className="field"><span>排序</span><input type="number" value={form.sortOrder} onChange={(event) => setForm({ ...form, sortOrder: Number(event.target.value) })} /></label></div></div>{error && <p className="form-error">{error}</p>}<footer><button onClick={onClose}>取消</button><button className="primary-action" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "正在重绘" : "保存照片信息"}</button></footer></div></div>;
}

function AlbumManager({ content, reload }: { content: Content; reload: () => Promise<void> }) {
  const [editingMedia, setEditingMedia] = useState<Media | null>(null);
  const removeMedia = async (id: number) => { if (!window.confirm("删除这张照片？")) return; await api(`/api/admin/media/${id}`, { method: "DELETE" }); await reload(); };
  return <div className="album-admin"><ResourcePanel resource="albums" items={content.albums as unknown as AnyRecord[]} media={content.media || []} reload={reload} />{content.albums.map((album) => <section className="media-album" key={album.id}><header><div><small>ALBUM #{album.id}{album.eventDate ? ` · ${album.eventDate}` : " · 未设置日期"}</small><h3>{album.title}</h3></div><span>{album.media.length} 张照片</span></header><UploadBox albumId={album.id} reload={reload} /><div className="media-grid">{album.media.map((item) => <figure key={item.id}><img src={item.thumbUrl || item.url || undefined} alt={mediaName(item)} /><figcaption><strong>{mediaName(item)}</strong><time>{item.takenDate || "未填写拍摄日期"}</time><small>{item.originalName}</small></figcaption><div className="media-card-actions"><button onClick={() => setEditingMedia(item)} aria-label="编辑照片" title="编辑照片"><Pencil size={15} /></button><button className="danger" onClick={() => void removeMedia(item.id)} aria-label="删除照片" title="删除照片"><Trash2 size={15} /></button></div></figure>)}</div></section>)}{editingMedia && <MediaEditor item={editingMedia} albums={content.albums} onClose={() => setEditingMedia(null)} reload={reload} />}</div>;
}

function SettingsPanel({ content, reload }: { content: Content; reload: () => Promise<void> }) {
  const [form, setForm] = useState<SiteSettings>({ ...content.settings });
  const [tracks, setTracks] = useState<MusicLibraryItem[]>([]);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setForm({ ...content.settings });
    setTracks((content.media || []).filter((item) => item.kind === "audio").sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id).map((item) => ({ id: item.id, originalName: item.originalName, title: item.displayName || item.originalName.replace(/\.[^.]+$/, ""), artist: item.caption || "M × J", enabled: Boolean(item.playlistEnabled), sortOrder: item.sortOrder })));
  }, [content.settings, content.media]);
  const update = (key: keyof SiteSettings, value: string | number | null) => setForm((current) => ({ ...current, [key]: value }));
  const updateTrack = (id: number, patch: Partial<MusicLibraryItem>) => setTracks((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const moveTrack = (index: number, offset: number) => setTracks((current) => {
    const next = [...current];
    const target = index + offset;
    if (target < 0 || target >= next.length) return current;
    [next[index], next[target]] = [next[target], next[index]];
    return next;
  });
  const removeTrack = async (item: MusicLibraryItem) => {
    if (!window.confirm(`删除歌曲“${item.title}”？原始音频文件也会删除。`)) return;
    await api(`/api/admin/media/${item.id}`, { method: "DELETE" });
    await reload();
  };
  const save = async () => {
    setSaving(true);
    try {
      const normalizedTracks = tracks.map((item, index) => ({ ...item, sortOrder: (index + 1) * 10 }));
      const firstEnabled = normalizedTracks.find((item) => item.enabled)?.id || null;
      const { id: _id, musicUrl: _musicUrl, musicPlaylist: _musicPlaylist, ...body } = form;
      await api("/api/admin/settings", { method: "PUT", body: jsonBody({ ...body, musicMediaId: firstEnabled }) });
      await api("/api/admin/music", { method: "PUT", body: jsonBody({ tracks: normalizedTracks }) });
      await reload();
    } finally { setSaving(false); }
  };
  const enabledCount = tracks.filter((item) => item.enabled).length;
  return <section className="admin-panel"><header className="panel-header"><div><small>SITE SETTINGS</small><h2>基本信息与音乐</h2></div><button className="primary-action" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "保存中" : "保存设置"}</button></header><div className="settings-grid"><label className="field full-field"><span>网站标题</span><input value={form.siteTitle} onChange={(event) => update("siteTitle", event.target.value)} /></label><label className="field full-field"><span>副标题</span><input value={form.subtitle} onChange={(event) => update("subtitle", event.target.value)} /></label><label className="field full-field"><span>首页寄语</span><textarea rows={4} value={form.heroNote} onChange={(event) => update("heroNote", event.target.value)} /></label><label className="field"><span>相识日期</span><input type="date" value={form.metDate} onChange={(event) => update("metDate", event.target.value)} /></label><label className="field"><span>恋爱日期</span><input type="date" value={form.togetherDate} onChange={(event) => update("togetherDate", event.target.value)} /></label><label className="field"><span>他的名字</span><input value={form.manName} onChange={(event) => update("manName", event.target.value)} /></label><label className="field"><span>他的生日</span><input type="date" value={form.manBirthday} onChange={(event) => update("manBirthday", event.target.value)} /></label><label className="field"><span>她的名字</span><input value={form.womanName} onChange={(event) => update("womanName", event.target.value)} /></label><label className="field"><span>她的生日</span><input type="date" value={form.womanBirthday} onChange={(event) => update("womanBirthday", event.target.value)} /></label><div className="music-settings"><div className="music-settings-intro"><Music /><div><h3>主页歌单</h3><p>歌曲先收进音乐库，再选择哪些参与主页播放。访客仍需主动点击开始。</p></div></div><UploadBox reload={reload} accept="audio/mpeg,audio/mp4,audio/x-m4a,audio/ogg" /><label className="field full-field"><span>默认播放模式</span><select value={form.musicMode} onChange={(event) => update("musicMode", event.target.value as PlaybackMode)}><option value="sequence">顺序播放</option><option value="repeat-one">单曲循环</option><option value="shuffle">随机播放</option></select></label><div className="music-library full-field"><header><div><small>MUSIC LIBRARY</small><h4>歌曲收纳</h4></div><span>{tracks.length} 首已上传 · {enabledCount} 首在主页</span></header>{tracks.length ? <div className="music-library-list">{tracks.map((item, index) => <article className={item.enabled ? "music-library-item is-enabled" : "music-library-item"} key={item.id}><label className="music-enable"><input type="checkbox" checked={item.enabled} onChange={(event) => updateTrack(item.id, { enabled: event.target.checked })} /><span>主页播放</span></label><div className="music-track-fields"><label className="field"><span>歌曲名称</span><input value={item.title} onChange={(event) => updateTrack(item.id, { title: event.target.value })} /></label><label className="field"><span>歌手 / 备注</span><input value={item.artist} onChange={(event) => updateTrack(item.id, { artist: event.target.value })} /></label><small>{item.originalName}</small></div><div className="music-track-actions"><button type="button" onClick={() => moveTrack(index, -1)} disabled={index === 0} aria-label={`上移${item.title}`} title="上移"><ArrowUp size={15} /></button><button type="button" onClick={() => moveTrack(index, 1)} disabled={index === tracks.length - 1} aria-label={`下移${item.title}`} title="下移"><ArrowDown size={15} /></button><button type="button" className="danger" onClick={() => void removeTrack(item)} aria-label={`删除${item.title}`} title="删除"><Trash2 size={15} /></button></div></article>)}</div> : <div className="music-library-empty">还没有歌曲。上传后可在这里命名、排序并加入主页歌单。</div>}</div></div></div></section>;
}

const homepageModuleLabels: Record<HomepageBlockType, string> = {
  hero: "首页封面",
  nextDate: "下一个纪念日",
  profiles: "两个人的短句",
  secrets: "暗号翻页卡片",
  contents: "内容目录",
  ending: "页尾寄语",
  questionDraw: "双人问题抽卡",
  memoryMatch: "记忆配对",
  anniversaryDraw: "约会抽签"
};

const homepageCoreTypes: HomepageBlockType[] = ["hero", "nextDate", "profiles", "secrets", "contents", "ending"];
const homepageModuleLibrary: Array<{ type: HomepageInteractiveType; title: string; description: string }> = [
  { type: "questionDraw", title: "双人问题抽卡", description: "从自定义问题里随机抽一张，适合聊天和约会。" },
  { type: "memoryMatch", title: "记忆配对", description: "把关键词翻成相同的一对，轻量回顾共同记忆。" },
  { type: "anniversaryDraw", title: "约会抽签", description: "从约会小事里随机决定下一次安排。" }
];

type HomepageSettingsState = Content["homepage"]["settings"];
type HomepageModuleState = Content["homepage"]["modules"][number];

function InteractiveModuleEditor({ module, onChange }: { module: HomepageModuleState; onChange: (config: Record<string, unknown>) => void }) {
  const config = module.config;
  const update = (key: string, value: string | string[]) => onChange({ ...config, [key]: value });
  const listField = module.blockType === "questionDraw" ? { key: "questions", label: "问题列表（每行一条）" } : module.blockType === "memoryMatch" ? { key: "pairs", label: "配对关键词（每行一条）" } : { key: "options", label: "抽签选项（每行一条）" };
  return <section className="module-config-editor"><header><small>MODULE SETTINGS</small><h3>{homepageModuleLabels[module.blockType]}</h3></header><div className="settings-grid"><label className="field"><span>英文眉题</span><input value={String(config.eyebrow || "")} onChange={(event) => update("eyebrow", event.target.value)} /></label><label className="field full-field"><span>标题</span><input value={String(config.title || "")} onChange={(event) => update("title", event.target.value)} /></label><label className="field full-field"><span>说明</span><textarea rows={3} value={String(config.description || "")} onChange={(event) => update("description", event.target.value)} /></label>{module.blockType !== "memoryMatch" && <label className="field"><span>按钮文字</span><input value={String(config.buttonLabel || "")} onChange={(event) => update("buttonLabel", event.target.value)} /></label>}<label className="field full-field"><span>{listField.label}</span><textarea rows={7} value={Array.isArray(config[listField.key]) ? (config[listField.key] as string[]).join("\n") : ""} onChange={(event) => update(listField.key, event.target.value.split("\n").map((item) => item.trim()).filter(Boolean))} /></label></div></section>;
}

function HomepageCopyEditor({ settings, update, media }: { settings: HomepageSettingsState; update: (key: keyof HomepageSettingsState, value: string | number | null) => void; media: Media[] }) {
  return <div className="homepage-settings"><section><header><small>HERO</small><h3>封面与主图</h3></header><div className="settings-grid"><label className="field full-field"><span>英文眉题</span><input value={settings.heroEyebrow} onChange={(event) => update("heroEyebrow", event.target.value)} /></label><label className="field"><span>自定义主标题（留空则使用两个人名字）</span><input value={settings.heroTitle} onChange={(event) => update("heroTitle", event.target.value)} /></label><label className="field"><span>名字之间的连接字</span><input value={settings.heroJoiner} onChange={(event) => update("heroJoiner", event.target.value)} /></label><label className="field full-field"><span>封面短句</span><textarea rows={3} value={settings.heroSubtitle} onChange={(event) => update("heroSubtitle", event.target.value)} /></label><FormField field={["heroMediaId", "首页主图", "media"]} value={settings.heroMediaId} onChange={(key, value) => update(key as keyof HomepageSettingsState, value as string | number | null)} media={media} /><label className="field full-field"><span>主图题注</span><input value={settings.heroMediaCaption} onChange={(event) => update("heroMediaCaption", event.target.value)} /></label><label className="field"><span>按钮文字</span><input value={settings.heroCtaLabel} onChange={(event) => update("heroCtaLabel", event.target.value)} /></label><label className="field"><span>按钮目标路径</span><input value={settings.heroCtaTarget} onChange={(event) => update("heroCtaTarget", event.target.value)} /></label></div></section><section><header><small>PROFILE NOTES</small><h3>两个人的短句</h3></header><div className="settings-grid"><label className="field full-field"><span>他的短句</span><textarea rows={3} value={settings.manQuote} onChange={(event) => update("manQuote", event.target.value)} /></label><label className="field full-field"><span>她的短句</span><textarea rows={3} value={settings.womanQuote} onChange={(event) => update("womanQuote", event.target.value)} /></label><label className="field"><span>中间上句</span><input value={settings.profilesIntro} onChange={(event) => update("profilesIntro", event.target.value)} /></label><label className="field"><span>中间下句</span><input value={settings.profilesOutro} onChange={(event) => update("profilesOutro", event.target.value)} /></label></div></section><section><header><small>SECTION COPY</small><h3>纪念日、暗号与目录</h3></header><div className="settings-grid"><label className="field"><span>纪念日眉题</span><input value={settings.nextKicker} onChange={(event) => update("nextKicker", event.target.value)} /></label><label className="field"><span>倒数前缀</span><input value={settings.nextPrefix} onChange={(event) => update("nextPrefix", event.target.value)} /></label><label className="field full-field"><span>没有纪念日时显示</span><input value={settings.nextFallback} onChange={(event) => update("nextFallback", event.target.value)} /></label><label className="field"><span>暗号英文眉题</span><input value={settings.secretsEyebrow} onChange={(event) => update("secretsEyebrow", event.target.value)} /></label><label className="field"><span>暗号区标题</span><input value={settings.secretsTitle} onChange={(event) => update("secretsTitle", event.target.value)} /></label><label className="field full-field"><span>暗号区说明</span><input value={settings.secretsDescription} onChange={(event) => update("secretsDescription", event.target.value)} /></label><label className="field"><span>目录英文眉题</span><input value={settings.contentsEyebrow} onChange={(event) => update("contentsEyebrow", event.target.value)} /></label><label className="field"><span>目录标题</span><input value={settings.contentsTitle} onChange={(event) => update("contentsTitle", event.target.value)} /></label><label className="field full-field"><span>目录说明</span><input value={settings.contentsDescription} onChange={(event) => update("contentsDescription", event.target.value)} /></label></div></section><section><header><small>ENDING</small><h3>页尾寄语</h3></header><div className="settings-grid"><label className="field full-field"><span>上方短句</span><input value={settings.endingKicker} onChange={(event) => update("endingKicker", event.target.value)} /></label><label className="field full-field"><span>主句</span><input value={settings.endingHeadline} onChange={(event) => update("endingHeadline", event.target.value)} /></label><label className="field full-field"><span>署名</span><input value={settings.endingSignature} onChange={(event) => update("endingSignature", event.target.value)} /></label></div></section></div>;
}

function HomepagePanel({ content, reload }: { content: Content; reload: () => Promise<void> }) {
  const [settings, setSettings] = useState({ ...content.homepage.settings });
  const [modules, setModules] = useState([...content.homepage.modules].sort((a, b) => a.sortOrder - b.sortOrder));
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [libraryType, setLibraryType] = useState<HomepageInteractiveType>("questionDraw");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    setSettings({ ...content.homepage.settings });
    setModules([...content.homepage.modules].sort((a, b) => a.sortOrder - b.sortOrder));
  }, [content.homepage]);
  const update = (key: keyof typeof settings, value: string | number | null) => setSettings((current) => ({ ...current, [key]: value }));
  const move = (index: number, offset: number) => setModules((current) => {
    const target = index + offset;
    if (target < 0 || target >= current.length) return current;
    const reordered = [...current];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    return reordered.map((item, itemIndex) => ({ ...item, sortOrder: (itemIndex + 1) * 10 }));
  });
  const updateModule = (id: number, patch: Partial<HomepageModuleState>) => setModules((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item));
  const addModule = async () => {
    setError("");
    try { const created = await api<{ id: number }>("/api/admin/homepage/modules", { method: "POST", body: jsonBody({ blockType: libraryType }) }); setSelectedId(created.id); await reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "模块添加失败"); }
  };
  const deleteModule = async (module: HomepageModuleState) => {
    if (homepageCoreTypes.includes(module.blockType)) return;
    setError("");
    try { await api(`/api/admin/homepage/modules/${module.id}`, { method: "DELETE" }); if (selectedId === module.id) setSelectedId(null); await reload(); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "模块删除失败"); }
  };
  const save = async () => {
    setSaving(true); setError("");
    try {
      const { id: _id, heroMediaUrl: _url, heroMediaWidth: _width, heroMediaHeight: _height, ...cleanSettings } = settings;
      await api("/api/admin/homepage", { method: "PUT", body: jsonBody({ settings: cleanSettings, modules }) });
      await reload();
    } catch (caught) { setError(caught instanceof Error ? caught.message : "首页配置保存失败"); }
    finally { setSaving(false); }
  };
  const images = content.media || [];
  const selectedModule = modules.find((module) => module.id === selectedId);
  return <div className="homepage-admin"><section className="admin-panel"><header className="panel-header"><div><small>HOME COMPOSER</small><h2>首页编排</h2><p>从受控模块库中添加互动内容，调整顺序和文案，不需要修改源码。</p></div><button className="primary-action" onClick={() => void save()} disabled={saving}><Save size={17} /> {saving ? "保存中" : "保存首页"}</button></header><div className="module-library"><div><Gamepad2 size={20} /><strong>添加互动模块</strong><span>小游戏只保存在当前页面会话，不记录访客答案。</span></div><select aria-label="选择互动模块" value={libraryType} onChange={(event) => setLibraryType(event.target.value as HomepageInteractiveType)}>{homepageModuleLibrary.map((item) => <option value={item.type} key={item.type}>{item.title}</option>)}</select><button type="button" className="primary-action" onClick={() => void addModule()}><Plus size={16} /> 添加</button><p>{homepageModuleLibrary.find((item) => item.type === libraryType)?.description}</p></div><div className="homepage-composer-grid"><div className="homepage-module-list">{modules.map((module, index) => <article key={module.id} className={selectedId === module.id ? "is-selected" : ""}><button type="button" className="module-select" onClick={() => setSelectedId(module.id)}><small>{String(index + 1).padStart(2, "0")}</small><strong>{homepageModuleLabels[module.blockType]}</strong><span>{homepageCoreTypes.includes(module.blockType) ? "固定模块" : "互动模块"}</span></button><label className="module-toggle"><input type="checkbox" checked={Boolean(module.enabled)} onChange={(event) => updateModule(module.id, { enabled: event.target.checked ? 1 : 0 })} /><span>显示</span></label><div className="module-order-actions"><button onClick={() => move(index, -1)} disabled={index === 0} aria-label={`上移${homepageModuleLabels[module.blockType]}`} title="上移"><ArrowUp size={16} /></button><button onClick={() => move(index, 1)} disabled={index === modules.length - 1} aria-label={`下移${homepageModuleLabels[module.blockType]}`} title="下移"><ArrowDown size={16} /></button>{!homepageCoreTypes.includes(module.blockType) && <button className="danger" onClick={() => void deleteModule(module)} aria-label={`删除${homepageModuleLabels[module.blockType]}`} title="删除"><Trash2 size={16} /></button>}</div></article>)}</div><aside className="module-editor-pane">{selectedModule && !homepageCoreTypes.includes(selectedModule.blockType) ? <InteractiveModuleEditor module={selectedModule} onChange={(config) => updateModule(selectedModule.id, { config })} /> : <div className="module-editor-empty"><LayoutTemplate size={24} /><strong>{selectedModule ? homepageModuleLabels[selectedModule.blockType] : "选择一个互动模块"}</strong><p>{selectedModule ? "固定模块的文字在下方统一编辑。" : "选择问题抽卡、记忆配对或约会抽签后，可以在这里修改内容。"}</p></div>}</aside></div><HomepageCopyEditor settings={settings} update={update} media={images} />{error && <p className="form-error">{error}</p>}</section><ResourcePanel resource="homeSecrets" items={content.homepage.secrets as unknown as AnyRecord[]} media={images} reload={reload} /></div>;
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

const formatFileSize = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) { value /= 1024; index += 1; }
  return `${value >= 10 ? value.toFixed(1) : value.toFixed(2)} ${units[index]}`;
};

function BackupPanel({ reload }: { reload: () => Promise<void> }) {
  const [inspection, setInspection] = useState<BackupInspection | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [exporting, setExporting] = useState(false);
  const [inspecting, setInspecting] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const exportBackup = async () => {
    setExporting(true); setError(""); setNotice("");
    try {
      const response = await fetch("/api/admin/backup/export", { credentials: "same-origin" });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `备份生成失败 (${response.status})`);
      }
      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition") || "";
      const filename = disposition.match(/filename="([^"]+)"/)?.[1] || `m-j-site-backup-${new Date().toISOString().slice(0, 10)}.mjsite`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url; link.download = filename; document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
      setNotice(`完整备份已保存到本地：${filename}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "备份生成失败"); }
    finally { setExporting(false); }
  };

  const inspectBackup = async (file?: File) => {
    if (!file) return;
    setInspecting(true); setInspection(null); setConfirmation(""); setError(""); setNotice("");
    const form = new FormData();
    form.append("backup", file);
    try { setInspection(await api<BackupInspection>("/api/admin/backup/inspect", { method: "POST", body: form })); }
    catch (caught) { setError(caught instanceof Error ? caught.message : "备份文件无法读取"); }
    finally { setInspecting(false); setDragging(false); }
  };

  const restoreBackup = async () => {
    if (!inspection || confirmation !== "覆盖当前网站") return;
    setRestoring(true); setError(""); setNotice("");
    try {
      await api("/api/admin/backup/restore", { method: "POST", body: jsonBody({ token: inspection.token, confirmation }) });
      await reload();
      setInspection(null); setConfirmation("");
      setNotice("网站配置已恢复，当前后台内容已经切换到所选备份。");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "备份恢复失败"); }
    finally { setRestoring(false); }
  };

  const summaryItems = inspection ? [
    ["时间线", inspection.summary.timeline], ["相册", inspection.summary.albums], ["照片", inspection.summary.images],
    ["歌曲", inspection.summary.audio], ["情书", inspection.summary.letters], ["愿望", inspection.summary.wishes], ["纪念日", inspection.summary.anniversaries]
  ] : [];

  return <section className="admin-panel backup-panel"><header className="panel-header"><div><small>LOCAL CONFIGURATION</small><h2>配置备份</h2><p>把整本纪念册保存成一个本地文件，需要时再读取并切换回来。</p></div></header><div className="backup-grid"><article className="backup-card export-card"><div className="backup-card-icon"><Download size={25} /></div><small>EXPORT EVERYTHING</small><h3>保存当前网站</h3><p>包含首页编排、全部文案、时间线、相册、照片、音乐、情书、愿望和纪念日。</p><div className="backup-note"><CheckCircle2 size={16} /><span>不会写入管理员密码、站点密码、GitHub Token 或其他 .env 信息。</span></div><button className="primary-action" onClick={() => void exportBackup()} disabled={exporting}><Download size={17} /> {exporting ? "正在打包，请稍候" : "下载完整备份"}</button></article><article className="backup-card restore-card"><div className="backup-card-icon"><ArchiveRestore size={25} /></div><small>RESTORE FROM FILE</small><h3>读取本地备份</h3><p>先检查文件和内容数量，确认无误后才会覆盖当前网站。</p><label className={dragging ? "backup-dropzone is-dragging" : "backup-dropzone"} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); void inspectBackup(event.dataTransfer.files[0]); }}><Upload size={22} /><strong>{inspecting ? "正在读取备份" : "选择或拖入 .mjsite 文件"}</strong><span>文件会先上传到服务器临时检查，30 分钟内有效。</span><input type="file" accept=".mjsite,application/gzip" disabled={inspecting || restoring} onChange={(event) => { void inspectBackup(event.target.files?.[0]); event.target.value = ""; }} /></label></article></div>{inspection && <section className="backup-inspection"><header><div><small>BACKUP SUMMARY · V{inspection.version}</small><h3>{inspection.filename}</h3><p>创建于 {formatDateTime(inspection.createdAt)} · 备份文件 {formatFileSize(inspection.sizeBytes)} · 媒体 {formatFileSize(inspection.summary.mediaBytes)}</p></div><span className="backup-ready"><CheckCircle2 size={15} /> 文件可恢复</span></header><div className="backup-summary-grid">{summaryItems.map(([label, value]) => <article key={String(label)}><strong>{value}</strong><span>{label}</span></article>)}</div><div className="backup-danger"><AlertCircle size={21} /><div><strong>恢复会整体替换当前网站</strong><p>当前数据库内容和媒体引用会被此备份替换。请先下载一次当前网站备份，再输入确认文字。</p><label>输入“覆盖当前网站”<input value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" /></label></div><button className="danger-action" disabled={confirmation !== "覆盖当前网站" || restoring} onClick={() => void restoreBackup()}><ArchiveRestore size={17} /> {restoring ? "正在恢复，请勿关闭页面" : "确认恢复并切换"}</button></div></section>}{notice && <div className="backup-feedback success"><CheckCircle2 size={18} />{notice}</div>}{error && <div className="backup-feedback error"><AlertCircle size={18} />{error}</div>}<footer className="backup-footnote">建议在大改首页文案、重写时间线或批量整理相册前先下载一份备份。多个本地文件可以作为不同版本随时切换。</footer></section>;
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
  return <div className="admin-shell"><aside className="admin-sidebar"><a className="admin-brand" href="/"><span>M</span><i /><span>J</span><small>STORY STUDIO</small></a><nav>{nav.map(({ id, label, icon: Icon }) => <button className={tab === id ? "active" : ""} key={id} onClick={() => setTab(id)}><Icon size={18} />{label}</button>)}</nav><button className="logout-button" onClick={() => void logout()}><LogOut size={18} />退出登录</button></aside><main className="admin-main"><div className="mobile-admin-nav"><select value={tab} onChange={(event) => setTab(event.target.value as Tab)}>{nav.map((item) => <option value={item.id} key={item.id}>{item.label}</option>)}</select></div>{tab === "overview" && <Overview content={content} />}{tab === "homepage" && <HomepagePanel content={content} reload={reload} />}{tab === "albums" && <AlbumManager content={content} reload={reload} />}{tab === "backup" && <BackupPanel reload={reload} />}{tab === "settings" && <SettingsPanel content={content} reload={reload} />}{tab !== "overview" && tab !== "homepage" && tab !== "albums" && tab !== "backup" && tab !== "settings" && <ResourcePanel resource={tab} items={items[tab] as unknown as AnyRecord[]} media={content.media || []} reload={reload} />}</main></div>;
}
