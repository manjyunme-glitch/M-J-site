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
  musicUrl?: string | null;
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
  published: number;
  sortOrder: number;
};

export type Media = {
  id: number;
  albumId: number | null;
  kind: "image" | "audio";
  originalName: string;
  caption: string;
  takenDate: string | null;
  sortOrder: number;
  url?: string;
  thumbUrl?: string | null;
};

export type Album = {
  id: number;
  title: string;
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
  media?: Media[];
};
