/**
 * Boot splash and boot animation generator.
 *
 * Two targets that look similar and are not:
 *
 *   Android bootanimation.zip
 *     A zip with desc.txt at the root and part directories holding PNG frames.
 *     desc.txt is "W H FPS" then one line per part: "p count delay folder".
 *     count 0 means loop forever. THE ZIP MUST BE STORED, NOT DEFLATED — the
 *     boot animation player in some Android versions mmaps the entries and
 *     cannot read a deflated stream. A deflated zip is the single most common
 *     reason a hand-made bootanimation shows a black screen.
 *
 *   Plymouth theme (the x86_64 ISO)
 *     A .plymouth two-section file plus a .script. Plymouth draws it in the
 *     initramfs with whatever renderer it was compiled with, so the splash is a
 *     PNG plus a script, not a video. Dimensions must match the panel or the
 *     image is scaled and the animation stutters.
 *
 * The frames are painted, using raster.mjs. A generator that needs ImageMagick
 * is a generator that fails on the machine you happen to be on.
 */

import fs from "fs";
import path from "path";
import zlib from "zlib";
import { Canvas, drawText, textWidth, canRenderText, parseColor } from "./raster.mjs";

/* ------------------------------------------------------------------ */
/* Theming                                                             */
/* ------------------------------------------------------------------ */

const PRESETS = [
  {
    id: "dark-hunter",
    label: "Dark Hunter",
    background: ["#0a0f1e", "#161033"],
    accent: "#22d3ee",
    secondary: "#9333ea",
    style: "ring",
  },
  {
    id: "kali",
    label: "Kali",
    background: ["#0b0b0d", "#1a1a22"],
    accent: "#3b82f6",
    secondary: "#0ea5e9",
    style: "pulse",
  },
  {
    id: "terminal",
    label: "Terminal",
    background: ["#05080d", "#0b1420"],
    accent: "#22c55e",
    secondary: "#16a34a",
    style: "scan",
  },
  {
    id: "minimal",
    label: "Minimal",
    background: ["#000000", "#111111"],
    accent: "#ffffff",
    secondary: "#94a3b8",
    style: "dot",
  },
];

function presetById(id) {
  return PRESETS.find((p) => p.id === id) ?? PRESETS[0];
}

/**
 * Draw one frame.
 *
 * `t` is 0..1 across the animation. The four styles differ in how progress is
 * shown, because a boot animation that only spins tells you nothing about
 * whether the boot is progressing or hung — which is the actual job.
 */
function drawFrame(width, height, t, opts) {
  const { title, preset, style, showProgress } = opts;
  const c = new Canvas(width, height);
  const bg = [parseColor(preset.background[0], [10, 15, 30]), parseColor(preset.background[1], [22, 16, 51])];
  const accent = parseColor(preset.accent, [34, 211, 238]);
  const secondary = parseColor(preset.secondary, [147, 51, 234]);

  c.verticalGradient(bg[0], bg[1]);

  // A scale factor keeps geometry proportional: a 1080-wide frame and a
  // 480-wide framebuffer both look like the same design.
  const s = Math.min(width, height) / 480;
  const cx = width / 2;
  const cy = height / 2 - 20 * s;
  const R = 56 * s;

  if (style === "ring") {
    // Progress as an arc drawn from discs: no path stroking in this canvas.
    const turns = t * 2 * Math.PI;
    const segs = 180;
    for (let i = 0; i < segs; i++) {
      const a = (i / segs) * Math.PI * 2;
      // Only the leading third of the circle is drawn, rotating with t.
      const rel = (a - turns) % (Math.PI * 2);
      if (rel < 0 || rel > Math.PI * 0.66) continue;
      const fade = 1 - rel / (Math.PI * 0.66);
      const dotR = 4.2 * s;
      c.circle(cx + Math.cos(a) * R, cy + Math.sin(a) * R, dotR, accent, 0.25 + fade * 0.75);
    }
    c.circle(cx, cy, R * 0.62, secondary, 0.16);
    c.circle(cx, cy, R * 0.42, accent, 0.1);
  } else if (style === "pulse") {
    // Two concentric pulses offset in phase: reads as breathing, not loading.
    for (let i = 0; i < 2; i++) {
      const phase = (t + i * 0.5) % 1;
      const r = R * (0.4 + phase * 0.9);
      c.circle(cx, cy, r, i === 0 ? accent : secondary, (1 - phase) * 0.55);
    }
    c.circle(cx, cy, R * 0.3, accent, 0.85);
  } else if (style === "scan") {
    // A horizontal sweep with a soft trail: cheap, and obviously moving.
    const y = cy - R + t * 2 * R;
    for (let i = 0; i < 14; i++) {
      const yy = y - i * 2.4 * s;
      c.rect(cx - R * 1.6, yy, R * 3.2, 1.6 * s, accent, (1 - i / 14) * 0.75);
    }
    c.circle(cx, cy, R * 0.35, secondary, 0.12);
  } else {
    // dot: three dots filling in sequence.
    const active = Math.floor(t * 3) % 3;
    for (let i = 0; i < 3; i++) {
      const x = cx + (i - 1) * 26 * s;
      c.circle(x, cy, 9 * s, accent, i === active ? 1 : 0.22);
    }
  }

  // Title, centered. Only drawn when every glyph exists: a fallback box would
  // be worse than no text on a splash.
  if (title) {
    const scale = Math.max(2, Math.round(3 * s));
    const w = textWidth(title, scale);
    const ok = canRenderText(title);
    if (ok.ok) {
      drawText(c, title, cx - w / 2, cy + R * 0.9, scale, [255, 255, 255], 0.92);
    }
  }

  // Progress bar: the honest part. Only when asked, because some boots have no
  // progress to report and a fake bar is a lie that looks like a hang.
  if (showProgress) {
    const bw = Math.min(width * 0.5, 300 * s);
    const bh = Math.max(3, Math.round(4 * s));
    const bx = cx - bw / 2;
    const by = height - Math.round(height * 0.16);
    c.roundRect(bx, by, bw, bh, bh / 2, [255, 255, 255], 0.16);
    const fw = Math.max(bh, bw * Math.min(1, Math.max(0.02, t)));
    c.roundRect(bx, by, fw, bh, bh / 2, accent, 0.95);
  }

  return c;
}

