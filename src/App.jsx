import { useCallback, useEffect, useRef, useState } from "react";
import { useDialKitController, DialRoot } from "dialkit";
import * as HT from "./halftone.js";
import * as PS from "./presets.js";
import * as VID from "./video.js";

/* Canvas pool. The static path created a fresh canvas per build, which
   is fine once but allocates ~30 canvases/second under video. Reusing
   by dimension keeps the GC quiet. */
const pool = new Map();
function makeCanvas(w, h) {
  const k = w + "x" + h;
  let c = pool.get(k);
  if (!c) {
    c = document.createElement("canvas");
    c.width = w; c.height = h;
    pool.set(k, c);
  }
  return c;
}
const freshCanvas = () => document.createElement("canvas");

function tokensFrom(p) {
  return {
    ...HT.DEFAULT_TOKENS,
    charMode: p.character.charMode,
    charset: HT.resolveCharset(p.character.charMode, p.character.customChars),
    variety: p.character.variety,
    weight: parseInt(p.character.weight, 10),
    charSize: p.character.charSize,
    overlap: p.character.overlap,
    sizeVariation: p.character.sizeVariation,
    sizeSteps: p.character.sizeSteps,
    ink: p.colors.ink,
    bg: p.colors.background,
    cellW: p.grid.cellWidth,
    cellAspect: p.grid.cellAspect,
    steps: p.tone.steps,
    bgCutoff: p.tone.backgroundCutoff,
    black: p.tone.blackPoint,
    white: p.tone.whitePoint,
    gamma: p.tone.gamma,
    dither: p.tone.dither,
    edgeLift: p.tone.edgeLift,
    lightDir: [p.light.dirX, p.light.dirY, p.light.dirZ],
    rim: p.light.rim,
  };
}

