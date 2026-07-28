/* ============================================================
   Video support
   Separate module because video needs a fundamentally different
   render path from stills: the field must be rebuilt every frame,
   so the caching the static path relies on has to be bypassed.
   ============================================================ */

export const VIDEO_RE = /^video\//;

/* Images go through FileReader (small, works in sandboxed frames).
   Video must not: base64-ing a 40 MB file into a data URL blows
   memory and kills seeking. Object URLs stream from disk instead. */
export function makeVideoElement(file) {
  const url = URL.createObjectURL(file);
  const el = document.createElement("video");
  el.src = url;
  el.muted = true;              // required for programmatic play()
  el.playsInline = true;
  el.loop = true;
  el.preload = "auto";
  el.crossOrigin = "anonymous";
  return { el, url };
}

export function releaseVideo(media) {
  if (!media) return;
  try {
    media.el.pause();
    media.el.removeAttribute("src");
    media.el.load();
  } catch (e) { /* ignore */ }
  if (media.url) URL.revokeObjectURL(media.url);
}

/* Prefer VP9 — noticeably better on flat blacks and hard-edged glyphs
   than VP8 at the same bitrate, which is exactly this content. */
const CANDIDATES = [
  "video/webm;codecs=vp9",
  "video/webm;codecs=vp8",
  "video/webm",
  "video/mp4;codecs=avc1.42E01E",
  "video/mp4",
];

export function pickMimeType() {
  if (typeof MediaRecorder === "undefined") return null;
  for (const t of CANDIDATES) {
    try { if (MediaRecorder.isTypeSupported(t)) return t; } catch (e) { /* ignore */ }
  }
  return null;
}

export function startRecording(canvas, fps, bitrateMbps, onStop, onError) {
  const mimeType = pickMimeType();
  if (!mimeType) { onError("This browser has no MediaRecorder codec available."); return null; }
  let stream;
  try {
    stream = canvas.captureStream(fps);
  } catch (e) {
    onError("captureStream is unavailable in this browser.");
    return null;
  }
  const chunks = [];
  let rec;
  try {
    rec = new MediaRecorder(stream, {
      mimeType,
      videoBitsPerSecond: Math.round(bitrateMbps * 1_000_000),
    });
  } catch (e) {
    onError("Recorder failed to start: " + e.message);
    return null;
  }
  rec.ondataavailable = e => { if (e.data && e.data.size) chunks.push(e.data); };
  rec.onerror = e => onError("Recording error: " + (e.error?.message || "unknown"));
  rec.onstop = () => {
    const blob = new Blob(chunks, { type: mimeType });
    onStop({
      url: URL.createObjectURL(blob),
      size: blob.size,
      mimeType,
      ext: mimeType.startsWith("video/mp4") ? "mp4" : "webm",
    });
  };
  rec.start(250);               // flush every 250ms so long takes stay stable
  return rec;
}

export function formatClock(t) {
  if (!isFinite(t) || t < 0) t = 0;
  const m = Math.floor(t / 60);
  const s = Math.floor(t % 60);
  return m + ":" + String(s).padStart(2, "0");
}

export function formatBytes(n) {
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
  return (n / 1024 / 1024).toFixed(1) + " MB";
}
