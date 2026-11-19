/**
 * APK Studio: turn a small project into an APK that actually installs.
 *
 * The distinction that matters here is between "a zip with an AndroidManifest"
 * and an APK. An APK is:
 *
 *   1. packaged by aapt, so resources are in the binary format Android expects,
 *   2. containing a classes.dex (D8 output), not .class files,
 *   3. aligned on 4-byte boundaries, or the loader refuses it,
 *   4. signed, because Android will not install an unsigned package, and
 *   5. verified after signing, because a sign step that reported success and
 *      produced an unusable file is the failure this whole module exists to
 *      catch.
 *
 * Every one of those is a step that can be skipped and still leave a file named
 * `.apk` on disk. So the pipeline runs all five and then reads the result back
 * with `apksigner verify` and `aapt dump badging`. The numbers the panel shows
 * come from those two commands, not from our own bookkeeping.
 *
 * Why R8 rather than dx: dx is gone from modern build-tools, and a dex produced
 * by anything older than D8 often fails on ART with a verifier error that says
 * nothing about the cause. R8 is the current tool and it also desugars.
 *
 * The keystore is generated once and kept per project, because Android treats a
 * different signing key as a different app: re-signing with a fresh key makes an
 * update install fail with INSTALL_FAILED_UPDATE_INCOMPATIBLE.
 */

import fs from "fs";
import os from "os";
import path from "path";
import { execFile } from "child_process";

/* ------------------------------------------------------------------ */
/* Running tools                                                       */
/* ------------------------------------------------------------------ */

function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      {
        cwd: opts.cwd,
        timeout: opts.timeoutMs ?? 120_000,
        maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, ...(opts.env ?? {}) },
      },
      (err, stdout, stderr) => {
        resolve({
          ok: !err,
          code: err ? (err.code ?? 1) : 0,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          // javac prints its errors first and its deprecation warnings last, so
          // "the last six lines" shows only noise. Error lines win; otherwise
          // fall back to the tail for tools that do report that way.
          detail: (() => {
            const lines = String(stderr || stdout || "").split("\n").filter((l) => l.trim());
            const errors = lines.filter((l) => /\berror\b|ERROR|failed|cannot|not found/i.test(l));
            return (errors.length ? errors : lines).slice(0, 6).join("\n");
          })(),
        });
      },
    );
  });
}

/** Find the android.jar and the build-tools directory without assuming a layout. */
function findSdk() {
  const candidates = [
    "/usr/lib/android-sdk",
    process.env.ANDROID_HOME,
    process.env.ANDROID_SDK_ROOT,
  ].filter(Boolean);

  for (const root of candidates) {
    if (!fs.existsSync(root)) continue;
    const platforms = path.join(root, "platforms");
    let jar = null;
    if (fs.existsSync(platforms)) {
      const dirs = fs.readdirSync(platforms).filter((d) => /^android-\d+$/.test(d));
      // Highest API level first.
      dirs.sort((a, b) => Number(b.split("-")[1]) - Number(a.split("-")[1]));
      for (const d of dirs) {
        const p = path.join(platforms, d, "android.jar");
        if (fs.existsSync(p)) {
          jar = p;
          break;
        }
      }
    }
    const bt = path.join(root, "build-tools");
    let buildTools = null;
    if (fs.existsSync(bt)) {
      const dirs = fs.readdirSync(bt);
      if (dirs.length) buildTools = path.join(bt, dirs[0]);
    }
    if (jar) return { root, jar, buildTools };
  }
  return null;
}

const SDK = findSdk();

/**
 * Directories that are safe to write into.
 *
 * A build writes hundreds of files and then deletes them. Doing that in the
 * project tree leaves debris in a git repo and survives a crash; a temp dir per
 * build is thrown away and cannot collide with a concurrent one.
 */
