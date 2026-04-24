const { app, BrowserWindow, session, net, shell, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const AdmZip = require("adm-zip");

app.setName("MultiStreamer");

const BTTV_ID = "ajopnjidmegmdimjlfnijceegpefgped";
const CRX_URL = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${BTTV_ID}%26uc`;
const CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // 24 hours

function downloadCRX(url) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    const chunks = [];
    request.on("response", (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        const redirectUrl = Array.isArray(response.headers.location)
          ? response.headers.location[0]
          : response.headers.location;
        downloadCRX(redirectUrl).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks)));
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

function extractCRX(crxBuffer, destPath) {
  // CRX3 format: "Cr24" (4) + version (4) + header_length (4) + header + ZIP
  const headerLen = crxBuffer.readUInt32LE(8);
  const zipStart = 12 + headerLen;
  const zipBuffer = crxBuffer.subarray(zipStart);

  if (fs.existsSync(destPath)) {
    fs.rmSync(destPath, { recursive: true });
  }
  const zip = new AdmZip(zipBuffer);
  zip.extractAllTo(destPath, true);
}

async function loadBTTV() {
  const extDir = path.join(app.getPath("userData"), "extensions");
  const destPath = path.join(extDir, BTTV_ID);
  const stampFile = path.join(extDir, `${BTTV_ID}.stamp`);

  fs.mkdirSync(extDir, { recursive: true });

  // Check if we need to download (missing or stale cache)
  let needsDownload = !fs.existsSync(path.join(destPath, "manifest.json"));
  if (!needsDownload && fs.existsSync(stampFile)) {
    const age = Date.now() - fs.statSync(stampFile).mtimeMs;
    needsDownload = age > CACHE_MAX_AGE_MS;
  }

  if (needsDownload) {
    try {
      console.log("BetterTTV: downloading from Chrome Web Store...");
      const crxBuffer = await downloadCRX(CRX_URL);
      extractCRX(crxBuffer, destPath);
      fs.writeFileSync(stampFile, String(Date.now()));
      console.log("BetterTTV: downloaded and extracted");
    } catch (e) {
      console.error("BetterTTV: download failed -", e.message);
      if (!fs.existsSync(path.join(destPath, "manifest.json"))) {
        return; // No cached version to fall back on
      }
      console.log("BetterTTV: using cached version");
    }
  }

  try {
    await session.defaultSession.loadExtension(destPath);
    console.log("BetterTTV: loaded successfully");
  } catch (e) {
    console.error("BetterTTV: failed to load -", e.message);
  }
}


const REPO_RELEASES_URL = "https://github.com/Lucidic15/MultiStreamer-Electron/releases";
const GITHUB_API_LATEST = "https://api.github.com/repos/Lucidic15/MultiStreamer-Electron/releases/latest";

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    const request = net.request(url);
    request.setHeader("User-Agent", "MultiStreamer");
    const chunks = [];
    request.on("response", (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString())); }
        catch (e) { reject(e); }
      });
      response.on("error", reject);
    });
    request.on("error", reject);
    request.end();
  });
}

async function checkForUpdates(win) {
  try {
    const release = await fetchJSON(GITHUB_API_LATEST);
    const latest = release.tag_name.replace(/^v/, "");
    const current = app.getVersion();
    if (latest === current) return;

    const { response } = await dialog.showMessageBox(win, {
      type: "info",
      title: "Update Available",
      message: `A new version of MultiStreamer is available (v${latest}).\nYou are currently on v${current}.`,
      buttons: ["Download", "Later"],
      defaultId: 0,
      cancelId: 1,
    });

    if (response === 0) {
      shell.openExternal(REPO_RELEASES_URL);
    }
  } catch (e) {
    console.error("Update check failed:", e.message);
  }
}

function createWindow() {
  const win = new BrowserWindow({
    show: false,
    icon: path.join(__dirname, "build", "icon.png"),
    autoHideMenuBar: true,
    title: "MultiStreamer",
  });

  win.maximize();
  win.show();

  win.loadURL("https://multistreamer.app");

  // Keep the title fixed so taskbar and Volume Mixer show "MultiStreamer"
  win.on("page-title-updated", (e) => e.preventDefault());

  win.webContents.once("did-finish-load", () => checkForUpdates(win));
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running – quit immediately
  app.quit();
} else {
  // When a second instance is launched, open a new window (shares session/login)
  app.on("second-instance", () => {
    createWindow();
  });

  app.whenReady().then(async () => {
    await loadBTTV();
    createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
