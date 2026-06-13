export type PlaybackMode = "sequence" | "repeat-one" | "shuffle";
export type ImageFilterPreset = "original" | "warm-pencil" | "faded-book" | "blue-diary" | "soft-film";

export type MusicTrack = {
  id: number;
  title: string;
  artist: string;
  originalName: string;
  sortOrder: number;
  url: string;
};

export type Settings = {
  id: number;
  siteTitle: string;
  subtitle: string;
  heroNote: string;
  metDate: string;
  togetherDate: string;
  manName: string;
  manBirthday: string;
  womanName: string;
  womanBirthday: string;
  musicMediaId: number | null;
  musicMode: PlaybackMode;
  musicUrl?: string | null;
  musicPlaylist: MusicTrack[];
};

export type Anniversary = {
  id: number;
  title: string;
  eventDate: string;
  annual: number;
  description: string;
  enabled: number;
  sortOrder: number;
};

export type TimelineEvent = {
  id: number;
  dateLabel: string;
  eventDate: string | null;
  title: string;
  body: string;
  mediaId: number | null;
  imageUrl?: string | null;
  imageWidth?: number | null;
  imageHeight?: number | null;
  published: number;
  sortOrder: number;
};

export type Media = {
  id: number;
  albumId: number | null;
  kind: "image" | "audio";
  originalName: string;
  displayName: string;
  caption: string;
  takenDate: string | null;
  imageWidth: number | null;
  imageHeight: number | null;
  filterPreset: ImageFilterPreset;
  playlistEnabled: number;
  sortOrder: number;
  url?: string;
  thumbUrl?: string | null;
};

export type HomepageCoreType = "hero" | "nextDate" | "profiles" | "secrets" | "contents" | "ending";
export type HomepageInteractiveType = "questionDraw" | "memoryMatch" | "anniversaryDraw";
export type HomepageBlockType = HomepageCoreType | HomepageInteractiveType;

export type HomepageSettings = {
  id: number;
  heroEyebrow: string;
  heroTitle: string;
  heroJoiner: string;
  heroSubtitle: string;
  heroMediaId: number | null;
  heroMediaUrl?: string | null;
  heroMediaWidth?: number | null;
  heroMediaHeight?: number | null;
  heroMediaCaption: string;
  heroCtaLabel: string;
  heroCtaTarget: string;
  manQuote: string;
  womanQuote: string;
  profilesIntro: string;
  profilesOutro: string;
  nextKicker: string;
  nextPrefix: string;
  nextFallback: string;
  secretsEyebrow: string;
  secretsTitle: string;
  secretsDescription: string;
  contentsEyebrow: string;
  contentsTitle: string;
  contentsDescription: string;
  endingKicker: string;
  endingHeadline: string;
  endingSignature: string;
};

export type HomepageModule = {
  id: number;
  blockType: HomepageBlockType;
  enabled: number;
  sortOrder: number;
  config: Record<string, unknown>;
};

export type HomepageSecret = {
  id: number;
  numberText: string;
  title: string;
  body: string;
  accent: "blue" | "ticket" | "red";
  revealStyle: "flip" | "envelope" | "scratch" | "ticket";
  enabled: number;
  sortOrder: number;
};

export type Album = {
  id: number;
  title: string;
  eventDate: string | null;
  description: string;
  coverMediaId: number | null;
  coverUrl?: string | null;
  published: number;
  sortOrder: number;
  media: Media[];
};

export type Letter = {
  id: number;
  title: string;
  body: string;
  published: number;
  sortOrder: number;
};

export type Wish = {
  id: number;
  title: string;
  description: string;
  status: "pending" | "completed";
  targetDate: string | null;
  completedDate: string | null;
  mediaId: number | null;
  imageUrl?: string | null;
  sortOrder: number;
};

export type Content = {
  settings: Settings;
  anniversaries: Anniversary[];
  timeline: TimelineEvent[];
  albums: Album[];
  letters: Letter[];
  wishes: Wish[];
  homepage: {
    settings: HomepageSettings;
    modules: HomepageModule[];
    secrets: HomepageSecret[];
  };
  media?: Media[];
};
