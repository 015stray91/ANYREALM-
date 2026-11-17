/**
 * Electron main process.
 *
 * The desktop app is a shell around the same server the browser talks to. That is
 * deliberate: the server is where every decision lives (catalogs, plan resolution,
 * workflow generation), and duplicating any of it into the shell would create two
 * places to disagree. So the shell starts the server on a random free port, points
 * a window at it, and does nothing else.
 *
 * Two things this shell has to get right that a browser tab does not:
 *
 *   - the server is a child process, so quitting the app must kill it, and a
 *     server that dies must not leave a dead window behind;
 *   - the port is chosen by the OS, not fixed at 3000, so two copies of the app
 *     can run and so a developer's dev server does not collide with it.
 */

const { app, BrowserWindow, shell, dialog, Menu } = require("electron");
const path = require("path");
const net = require("net");
const { spawn } = require("child_process");

/** Ask the OS for a free port by binding to 0 and reading it back. */
function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

let serverProc = null;
let win = null;

async function startServer() {
  const port = await freePort();
  const isDev = !app.isPackaged;

  // In a packaged app the server is a bundled CJS file under the app directory. In
  // development it is the TypeScript entry, run with the project's own runtime so
  // the module resolution matches what `npm run dev` does.
  //
  // getAppPath() rather than resourcesPath + "app": with asar disabled the app
  // directory is real on disk, and the child process needs a real path because
  // ELECTRON_RUN_AS_NODE does not read inside an asar archive.
  const root = app.isPackaged ? app.getAppPath() : path.join(__dirname, "..");
  const entry = app.isPackaged ? path.join(root, "dist", "server.cjs") : "server.ts";

  const env = {
    ...process.env,
    NODE_ENV: "production",
    PORT: String(port),
    HOST: "127.0.0.1",
    // The server resolves its catalogs through paths.ts; point it at the app root
    // explicitly so a launcher's working directory cannot change what it loads.
    ANYREALM_DATA_DIR: root,
  };

  // Packaged: electron's own binary with ELECTRON_RUN_AS_NODE makes a plain Node
  // process, so the app does not need a system Node install and cannot be broken by
  // the user having an old one on PATH. Development: the project's runtime, because
  // the source is TypeScript and only Bun/tsx resolve the extensionless imports.
  const cmd = app.isPackaged ? process.execPath : process.env.ANYREALM_NODE || "bun";
  if (app.isPackaged) env.ELECTRON_RUN_AS_NODE = "1";
  const args = [entry];

  serverProc = spawn(cmd, args, {
    cwd: root,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  const log = [];
  serverProc.stdout.on("data", (d) => {
    const s = String(d);
    log.push(s);
    if (isDev) process.stdout.write(`[server] ${s}`);
  });
  serverProc.stderr.on("data", (d) => {
    const s = String(d);
    log.push(s);
    if (isDev) process.stderr.write(`[server] ${s}`);
  });

  serverProc.on("exit", (code) => {
    if (code !== 0 && win && !win.isDestroyed()) {
      dialog.showErrorBox(
        "The builder server stopped",
        `Exit code ${code}.\n\n${log.slice(-20).join("")}`,
      );
    }
    serverProc = null;
  });

  // Wait for the port to accept a connection rather than sleeping a fixed time:
  // bootstrap can take a second on a cold start and a fixed sleep either races it
  // or wastes time.
  await waitForPort(port, 15000);
  return port;
}

function waitForPort(port, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const sock = net.connect(port, "127.0.0.1");
      sock.once("connect", () => {
        sock.destroy();
        resolve();
      });
      sock.once("error", () => {
        sock.destroy();
        if (Date.now() > deadline) reject(new Error(`server did not open port ${port}`));
        else setTimeout(attempt, 150);
      });
    };
    attempt();
  });
}

async function createWindow() {
  const port = await startServer();

  win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: "#0b1120",
    title: "AnyRealm Builder",
    webPreferences: {
      // The UI is the same code the browser runs, so it needs no Node integration.
      // Keeping it off means a compromised page cannot reach the filesystem.
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  // External links open in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  await win.loadURL(`http://127.0.0.1:${port}/`);
  win.on("closed", () => {
    win = null;
  });
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const template = [
    ...(isMac ? [{ role: "appMenu" }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open build output folder",
          click: () => shell.openPath(path.join(app.getPath("home"), ".anyrealm")),
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { role: "togglefullscreen" }],
    },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(async () => {
  buildMenu();
  try {
    await createWindow();
  } catch (err) {
    dialog.showErrorBox("Could not start", String(err && err.message ? err.message : err));
    app.quit();
  }

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

// One window per instance: a second launch focuses the first rather than starting
// a second server against the same data directory.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
}

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// The server is a child; if it outlives the shell it holds the port and the next
// launch cannot bind. Kill it on every exit path.
function stopServer() {
  if (serverProc) {
    try {
      serverProc.kill("SIGTERM");
    } catch {
      /* already gone */
    }
    serverProc = null;
  }
}
app.on("before-quit", stopServer);
process.on("exit", stopServer);
process.on("SIGINT", () => {
  stopServer();
  process.exit(0);
});