export default function App() {
  const canvasRef = useRef(null);
  const stageRef = useRef(null);
  const fieldRef = useRef(null);
  const sourceStampRef = useRef("");
  const keyRef = useRef(null);
  const keyStampRef = useRef("");
  const mediaRef = useRef(null);          // { kind: 'image' | 'video', el, url? }
  const paramsRef = useRef(null);
  const ctrlRef = useRef(null);
  const drawRef = useRef(() => {});
  const recRef = useRef(null);
  const hashAppliedRef = useRef(false);
  const lastFrameRef = useRef(0);
  const perfRef = useRef(0);
  const savedRef = useRef({});
  const mediaInputRef = useRef(null);
  const presetInputRef = useRef(null);
  const lastPresetRef = useRef("");

  const [stage, setStage] = useState({ w: 900, h: 640 });
  const [status, setStatus] = useState({ msg: "No file loaded — showing the procedural scene.", err: false });
  const [exportUrl, setExportUrl] = useState(null);
  const [videoOut, setVideoOut] = useState(null);
  const [nonce, setNonce] = useState(0);
  const [saved, setSaved] = useState(() => PS.loadSaved());

  const [isVideo, setIsVideo] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [duration, setDuration] = useState(0);
  const [time, setTime] = useState(0);
  const [recording, setRecording] = useState(false);
  const [perf, setPerf] = useState(0);

  const onAction = useCallback((path) => {
    const key = path.split(".").pop();
    if (key === "exportPng") doExport();
    if (key === "copyTokens") doCopy();
    if (key === "clearImage") clearMedia();
    if (key === "fitGridToMedia") fitGridToMedia();
    if (key === "chooseMedia") mediaInputRef.current && mediaInputRef.current.click();
    if (key === "savePreset") handleSave();
    if (key === "deletePreset") handleDelete();
    if (key === "shareLink") handleShare();
    if (key === "exportPresets") handleExportPresets();
    if (key === "importPresets") presetInputRef.current && presetInputRef.current.click();
    if (key === "baseline") handleReset();
  }, []);

  const presetOptions = [{ value: "", label: "\u2014" }]
    .concat(Object.keys(PS.BUILT_IN).map(n => ({ value: n, label: n })))
    .concat(Object.keys(saved).map(n => ({ value: n, label: n + " \u00b7 saved" })));

  const ctrl = useDialKitController("Binary halftone", {
    chooseMedia: { type: "action", label: "Choose image or video" },
    presets: {
      preset: { type: "select", options: presetOptions, default: "" },
      newName: { type: "text", default: "", placeholder: "Name this preset" },
      includeFraming: false,
      savePreset: { type: "action", label: "Save preset" },
      deletePreset: { type: "action", label: "Delete selected" },
      shareLink: { type: "action", label: "Copy share link" },
      exportPresets: { type: "action", label: "Export JSON" },
      importPresets: { type: "action", label: "Import JSON" },
      baseline: { type: "action", label: "Reset to baseline" }
    },
    source: {
      _collapsed: true,
      mode: { type: "select", options: ["scene", "inflate", "bitmap"], default: "scene" },
      scene: { type: "select", options: ["stack", "sphere", "torus", "blob"], default: "stack" },
      yaw: [20, -90, 90, 1],
      pitch: [7, -45, 45, 1],
      clearImage: { type: "action", label: "Clear media" },
    },
    video: {
      _collapsed: true,
      loop: true,
      playbackRate: [1, 0.25, 2, 0.05],
      targetFps: [30, 5, 60, 1],
      recordBitrate: [8, 1, 40, 0.5],
    },
    placement: {
      _collapsed: true,
      fit: { type: "select", options: ["contain", "cover", "stretch"], default: "contain" },
      zoom: [0.95, 0.2, 3, 0.01],
      panX: [0, -0.5, 0.5, 0.005],
      panY: [0, -0.5, 0.5, 0.005],
    },
    inflate: {
      _collapsed: true,
      invertCutout: false,
      showMask: false,
      threshold: [0.5, 0.02, 0.98, 0.01],
      domeRadius: [14, 2, 40, 1],
      relief: [2.2, 0.2, 6, 0.1],
      occlusion: [0.6, 0, 1.5, 0.02],
    },
    character: {
      charMode: {
        type: "select",
        options: [
          { value: "binary", label: "Binary digits (0-1)" },
          { value: "digits", label: "Digits (0-9)" },
          { value: "pnl", label: "P&L figures" },
          { value: "custom", label: "Custom..." },
        ],
        default: "binary",
      },
      customChars: { type: "text", default: "01", placeholder: "e.g. $%.,0123456789" },
      variety: [0.6, 0, 1, 0.01],
      charSize: [0.82, 0.2, 1, 0.01],
      overlap: [0, 0, 1, 0.01],
      sizeVariation: [0.35, 0, 1, 0.01],
      sizeSteps: [3, 1, 6, 1],
      weight: { type: "select", options: ["300", "400", "500", "700"], default: "400" },
    },
    grid: {
      _collapsed: true,
      autoFit: true,
      columns: [120, 24, 300, 1],
      rows: [90, 24, 300, 1],
      cellWidth: [8, 3, 24, 0.5],
      cellAspect: [1.35, 0.8, 2.2, 0.05],
      fitGridToMedia: { type: "action", label: "Fit grid to media" },
    },
    tone: {
      backgroundCutoff: [0.045, 0, 0.4, 0.005],
      steps: [8, 2, 12, 1],
      blackPoint: [0.05, 0, 0.6, 0.01],
      whitePoint: [0.95, 0.4, 1, 0.01],
      gamma: [1, 0.4, 2.4, 0.05],
      dither: [0.55, 0, 1, 0.02],
      edgeLift: [0.55, 0, 1.5, 0.02],
    },
    light: {
      _collapsed: true,
      rim: [0.55, 0, 1.2, 0.02],
      dirX: [-0.45, -1, 1, 0.01],
      dirY: [0.78, -1, 1, 0.01],
      dirZ: [0.44, -1, 1, 0.01],
    },
    colors: { _collapsed: true, ink: "#e8e8e6", background: "#0a0a0a" },
    output: {
      _collapsed: true,
      exportScale: { type: "select", options: ["1", "2", "3", "4"], default: "2" },
      exportPng: { type: "action", label: "Export PNG" },
      copyTokens: { type: "action", label: "Copy tokens JSON" },
    },
  }, {
    persist: { key: "binary-halftone.v2", storage: "localStorage", presets: true },
    onAction,
    shortcuts: {
      "character.charSize": { key: "c", interaction: "drag", mode: "fine" },
      "character.sizeVariation": { key: "v", interaction: "drag" },
      "character.variety": { key: "r", mode: "fine" },
      "grid.cellWidth": { key: "g", interaction: "drag" },
      "tone.dither": { key: "d", mode: "fine" },
      "tone.gamma": { key: "y", mode: "fine" },
    },
  });

  const p = ctrl.values;
  paramsRef.current = p;
  ctrlRef.current = ctrl;
  const tokens = tokensFrom(p);
  savedRef.current = saved;

  // Applying happens on select change, not every render.
  useEffect(() => {
    const name = p.presets.preset;
    if (name && name !== lastPresetRef.current) {
      lastPresetRef.current = name;
      applyPreset(name);
    }
  }, [p.presets.preset]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el);
    setStage({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  /* ---------------- the single draw path ----------------
     Written into a ref every render so the video loop always sees
     current parameters without having to restart when a dial moves. */
  function drawNow() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const t0 = performance.now();

    const cellH = tokens.cellW * tokens.cellAspect;
    const cols = p.grid.autoFit
      ? HT.clamp(Math.floor((stage.w - 40) / tokens.cellW), 24, 300)
      : Math.round(p.grid.columns);
    const rows = p.grid.autoFit
      ? HT.clamp(Math.floor((stage.h - 40) / cellH), 24, 300)
      : Math.round(p.grid.rows);

    const place = {
      fit: p.placement.fit, zoom: p.placement.zoom,
      panX: p.placement.panX, panY: p.placement.panY,
      cellAspect: tokens.cellAspect,
    };
    const media = mediaRef.current;
    const live = media && media.kind === "video";
    const mode = media ? p.source.mode : "scene";

    const stamp = JSON.stringify([
      cols, rows, mode, nonce,
      p.source.scene, p.source.yaw, p.source.pitch,
      place, tokens.rim, tokens.lightDir,
      p.inflate.threshold, p.inflate.invertCutout, p.inflate.showMask,
      p.inflate.domeRadius, p.inflate.relief, p.inflate.occlusion,
      tokens.bgCutoff,
    ]);

    try {
      // Video has no stable source — rebuild the field every frame.
      if (live || stamp !== sourceStampRef.current || !fieldRef.current) {
        if (mode === "scene") {
          fieldRef.current = HT.renderScene(cols, rows, {
            scene: p.source.scene,
            yaw: p.source.yaw * Math.PI / 180,
            pitch: p.source.pitch * Math.PI / 180,
            rim: tokens.rim,
            lightDir: tokens.lightDir,
          });
        } else if (mode === "inflate") {
          const kw = cols * 2, kh = rows * 2;
          const ks = JSON.stringify([kw, kh, place, nonce]);
          if (live || !keyRef.current || keyStampRef.current !== ks) {
            keyRef.current = HT.readKeyField(media.el, kw, kh, place, makeCanvas);
            keyStampRef.current = ks;
          }
          fieldRef.current = HT.inflate(keyRef.current, cols, rows, {
            threshold: p.inflate.threshold,
            invert: p.inflate.invertCutout,
            showMask: p.inflate.showMask,
            domeRadius: p.inflate.domeRadius,
            relief: p.inflate.relief,
            occlusion: p.inflate.occlusion,
            rim: tokens.rim,
            lightDir: tokens.lightDir,
          });
        } else {
          fieldRef.current = HT.fieldFromImage(media.el, cols, rows, place, tokens.bgCutoff, makeCanvas);
        }
        sourceStampRef.current = stamp;
      }
      HT.drawHalftone(canvas, fieldRef.current, tokens, { makeCanvas });
      perfRef.current = performance.now() - t0;
    } catch (err) {
      setStatus({ msg: "Render failed: " + err.message, err: true });
      console.error(err);
    }
  }
  drawRef.current = drawNow;

  // Static redraw on any parameter change.
  useEffect(() => { if (!playing) drawNow(); });

  /* ---------------- video frame loop ----------------
     requestVideoFrameCallback fires once per *decoded* frame, which is
     what we actually want. rAF would fire at display rate and redraw
     the same frame repeatedly on 24/30fps footage. */
  useEffect(() => {
    const media = mediaRef.current;
    if (!playing || !media || media.kind !== "video") return;
    const el = media.el;
    let alive = true;
    let rafId = 0;
    const useRVFC = typeof el.requestVideoFrameCallback === "function";

    const tick = () => {
      if (!alive) return;
      const now = performance.now();
      const minGap = 1000 / Math.max(1, paramsRef.current.video.targetFps);
      if (now - lastFrameRef.current >= minGap) {
        lastFrameRef.current = now;
        drawRef.current();
        setTime(el.currentTime);
        setPerf(perfRef.current);
      }
      if (useRVFC) el.requestVideoFrameCallback(tick);
      else rafId = requestAnimationFrame(tick);
    };
    if (useRVFC) el.requestVideoFrameCallback(tick);
    else rafId = requestAnimationFrame(tick);

    return () => { alive = false; if (rafId) cancelAnimationFrame(rafId); };
  }, [playing, nonce]);

  // Keep the element in sync with the dials.
  useEffect(() => {
    const media = mediaRef.current;
    if (!media || media.kind !== "video") return;
    media.el.loop = p.video.loop;
    media.el.playbackRate = p.video.playbackRate;
  }, [p.video.loop, p.video.playbackRate, nonce]);

  /* ---------------- media loading ---------------- */
  function clearMedia() {
    if (mediaRef.current?.kind === "video") VID.releaseVideo(mediaRef.current);
    mediaRef.current = null;
    keyRef.current = null;
    keyStampRef.current = "";
    setIsVideo(false);
    setPlaying(false);
    setDuration(0);
    setTime(0);
    setStatus({ msg: "Cleared — back to the procedural scene.", err: false });
    setNonce(n => n + 1);
  }

  const loadFile = useCallback((f) => {
    if (!f) return;
    const isVid = VID.VIDEO_RE.test(f.type);
    if (!isVid && !/^image\//.test(f.type)) {
      setStatus({ msg: "Not an image or video: " + (f.type || "unknown type"), err: true });
      return;
    }
    if (mediaRef.current?.kind === "video") VID.releaseVideo(mediaRef.current);

    if (isVid) {
      setStatus({ msg: "Loading " + f.name + " …", err: false });
      const { el, url } = VID.makeVideoElement(f);
      el.onerror = () => setStatus({ msg: "Could not decode that video. Try MP4/H.264 or WebM.", err: true });
      el.onloadedmetadata = () => {
        mediaRef.current = { kind: "video", el, url };
        keyRef.current = null;
        keyStampRef.current = "";
        el.loop = paramsRef.current.video.loop;
        el.playbackRate = paramsRef.current.video.playbackRate;
        setIsVideo(true);
        setDuration(el.duration || 0);
        setTime(0);
        setStatus({
          msg: el.videoWidth + "x" + el.videoHeight + " · " +
               VID.formatClock(el.duration) + " · " +
               (typeof el.requestVideoFrameCallback === "function" ? "frame-accurate" : "rAF fallback"),
          err: false,
        });
        setNonce(n => n + 1);
        el.currentTime = 0;
      };
      el.onseeked = () => { if (!playing) { drawRef.current(); setTime(el.currentTime); } };
      return;
    }

    setStatus({ msg: "Reading " + f.name + " …", err: false });
    const reader = new FileReader();
    reader.onerror = () => setStatus({ msg: "Could not read that file off disk.", err: true });
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => setStatus({ msg: "The browser could not decode that image.", err: true });
      img.onload = () => {
        mediaRef.current = { kind: "image", el: img };
        keyRef.current = null;
        keyStampRef.current = "";
        setIsVideo(false);
        setPlaying(false);
        setStatus({ msg: img.naturalWidth + "x" + img.naturalHeight + " · image loaded", err: false });
        setNonce(n => n + 1);
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(f);
  }, [playing]);

  useEffect(() => {
    const over = e => e.preventDefault();
    const drop = e => {
      e.preventDefault();
      loadFile(e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]);
    };
    window.addEventListener("dragover", over);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragover", over);
      window.removeEventListener("drop", drop);
    };
  }, [loadFile]);

  useEffect(() => () => {
    if (mediaRef.current?.kind === "video") VID.releaseVideo(mediaRef.current);
  }, []);

  /* Sets rows so the rendered output matches the media's aspect exactly,
     which removes letterboxing rather than just preventing distortion. */
  function fitGridToMedia() {
    const media = mediaRef.current;
    if (!media) { setStatus({ msg: "Load an image or video first.", err: true }); return; }
    const d = HT.srcDims(media.el);
    const cur = paramsRef.current;
    const cols = Math.round(cur.grid.columns);
    const rows = HT.clamp(HT.rowsForAspect(cols, d.w, d.h, cur.grid.cellAspect), 24, 300);
    ctrlRef.current.setValues({ grid: { autoFit: false, rows } });
    setStatus({ msg: "Grid set to " + cols + "x" + rows + " for " + d.w + "x" + d.h + " media.", err: false });
  }

  /* ---------------- transport ---------------- */
  function togglePlay() {
    const media = mediaRef.current;
    if (!media || media.kind !== "video") return;
    if (playing) { media.el.pause(); setPlaying(false); }
    else {
      media.el.play()
        .then(() => setPlaying(true))
        .catch(err => setStatus({ msg: "Playback blocked: " + err.message, err: true }));
    }
  }

  function seek(v) {
    const media = mediaRef.current;
    if (!media || media.kind !== "video") return;
    media.el.currentTime = v;
    setTime(v);
    if (!playing) requestAnimationFrame(() => drawRef.current());
  }

  function toggleRecord() {
    if (recording) {
      recRef.current?.stop();
      recRef.current = null;
      setRecording(false);
      setStatus({ msg: "Encoding…", err: false });
      return;
    }
    const canvas = canvasRef.current;
    const cur = paramsRef.current;
    const rec = VID.startRecording(
      canvas, cur.video.targetFps, cur.video.recordBitrate,
      (out) => {
        setVideoOut(out);
        setStatus({ msg: "Recorded " + VID.formatBytes(out.size) + " (" + out.ext + ")", err: false });
      },
      (msg) => { setStatus({ msg, err: true }); setRecording(false); }
    );
    if (!rec) return;
    recRef.current = rec;
    setRecording(true);
    // Recording captures the canvas as it paints, so playback must run.
    const media = mediaRef.current;
    if (media?.kind === "video" && !playing) {
      media.el.currentTime = 0;
      media.el.play().then(() => setPlaying(true)).catch(() => {});
    }
    setStatus({ msg: "Recording… press Stop when done.", err: false });
  }

  /* ---------------- presets ---------------- */
  useEffect(() => {
    if (hashAppliedRef.current) return;
    hashAppliedRef.current = true;
    const incoming = PS.decodeFromHash(window.location.hash);
    if (incoming) {
      ctrlRef.current.setValues(incoming);
      setStatus({ msg: "Settings loaded from share link.", err: false });
    }
  }, []);

  function applyPreset(name) {
    const preset = { ...PS.BUILT_IN, ...savedRef.current }[name];
    if (!preset) return;
    const payload = { ...preset };
    delete payload._v;
    ctrlRef.current.setValues(payload);
    const framed = PS.FRAME_KEYS.some(k => k in payload);
    setStatus({ msg: 'Applied "' + name + '"' + (framed ? " (incl. framing)" : " (style only)"), err: false });
  }

  function handleSave() {
    const cur = ctrlRef.current.getValues();
    const name = String(cur.presets.newName || "").trim();
    if (!name) { setStatus({ msg: "Type a name in the presets folder first.", err: true }); return; }
    if (name in PS.BUILT_IN) { setStatus({ msg: "That name is a built-in \u2014 pick another.", err: true }); return; }
    const next = PS.savePreset(name, cur, cur.presets.includeFraming);
    setSaved(next);
    savedRef.current = next;
    lastPresetRef.current = name;
    ctrlRef.current.setValues({ presets: { newName: "", preset: name } });
    setStatus({ msg: 'Saved "' + name + '".', err: false });
  }

  function handleDelete() {
    const name = ctrlRef.current.getValues().presets.preset;
    if (!name || name in PS.BUILT_IN) {
      setStatus({ msg: "Select one of your saved presets to delete.", err: true });
      return;
    }
    const next = PS.deletePreset(name);
    setSaved(next);
    savedRef.current = next;
    lastPresetRef.current = "";
    ctrlRef.current.setValues({ presets: { preset: "" } });
    setStatus({ msg: "Deleted \"" + name + "\".", err: false });
  }

  function handleExportPresets() {
    const blob = new Blob([PS.exportJSON(savedRef.current)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "halftone-presets.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    setStatus({ msg: "Exported " + Object.keys(savedRef.current).length + " preset(s).", err: false });
  }

  function handleImport(file) {
    if (!file) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const next = PS.importJSON(String(r.result));
        setSaved(next);
        savedRef.current = next;
        setStatus({ msg: "Presets imported.", err: false });
      } catch (err) {
        setStatus({ msg: "Import failed: " + err.message, err: true });
      }
    };
    r.readAsText(file);
  }

  function handleShare() {
    const hash = PS.encodeToHash(ctrlRef.current.getValues());
    const url = window.location.origin + window.location.pathname + hash;
    history.replaceState(null, "", hash);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url)
        .then(() => setStatus({ msg: "Share link copied.", err: false }))
        .catch(() => setStatus({ msg: "Link is in the address bar \u2014 copy it manually.", err: true }));
    } else {
      setStatus({ msg: "Link is in the address bar \u2014 copy it manually.", err: true });
    }
  }

  function handleReset() {
    ctrlRef.current.setValues(PS.BASE);
    lastPresetRef.current = "";
    ctrlRef.current.setValues({ presets: { preset: "" } });
    setStatus({ msg: "Reset to the shared baseline.", err: false });
  }

  function doExport() {
    try {
      if (!fieldRef.current) return;
      const cur = paramsRef.current;
      const scale = parseInt(cur.output.exportScale, 10) || 2;
      const off = freshCanvas();
      HT.drawHalftone(off, fieldRef.current, tokensFrom(cur), {
        dpr: scale, setStyleSize: false, makeCanvas,
      });
      setExportUrl({ url: off.toDataURL("image/png"), w: off.width, h: off.height });
    } catch (err) {
      setStatus({ msg: "Export failed: " + err.message, err: true });
    }
  }

  function doCopy() {
    const cur = paramsRef.current;
    const t = tokensFrom(cur);
    t.columns = Math.round(cur.grid.columns);
    t.rows = Math.round(cur.grid.rows);
    const json = JSON.stringify(t, null, 2);
    if (navigator.clipboard) {
      navigator.clipboard.writeText(json)
        .then(() => setStatus({ msg: "Tokens copied to clipboard.", err: false }))
        .catch(() => setStatus({ msg: "Clipboard blocked — dumped to console.", err: true }));
    }
    console.log(json);
  }

  return (
    <div className="app">
      <div className="stage" ref={stageRef}>
        <canvas ref={canvasRef} aria-hidden="true" />
      </div>

      <aside className="panel">
        <header className="phead">
          <h1>Binary halftone</h1>
          <p>{tokens.charset.length} glyph{tokens.charset.length === 1 ? "" : "s"}: <code>{tokens.charset.join("")}</code></p>
          <p className={"status" + (status.err ? " err" : "")}>{status.msg}</p>

          {isVideo && (
            <div className="transport">
              <div className="trow">
                <button className="tbtn" onClick={togglePlay} title="Play / pause">
                  {playing ? "\u275a\u275a" : "\u25b6"}
                </button>
                <input
                  className="scrub"
                  type="range"
                  min="0"
                  max={duration || 0}
                  step="0.01"
                  value={Math.min(time, duration || 0)}
                  onChange={e => seek(parseFloat(e.target.value))}
                />
                <span className="tc">{VID.formatClock(time)}/{VID.formatClock(duration)}</span>
              </div>
              <div className="trow2">
                <button className={"tbtn wide" + (recording ? " rec" : "")} onClick={toggleRecord}>
                  {recording ? "\u25a0 Stop recording" : "\u25cf Record WebM"}
                </button>
                <span className={"perf" + (perf > 33 ? " warn" : "")}>
                  {perf ? perf.toFixed(1) + " ms/frame" : "\u2014"}
                </span>
              </div>
            </div>
          )}

          <input
            ref={mediaInputRef}
            type="file"
            accept="image/*,video/*"
            style={{ display: "none" }}
            onChange={e => { loadFile(e.target.files && e.target.files[0]); e.target.value = ""; }}
          />
          <input
            ref={presetInputRef}
            type="file"
            accept="application/json,.json"
            style={{ display: "none" }}
            onChange={e => { handleImport(e.target.files && e.target.files[0]); e.target.value = ""; }}
          />
        </header>
        <div className="dialwrap">
          <DialRoot mode="inline" productionEnabled />
        </div>
      </aside>

      {exportUrl && (
        <div className="modal" onClick={e => { if (e.target === e.currentTarget) setExportUrl(null); }}>
          <div className="mbox">
            <p>PNG · {exportUrl.w}x{exportUrl.h} · if the download does nothing, right-click the image and choose Save image as.</p>
            <img src={exportUrl.url} alt="Exported halftone" />
            <div className="acts">
              <a href={exportUrl.url} download="halftone.png">Download PNG</a>
              <button onClick={() => setExportUrl(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {videoOut && (
        <div className="modal" onClick={e => { if (e.target === e.currentTarget) setVideoOut(null); }}>
          <div className="mbox">
            <p>{videoOut.mimeType} · {VID.formatBytes(videoOut.size)} · captured live from the canvas.</p>
            <video src={videoOut.url} controls loop autoPlay muted playsInline />
            <div className="acts">
              <a href={videoOut.url} download={"halftone." + videoOut.ext}>Download {videoOut.ext.toUpperCase()}</a>
              <button onClick={() => { URL.revokeObjectURL(videoOut.url); setVideoOut(null); }}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
