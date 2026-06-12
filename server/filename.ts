export function normalizeUploadFilename(value: string) {
  if (!value || [...value].some((character) => (character.codePointAt(0) || 0) > 255)) return value;
  const decoded = Buffer.from(value, "latin1").toString("utf8");
  return decoded.includes("\uFFFD") || !/[^\x00-\x7F]/.test(decoded) ? value : decoded;
}