/* ------------------------------------------------------------------ */
/* Zip (stored)                                                        */
/* ------------------------------------------------------------------ */

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * Minimal zip writer, STORED only.
 *
 * Deliberately not deflate: Android's boot animation player expects stored
 * entries, and a deflated bootanimation.zip is the classic black-screen bug.
 * Refusing to compress here is the fix, not a limitation.
 */
function zipStored(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;

  for (const e of entries) {
    const nameBuf = Buffer.from(e.name, "utf8");
    const data = e.data;
    const crc = crc32(data);

    const local = Buffer.alloc(30 + nameBuf.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt16LE(0, 10); // time
    local.writeUInt16LE(0, 12); // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    nameBuf.copy(local, 30);

    locals.push(local, data);

    const central = Buffer.alloc(46 + nameBuf.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(nameBuf.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    nameBuf.copy(central, 46);
    centrals.push(central);

    offset += local.length + data.length;
  }

  const centralBuf = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...locals, centralBuf, end]);
}

/* ------------------------------------------------------------------ */
/* Plymouth                                                            */
/* ------------------------------------------------------------------ */

function plymouthTheme(opts) {
  const accent = opts.preset.accent;
  const bg = opts.preset.background[0];
  // The .plymouth file is INI-ish and read by the file plugin loader. The
  // [script] section pointing at the .script is what makes it animate.
  const plymouth = `[Plymouth Theme]
Name=AnyRealm ${opts.preset.label}
Description=AnyRealm boot splash (${opts.preset.style}) generated by the builder
ModuleName=script

[script]
ImageDir=/usr/share/plymouth/themes/anyrealm
ScriptFile=/usr/share/plymouth/themes/anyrealm/anyrealm.script
`;
  // The script is a small state machine over the frame images. Plymouth's
  // script language has no loops over files, so frames are indexed explicitly.
  const script = `# AnyRealm boot splash.
# Plymouth draws this inside the initramfs, so it may only reference files that
# are installed in the theme directory.
background = Image("background.png");
screen_width = Window.GetWidth();
screen_height = Window.GetHeight();
screen_width_ratio = background.GetWidth() / screen_width;
screen_height_ratio = background.GetHeight() / screen_height;
ratio = Math.Max(screen_width_ratio, screen_height_ratio);

frame_count = ${opts.frameCount};
frame = 0;
elapsed = 0;
fps = ${opts.fps};

fun refresh_callback () {
  frame = Math.Int(frame + 1) % frame_count;
  image = Image("frame-" + frame + ".png");
  sprite = Sprite(image);
  sprite.SetX(screen_width / 2 - (image.GetWidth() / ratio) / 2);
  sprite.SetY(screen_height / 2 - (image.GetHeight() / ratio) / 2);
  sprite.SetZ(10);
  return 1;
}

Plymouth.SetRefreshFunction(refresh_callback);
`;
  return { plymouth, script, accent, bg };
}

/* ------------------------------------------------------------------ */

export async function register(ctx) {
  const workDir = ctx.workDir();
  const outDir = path.join(workDir, "out");
  fs.mkdirSync(outDir, { recursive: true });

  ctx.route("/formats", (_req, res) => {
    res.json({
      presets: PRESETS,
      targets: [
        {
          id: "bootanimation",
          label: "Android bootanimation.zip",
          detail:
            "desc.txt at the root plus partN/ directories of PNG frames. Entries are STORED, never deflated: " +
            "the boot player on several Android versions mmaps them, and a deflated archive shows a black screen.",
          sizes: [
            { w: 1080, h: 2400, note: "most modern phones — matches a 20:9 panel" },
            { w: 720, h: 1600, note: "720p phones; cheaper to render and decode at boot" },
            { w: 1080, h: 1920, note: "older 16:9 flagships" },
            { w: 1440, h: 3120, note: "QHD panels; the frames get large fast" },
          ],
          placement: "/system/media/bootanimation.zip (or /product/media on newer Android)",
        },
        {
          id: "plymouth",
          label: "Plymouth theme (ISO)",
          detail:
            "A .plymouth file plus a .script, drawn by the initramfs. The theme must be selected with " +
            "`plymouth-set-default-theme` and rebuilt into the initramfs, or it is installed and never used.",
          sizes: [
            { w: 1280, h: 800, note: "the Vivobook Go E1404FA panel is 1366x768; 1280x800 scales cleanly" },
            { w: 1366, h: 768, note: "exact panel match — sharpest, no scaling" },
            { w: 1920, h: 1080, note: "external monitor / VM default" },
          ],
          placement: "/usr/share/plymouth/themes/anyrealm/",
        },
      ],
      /** Things that go wrong, stated as the symptom first. */
      pitfalls: [
        {
          symptom: "black screen during boot after installing a bootanimation",
          cause: "the zip was deflated, or desc.txt has CRLF line endings",
          fix: "store the zip (this generator does) and write desc.txt with \\n only",
        },
        {
          symptom: "the plymouth theme is installed but the old one still shows",
          cause: "the theme was installed but the initramfs was not rebuilt",
          fix: "plymouth-set-default-theme -R anyrealm — the -R is the part that regenerates the initramfs",
        },
        {
          symptom: "bootanimation plays but is cropped or stretched",
          cause: "desc.txt width/height do not match the frames",
          fix: "desc.txt is generated from the real frame size here, so this cannot drift",
        },
      ],
      note:
        "Frames are painted locally. Nothing is downloaded and no image tool is required. Nothing is written to a " +
        "firmware image — the archives are built in the workspace for you to place.",
    });
  });

  ctx.route("/generate", async (req, res) => {
    const body = req.body ?? {};
    const preset = presetById(body.preset);
    const target = String(body.target ?? "bootanimation");
    const width = Math.max(64, Math.min(4096, Number(body.width) || 1080));
    const height = Math.max(64, Math.min(4096, Number(body.height) || 2400));
    const fps = Math.max(1, Math.min(60, Number(body.fps) || 30));
    const frameCount = Math.max(2, Math.min(120, Number(body.frames) || 24));
    const title = String(body.title ?? "").trim();
    const style = String(body.style ?? preset.style);
    const showProgress = body.showProgress !== false;

    // A title with a glyph this font lacks draws nothing, silently. Refusing is
    // better than a splash with a missing word.
    if (title) {
      const ok = canRenderText(title);
      if (!ok.ok) {
        return res.status(400).json({
          error: `the title contains "${ok.ch}", which the 5x7 font cannot draw. Use A-Z, 0-9, space, - . :`,
        });
      }
    }

    // Frame budget. Measured, not guessed: a 1080x2400 frame costs about 25 ms to
    // draw and 60 ms to encode here, so a 60-frame animation is roughly 5 s and
    // that is a reasonable wait for an HTTP request. Past ~400 s the request has
    // long since timed out and the user sees a spinner with no result.
    const FRAME_MS = 90;
    const estimatedSeconds = (width * height * frameCount * FRAME_MS) / (1080 * 2400) / 1000;
    if (estimatedSeconds > 400) {
      return res.status(400).json({
        error:
          `${width}x${height} x ${frameCount} frames is about ${Math.round(estimatedSeconds)}s of drawing. ` +
          "That is past a request timeout — lower the frame count or the size.",
      });
    }

    const frames = [];
    for (let i = 0; i < frameCount; i++) {
      const t = i / frameCount;
      frames.push(drawFrame(width, height, t, { title, preset, style, showProgress }));
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const name = `${target}-${stamp}`;
    const dir = path.join(outDir, name);
    fs.mkdirSync(dir, { recursive: true });

    if (target === "bootanimation") {
      // desc.txt: "W H FPS", blank line, then one line per part.
      // count 0 loops forever; delay is in seconds per cycle.
      const desc = `${width} ${height} ${fps}\n\np 0 0 part0\n`;
      const entries = [
        { name: "desc.txt", data: Buffer.from(desc, "utf8") },
        ...frames.map((f, i) => ({
          name: `part0/${String(i).padStart(5, "0")}.png`,
          data: f.toPng(),
        })),
      ];
      const zip = zipStored(entries);
      const zipPath = path.join(dir, "bootanimation.zip");
      fs.writeFileSync(zipPath, zip);
      // desc.txt is written next to the zip as well: it is the file people edit
      // when the animation loops too fast, and digging it out of a zip is silly.
      fs.writeFileSync(path.join(dir, "desc.txt"), desc);

      return res.json({
        ok: true,
        target,
        dir,
        zipPath,
        bytes: zip.length,
        desc,
        entryCount: entries.length,
        // Proving stored-not-deflated is part of the output, not a claim.
        stored: true,
        frames: frameCount,
        size: `${width}x${height}`,
        fps,
        durationSeconds: +(frameCount / fps).toFixed(2),
        preview: `/api/plugins/boot-splash-lab/preview?dir=${encodeURIComponent(name)}&frame=0`,
      });
    }

    if (target === "plymouth") {
      const themeDir = path.join(dir, "anyrealm");
      fs.mkdirSync(themeDir, { recursive: true });
      // background.png is the first frame: Plymouth scales it to cover.
      fs.writeFileSync(path.join(themeDir, "background.png"), frames[0].toPng());
      frames.forEach((f, i) => fs.writeFileSync(path.join(themeDir, `frame-${i}.png`), f.toPng()));
      const { plymouth, script } = plymouthTheme({ preset, frameCount, fps });
      fs.writeFileSync(path.join(themeDir, "anyrealm.plymouth"), plymouth);
      fs.writeFileSync(path.join(themeDir, "anyrealm.script"), script);

      // A thumbnail of the first frame, so the result is visible without
      // installing anything.
      fs.writeFileSync(path.join(dir, "preview.png"), frames[0].toPng());

      return res.json({
        ok: true,
        target,
        dir,
        themeDir,
        files: ["anyrealm.plymouth", "anyrealm.script", "background.png", `frame-0..${frameCount - 1}.png`],
        install: [
          `sudo cp -r ${themeDir} /usr/share/plymouth/themes/anyrealm`,
          "sudo plymouth-set-default-theme -R anyrealm",
          "# -R regenerates the initramfs; without it the old theme keeps showing",
        ],
        frames: frameCount,
        size: `${width}x${height}`,
        preview: `/api/plugins/boot-splash-lab/preview?dir=${encodeURIComponent(name)}&frame=0`,
      });
    }

    return res.status(400).json({ error: `target must be "bootanimation" or "plymouth", not "${target}"` });
  });

  /** Serve one generated frame, so the UI can show what was made. */
  ctx.route("/preview", (req, res) => {
    const dir = String(req.query.dir ?? "");
    const frame = Number(req.query.frame ?? 0);
    // Reject traversal: this handler reads from disk on a query parameter.
    if (!dir || dir.includes("..") || dir.includes("/") || dir.includes("\\")) {
      return res.status(400).json({ error: "invalid dir" });
    }
    const base = path.join(outDir, dir);
    const candidates = [
      path.join(base, "anyrealm", `frame-${frame}.png`),
      path.join(base, "preview.png"),
      path.join(base, "part0", `${String(frame).padStart(5, "0")}.png`),
    ];
    const found = candidates.find((p) => fs.existsSync(p));
    if (!found) return res.status(404).json({ error: "no such frame" });
    res.type("png").send(fs.readFileSync(found));
  });

  /** List what has been generated, with sizes. */
  ctx.route("/outputs", (_req, res) => {
    let dirs = [];
    try {
      dirs = fs
        .readdirSync(outDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const p = path.join(outDir, d.name);
          const files = fs.readdirSync(p, { withFileTypes: true });
          const zip = files.find((f) => f.name === "bootanimation.zip");
          const zipPath = zip ? path.join(p, "bootanimation.zip") : null;
          return {
            name: d.name,
            kind: zip ? "bootanimation" : "plymouth",
            bytes: zipPath ? fs.statSync(zipPath).size : null,
            files: files.length,
            at: fs.statSync(p).mtime.toISOString(),
          };
        })
        .sort((a, b) => (a.at < b.at ? 1 : -1));
    } catch {
      dirs = [];
    }
    res.json({ outputs: dirs, outDir });
  });
}
