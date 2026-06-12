import { db, camelizeRow } from "./db.js";

const mediaUrl = (id: number | null | undefined, variant = "web") => id ? `/api/media/${id}?variant=${variant}` : null;

export function getContent(includeDrafts = false) {
  const settings = camelizeRow(db.prepare("SELECT * FROM settings WHERE id = 1").get()) as Record<string, unknown>;
  const anniversaries = camelizeRow(db.prepare(`SELECT * FROM anniversaries ${includeDrafts ? "" : "WHERE enabled = 1"} ORDER BY sort_order, event_date`).all()) as Array<Record<string, unknown>>;
  const timeline = camelizeRow(db.prepare(`SELECT * FROM timeline_events ${includeDrafts ? "" : "WHERE published = 1"} ORDER BY sort_order, COALESCE(event_date, '9999-12-31')`).all()) as Array<Record<string, unknown>>;
  const albums = camelizeRow(db.prepare(`SELECT * FROM albums ${includeDrafts ? "" : "WHERE published = 1"} ORDER BY sort_order, id`).all()) as Array<Record<string, unknown>>;
  const allMedia = camelizeRow(db.prepare("SELECT * FROM media ORDER BY sort_order, id").all()) as Array<Record<string, any>>;
  const letters = camelizeRow(db.prepare(`SELECT * FROM letters ${includeDrafts ? "" : "WHERE published = 1"} ORDER BY sort_order, id`).all()) as Array<Record<string, unknown>>;
  const wishes = camelizeRow(db.prepare("SELECT * FROM wishes ORDER BY sort_order, id").all()) as Array<Record<string, unknown>>;
  const homepageSettings = camelizeRow(db.prepare("SELECT * FROM homepage_settings WHERE id = 1").get()) as Record<string, any>;
  const homepageModules = camelizeRow(db.prepare(`SELECT * FROM homepage_modules ${includeDrafts ? "" : "WHERE enabled = 1"} ORDER BY sort_order, module_key`).all()) as Array<Record<string, unknown>>;
  const homepageSecrets = camelizeRow(db.prepare(`SELECT * FROM homepage_secret_cards ${includeDrafts ? "" : "WHERE enabled = 1"} ORDER BY sort_order, id`).all()) as Array<Record<string, unknown>>;

  const media = allMedia.map((item): Record<string, any> => ({
    ...item,
    url: mediaUrl(Number(item.id)),
    thumbUrl: item.kind === "image" ? mediaUrl(Number(item.id), "thumb") : null
  }));
  const albumList = albums.map((album) => ({
    ...album,
    coverUrl: mediaUrl(album.coverMediaId as number | null, "thumb"),
    media: media.filter((item) => item["albumId"] === album.id)
  }));
  const timelineList = timeline.map((event) => {
    const image = media.find((item) => item.id === event.mediaId);
    return { ...event, imageUrl: mediaUrl(event.mediaId as number | null), imageWidth: image?.imageWidth || null, imageHeight: image?.imageHeight || null };
  });
  const wishList = wishes.map((wish) => ({ ...wish, imageUrl: mediaUrl(wish.mediaId as number | null) }));
  const heroMedia = media.find((item) => item.id === homepageSettings.heroMediaId);

  return {
    settings: {
      ...settings,
      manBirthday: includeDrafts ? settings.manBirthday : "",
      womanBirthday: includeDrafts ? settings.womanBirthday : "",
      musicUrl: mediaUrl(settings.musicMediaId as number | null)
    },
    anniversaries,
    timeline: timelineList,
    albums: albumList,
    letters,
    wishes: wishList,
    homepage: {
      settings: {
        ...homepageSettings,
        heroMediaUrl: mediaUrl(homepageSettings.heroMediaId as number | null),
        heroMediaWidth: heroMedia?.imageWidth || null,
        heroMediaHeight: heroMedia?.imageHeight || null
      },
      modules: homepageModules,
      secrets: homepageSecrets
    },
    media: includeDrafts ? media : undefined
  };
}