function buildRoot(workDir) {
  const d = path.join(workDir, "builds");
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/* ------------------------------------------------------------------ */
/* A minimal, working project                                          */
/* ------------------------------------------------------------------ */

/**
 * The starter project.
 *
 * It is a WebView shell rather than a blank Activity because that is the app
 * people actually want first: point it at bundled HTML and you have something on
 * the phone that runs. The manifest is deliberately explicit about exported and
 * targetSdk — an implicit `exported` is an install failure on Android 12+ and a
 * silent security problem.
 */
function starterProject({ packageName, appName, html, minSdk, targetSdk }) {
  const pkg = String(packageName || "local.anyrealm.app");
  const name = String(appName || "AnyRealm App");
  const pkgPath = pkg.split(".");

  return {
    "AndroidManifest.xml": `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="${pkg}" android:versionCode="1" android:versionName="1.0">
  <uses-sdk android:minSdkVersion="${minSdk}" android:targetSdkVersion="${targetSdk}"/>
  <application android:label="${name}" android:hasCode="true">
    <activity android:name=".MainActivity" android:exported="true">
      <intent-filter>
        <action android:name="android.intent.action.MAIN"/>
        <category android:name="android.intent.category.LAUNCHER"/>
      </intent-filter>
    </activity>
  </application>
</manifest>
`,
    [`src/${pkgPath.join("/")}/MainActivity.java`]: `package ${pkg};

import android.app.Activity;
import android.os.Bundle;
import android.webkit.WebSettings;
import android.webkit.WebView;

/**
 * Loads the bundled page. No network permission is requested, so what runs here
 * is what shipped in the APK -- there is nothing these scripts can fetch.
 */
public class MainActivity extends Activity {
  private WebView web;

  @Override
  protected void onCreate(Bundle state) {
    super.onCreate(state);
    web = new WebView(this);
    WebSettings s = web.getSettings();
    s.setJavaScriptEnabled(true);
    s.setDomStorageEnabled(true);
    web.loadUrl("file:///android_asset/index.html");
    setContentView(web);
  }

  @Override
  public void onBackPressed() {
    if (web != null && web.canGoBack()) web.goBack();
    else super.onBackPressed();
  }
}
`,
    "assets/index.html": String(
      html ||
        `<!doctype html>
<html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${name}</title>
<style>
  body{margin:0;font:16px system-ui,-apple-system,sans-serif;background:#0b1220;color:#e2e8f0;
       display:flex;align-items:center;justify-content:center;height:100vh;text-align:center}
  h1{font-size:22px;margin:0 0 8px}
  p{color:#94a3b8;margin:0}
</style></head>
<body><div><h1>${name}</h1><p>Built by AnyRealm APK Studio.</p></div></body></html>
`,
    ),
    "res/values/strings.xml": `<resources><string name="app_name">${name}</string></resources>\n`,
  };
}

/** Write a { relativePath: contents } map under `root`, creating directories. */
function materialize(root, files) {
  for (const [rel, body] of Object.entries(files)) {
    const dest = path.join(root, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, body);
  }
}

/* ------------------------------------------------------------------ */
/* Keystore                                                            */
/* ------------------------------------------------------------------ */

/**
 * One keystore per project name, generated once.
 *
 * A new key means Android thinks it is a different app, so an update over the
 * old install fails. Keeping it means the second build installs over the first
 * the way a user expects.
 */
async function ensureKeystore(workDir, projectId, { alias = "anyrealm", password, dname }) {
  const dir = path.join(workDir, "keys");
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const ks = path.join(dir, `${projectId}.jks`);
  if (fs.existsSync(ks)) {
    return { ok: true, path: ks, created: false, alias, password };
  }
  const r = await run("keytool", [
    "-genkeypair",
    "-keystore", ks,
    "-alias", alias,
    "-keyalg", "RSA",
    "-keysize", "2048",
    "-validity", "10000",
    "-storepass", password,
    "-keypass", password,
    "-dname", dname || "CN=AnyRealm, OU=Local, O=AnyRealm, C=US",
  ]);
  if (!r.ok) return { ok: false, error: `keytool failed: ${r.detail}` };
  fs.chmodSync(ks, 0o600);
  return { ok: true, path: ks, created: true, alias, password };
}

/* ------------------------------------------------------------------ */
/* The pipeline                                                        */
/* ------------------------------------------------------------------ */

/**
 * Build one APK, step by step, keeping a log.
 *
 * The steps are returned whether they pass or fail, because "where did it stop"
 * is the only useful thing to know when a build fails. A single boolean would
 * hide it.
 */
async function buildApk({ workDir, projectId, files, keystore, minSdk, steps }) {
  const sdk = SDK;
  if (!sdk) {
    return {
      ok: false,
      steps: [{ name: "toolchain", ok: false, detail: "no android.jar found; install android-sdk-platform-23" }],
    };
  }

  const dir = fs.mkdtempSync(path.join(buildRoot(workDir), `${projectId}-`));
  const appDir = path.join(dir, "app");
  const classesDir = path.join(dir, "classes");
  const outDir = path.join(dir, "out");
  for (const d of [appDir, classesDir, outDir]) fs.mkdirSync(d, { recursive: true });

  materialize(appDir, files);

  const log = [];
  const record = (name, r, extra = {}) => {
    const step = {
      name,
      ok: r.ok,
      detail: r.ok ? extra.detail ?? "" : r.detail || r.error || "failed",
      ms: extra.ms,
    };
    log.push(step);
    return r.ok;
  };

  const t0 = () => Date.now();

  /* 1. Java -> .class */
  let t = t0();
  const javaFiles = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith(".java")) javaFiles.push(p);
    }
  };
  const srcDir = path.join(appDir, "src");
  if (fs.existsSync(srcDir)) walk(srcDir);
  if (!javaFiles.length) {
    return { ok: false, steps: [{ name: "compile", ok: false, detail: "no .java files under src/" }], log };
  }

  const javac = await run(
    "javac",
    [
      // Java 8 bytecode: D8 accepts it and every ART version does. --release is
      // not used because the platform jar is not a full JDK.
      "-source", "8", "-target", "8",
      "-bootclasspath", sdk.jar,
      "-d", classesDir,
      ...javaFiles,
    ],
    { timeoutMs: 180_000 },
  );
  if (!record("compile java", javac, { detail: `${javaFiles.length} file(s)`, ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }

  const classFiles = [];
  const walkClass = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walkClass(p);
      else if (e.name.endsWith(".class")) classFiles.push(p);
    }
  };
  walkClass(classesDir);

  /* 2. .class -> classes.dex */
  t = t0();
  const r8 = findR8();
  if (!r8) {
    log.push({ name: "dex", ok: false, detail: "no r8/d8 jar found; set ANYREALM_R8_JAR or install r8" });
    return { ok: false, steps: log, dir };
  }
  const dexOut = path.join(dir, "dex");
  fs.mkdirSync(dexOut, { recursive: true });
  const d8 = await run(
    "java",
    ["-cp", r8, "com.android.tools.r8.D8", "--min-api", String(minSdk || 21), "--lib", sdk.jar, "--output", dexOut, ...classFiles],
    { timeoutMs: 180_000 },
  );
  if (!record("dex (D8)", d8, { detail: `${classFiles.length} class(es)`, ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }
  const dexFile = path.join(dexOut, "classes.dex");
  if (!fs.existsSync(dexFile)) {
    log.push({ name: "dex (D8)", ok: false, detail: "D8 reported success but wrote no classes.dex" });
    return { ok: false, steps: log, dir };
  }

  /* 3. aapt: manifest + resources + assets */
  t = t0();
  const unsigned = path.join(outDir, "unsigned.apk");
  const resDir = path.join(appDir, "res");
  const assetsDir = path.join(appDir, "assets");
  const aaptArgs = ["package", "-f", "-M", path.join(appDir, "AndroidManifest.xml")];
  // aapt refuses a missing -S directory, so only pass it when it exists.
  if (fs.existsSync(resDir)) aaptArgs.push("-S", resDir);
  if (fs.existsSync(assetsDir)) aaptArgs.push("-A", assetsDir);
  aaptArgs.push("-I", sdk.jar, "-F", unsigned);

  const aapt = await run("aapt", aaptArgs, { timeoutMs: 120_000 });
  if (!record("package (aapt)", aapt, { detail: path.basename(unsigned), ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }

  /* 4. put the dex in. aapt does not know about classes.dex. */
  t = t0();
  const added = await run("zip", ["-q", "-j", unsigned, dexFile], { cwd: outDir });
  if (!record("add classes.dex", added, { ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }

  /* 5. zipalign. 4 bytes, and it must be before signing. */
  t = t0();
  const aligned = path.join(outDir, "aligned.apk");
  const align = await run("zipalign", ["-f", "4", unsigned, aligned]);
  if (!record("zipalign", align, { ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }

  /* 6. sign */
  t = t0();
  const signed = path.join(outDir, "signed.apk");
  const sign = await run(
    "apksigner",
    [
      "sign",
      "--ks", keystore.path,
      "--ks-pass", `pass:${keystore.password}`,
      "--key-pass", `pass:${keystore.password}`,
      "--ks-key-alias", keystore.alias,
      "--out", signed,
      aligned,
    ],
    { timeoutMs: 120_000 },
  );
  if (!record("sign", sign, { ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }
  if (!fs.existsSync(signed) || fs.statSync(signed).size === 0) {
    log.push({ name: "sign", ok: false, detail: "apksigner reported success but the output is missing or empty" });
    return { ok: false, steps: log, dir };
  }

  /* 7. verify. The whole point: trust the verifier, not the sign step. */
  t = t0();
  const verify = await run("apksigner", ["verify", "--print-certs", "--verbose", signed], { timeoutMs: 60_000 });
  const certDigest = /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(verify.stdout)?.[1] ?? null;
  const schemes = {
    v1: /Verified using v1 scheme \(JAR signing\): true/.test(verify.stdout),
    v2: /Verified using v2 scheme \(APK Signature Scheme v2\): true/.test(verify.stdout),
    v3: /Verified using v3 scheme \(APK Signature Scheme v3\): true/.test(verify.stdout),
  };
  if (!record("verify", verify, { detail: Object.entries(schemes).filter(([, v]) => v).map(([k]) => `v${k}`).join("/") || "no scheme verified", ms: t0() - t })) {
    return { ok: false, steps: log, dir };
  }

  /* 8. read the manifest back, so the panel shows the app's real identity. */
  const badging = await run("aapt", ["dump", "badging", signed]);
  const pkgLine = /^package: name='([^']+)' versionCode='([^']*)' versionName='([^']*)'/m.exec(badging.stdout);
  const launchable = /launchable-activity: name='([^']+)'/m.exec(badging.stdout);
  const label = /application-label:'([^']*)'/.exec(badging.stdout);

  const st = fs.statSync(signed);
  return {
    ok: true,
    steps: log,
    dir,
    apk: {
      path: signed,
      size: st.size,
      packageName: pkgLine?.[1] ?? null,
      versionCode: pkgLine?.[2] ?? null,
      versionName: pkgLine?.[3] ?? null,
      label: label?.[1] ?? null,
      launchActivity: launchable?.[1] ?? null,
      schemes,
      certSha256: certDigest,
    },
  };
}

/**
 * Find R8/D8.
 *
 * Android's r8 is not packaged by every distro, and the Debian build-tools ship
 * apksigner but no dexer. So this looks in the obvious places and then at a jar
 * the user dropped somewhere, rather than failing with "command not found" in a
 * panel whose whole job is to build a dex.
 */
function findR8() {
  const candidates = [
    process.env.ANYREALM_R8_JAR,
    "/opt/anyrealm/r8.jar",
    "/usr/share/java/r8.jar",
    "/usr/lib/android-sdk/build-tools/debian/lib/r8.jar",
  ].filter(Boolean);
  for (const c of candidates) {
    try {
      if (fs.existsSync(c) && fs.statSync(c).size > 1000) return c;
    } catch {
      /* unreadable, try the next */
    }
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Register                                                            */
/* ------------------------------------------------------------------ */

export async function register(ctx) {
  const workDir = ctx.workDir();
  const projectsFile = path.join(workDir, "projects.json");

  let projects = [];
  try {
    projects = JSON.parse(fs.readFileSync(projectsFile, "utf8"));
  } catch {
    /* first run */
  }
  const save = () => {
    try {
      fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2), "utf8");
    } catch (e) {
      ctx.log(`could not save projects: ${e.message}`);
    }
  };

  ctx.route("/catalog", (req, res) => {
    const sdk = SDK;
    return res.json({
      toolchain: sdk
        ? {
            sdkRoot: sdk.root,
            androidJar: sdk.jar,
            buildTools: sdk.buildTools,
            dexer: findR8(),
            // Stated plainly: without these, a build cannot finish, and the
            // panel should say so before a user presses build.
            tools: {
              java: ctx.which("java"),
              javac: ctx.which("javac"),
              aapt: ctx.which("aapt"),
              zipalign: ctx.which("zipalign"),
              apksigner: ctx.which("apksigner"),
              keytool: ctx.which("keytool"),
              zip: ctx.which("zip"),
            },
          }
        : null,
      ready: !!(sdk && findR8() && ctx.which("aapt") && ctx.which("zipalign") && ctx.which("apksigner") && ctx.which("javac")),
      projects: projects.map((p) => ({
        id: p.id,
        packageName: p.packageName,
        appName: p.appName,
        minSdk: p.minSdk,
        targetSdk: p.targetSdk,
        createdAt: p.createdAt,
        lastBuild: p.lastBuild ?? null,
      })),
      limits: {
        // Not arbitrary: each build is a temp tree with a compiled copy of the
        // app, and this box has limited disk.
        maxFiles: 200,
        maxSourceBytes: 2 * 1024 * 1024,
      },
    });
  });

  /**
   * Create a project. Two ways in: a generated starter that builds immediately,
   * or files the user supplies.
   */
  ctx.route("/projects", async (req, res) => {
    if (req.method === "GET") {
      return res.json({ projects });
    }
    if (req.method !== "POST") return res.status(405).json({ error: "use POST" });

    const body = req.body ?? {};
    const packageName = String(body.packageName ?? "").trim();
    // A Java package name is not free-form: `local.my app` produces a manifest
    // aapt rejects with a line number and no explanation.
    if (!/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/.test(packageName)) {
      return res.status(400).json({
        error:
          'packageName must look like "local.anyrealm.app": lowercase letters, digits and underscores in at least two dot-separated parts',
      });
    }

    const id = packageName.replace(/[^a-z0-9]+/g, "-");
    if (projects.some((p) => p.id === id)) {
      return res.status(409).json({ error: `a project "${id}" already exists — open it instead of replacing it` });
    }

    const minSdk = Math.max(21, Math.min(34, Number(body.minSdk) || 21));
    const targetSdk = Math.max(minSdk, Math.min(34, Number(body.targetSdk) || 23));

    let files;
    if (body.files && typeof body.files === "object") {
      files = body.files;
      const total = Object.values(files).reduce((n, v) => n + String(v).length, 0);
      if (Object.keys(files).length > 200 || total > 2 * 1024 * 1024) {
        return res.status(400).json({ error: "project too large: 200 files or 2 MB of source" });
      }
    } else {
      files = starterProject({
        packageName,
        appName: body.appName || packageName,
        html: body.html,
        minSdk,
        targetSdk,
      });
    }

    const project = {
      id,
      packageName,
      appName: String(body.appName ?? packageName).slice(0, 60),
      minSdk,
      targetSdk,
      files,
      createdAt: Date.now(),
    };
    projects.push(project);
    save();
    res.json({ ok: true, project: { id: project.id, packageName, appName: project.appName, files } });
  });

  ctx.route("/projects/:id", (req, res) => {
    const p = projects.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: `no project "${req.params.id}"` });
    if (req.method === "DELETE") {
      projects = projects.filter((x) => x.id !== p.id);
      save();
      return res.json({ ok: true, removed: p.id });
    }
    if (req.method === "PUT" || req.method === "PATCH") {
      if (req.body?.files) {
        p.files = req.body.files;
        save();
      }
      return res.json({ ok: true, project: p });
    }
    res.json({ project: p });
  });

  /** Build and sign. The response carries every step, pass or fail. */
  ctx.route("/projects/:id/build", async (req, res) => {
    const p = projects.find((x) => x.id === req.params.id);
    if (!p) return res.status(404).json({ error: `no project "${req.params.id}"` });

    const password = String(req.body?.keystorePassword ?? "anyrealm-local");
    const key = await ensureKeystore(workDir, p.id, {
      password,
      alias: String(req.body?.keyAlias ?? "anyrealm"),
    });
    if (!key.ok) return res.status(500).json({ error: key.error, steps: [{ name: "keystore", ok: false, detail: key.error }] });

    const result = await buildApk({
      workDir,
      projectId: p.id,
      files: p.files,
      keystore: key,
      minSdk: p.minSdk,
    });

    p.lastBuild = {
      at: Date.now(),
      ok: result.ok,
      apk: result.apk ? { size: result.apk.size, path: result.apk.path } : null,
      failedStep: result.ok ? null : result.steps.find((s) => !s.ok)?.name ?? null,
    };
    save();

    if (!result.ok) {
      return res.status(422).json({
        ok: false,
        steps: result.steps,
        error: `build stopped at "${result.steps.find((s) => !s.ok)?.name ?? "unknown"}"`,
        dir: result.dir ?? null,
      });
    }
    return res.json({
      ok: true,
      steps: result.steps,
      apk: result.apk,
      keystore: { created: key.created, note: key.created ? "a new signing key was generated for this project and kept, so later builds install over this one" : null },
      // The download route is deliberately separate, so the JSON stays small.
      download: `/api/plugins/apk-studio/projects/${p.id}/download`,
    });
  });

  /** Download the last signed APK, with headers a browser will honour. */
  ctx.route("/projects/:id/download", (req, res) => {
    const p = projects.find((x) => x.id === req.params.id);
    if (!p?.lastBuild?.apk?.path) return res.status(404).json({ error: "this project has no signed APK yet" });
    const file = p.lastBuild.apk.path;
    if (!fs.existsSync(file)) return res.status(410).json({ error: "the built APK is gone from disk; build again" });
    res.setHeader("Content-Type", "application/vnd.android.package-archive");
    res.setHeader("Content-Disposition", `attachment; filename="${p.id}.apk"`);
    res.setHeader("Content-Length", String(fs.statSync(file).size));
    fs.createReadStream(file).pipe(res);
  });

  /** Inspect an existing APK: what it is, who signed it, what it needs. */
  ctx.route("/inspect", async (req, res) => {
    if (req.method !== "POST") return res.status(405).json({ error: "use POST" });
    const raw = String(req.body?.dataBase64 ?? "");
    if (!raw) return res.status(400).json({ error: "dataBase64 is required" });
    let buf;
    try {
      buf = Buffer.from(raw, "base64");
    } catch {
      return res.status(400).json({ error: "dataBase64 is not valid base64" });
    }
    if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) {
      return res.status(400).json({ error: "this is not a zip/APK: it does not start with a zip header" });
    }

    const dir = fs.mkdtempSync(path.join(buildRoot(workDir), "inspect-"));
    const file = path.join(dir, "input.apk");
    fs.writeFileSync(file, buf);

    const badging = await run("aapt", ["dump", "badging", file]);
    const verify = await run("apksigner", ["verify", "--print-certs", "--verbose", file]);
    const list = await run("unzip", ["-l", file]);

    const pkgLine = /^package: name='([^']+)' versionCode='([^']*)' versionName='([^']*)'/m.exec(badging.stdout);
    const sdkLine = /^(sdkVersion|targetSdkVersion):'?(\d+)'?/gm;
    const sdks = {};
    for (const m of badging.stdout.matchAll(sdkLine)) sdks[m[1]] = Number(m[2]);

    res.json({
      size: buf.length,
      packageName: pkgLine?.[1] ?? null,
      versionCode: pkgLine?.[2] ?? null,
      versionName: pkgLine?.[3] ?? null,
      minSdk: sdks.sdkVersion ?? null,
      targetSdk: sdks.targetSdkVersion ?? null,
      // An unsigned APK cannot be installed, and the difference between
      // "unverified" and "signed by someone" matters.
      signed: verify.ok,
      signerCertSha256: /certificate SHA-256 digest: ([0-9a-f]+)/i.exec(verify.stdout)?.[1] ?? null,
      schemes: {
        v1: /v1 scheme \(JAR signing\): true/.test(verify.stdout),
        v2: /v2 scheme \(APK Signature Scheme v2\): true/.test(verify.stdout),
        v3: /v3 scheme \(APK Signature Scheme v3\): true/.test(verify.stdout),
      },
      verifyError: verify.ok ? null : verify.detail || "apksigner verify failed",
      // Permissions are the thing a person actually wants to know before
      // installing someone else's APK.
      permissions: [...badging.stdout.matchAll(/uses-permission: name='([^']+)'/g)].map((m) => m[1]),
      // unzip -l prints a header, then rows, then a footer row with the totals.
      // Counting rows that start with a size is what survives both layouts.
      entries: list.stdout.split("\n").filter((l) => /^\s*\d+\s+\d{4}-\d{2}-\d{2}/.test(l)).length,
      badging: badging.ok ? badging.stdout.split("\n").slice(0, 14).join("\n") : badging.detail,
    });
  });

  ctx.log(
    SDK
      ? `apk studio: android.jar ${SDK.jar}; dexer ${findR8() ?? "MISSING"}`
      : "apk studio: no android-sdk found — builds will refuse until android.jar exists",
  );
}
