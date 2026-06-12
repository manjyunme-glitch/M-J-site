import assert from "node:assert/strict";
import test from "node:test";
import { normalizeUploadFilename } from "./filename.js";

test("normalizes UTF-8 filenames decoded as latin1 by multipart parsers", () => {
  const expected = "我们的歌-背景音乐.mp3";
  const mojibake = Buffer.from(expected, "utf8").toString("latin1");
  assert.equal(normalizeUploadFilename(mojibake), expected);
});

test("keeps ASCII and already-correct Unicode filenames unchanged", () => {
  assert.equal(normalizeUploadFilename("soundtrack.mp3"), "soundtrack.mp3");
  assert.equal(normalizeUploadFilename("我们的歌.mp3"), "我们的歌.mp3");
});
