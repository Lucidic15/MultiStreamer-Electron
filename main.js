const { app, BrowserWindow, session } = require("electron");
const path = require("path");
const fs = require("fs");

app.setName("MultiStreamer");

// BTTV is loaded as a Chrome extension from the user's Chrome install
const BTTV_ID = "ajopnjidmegmdimjlfnijceegpefgped";


function findChromeExtension(extId) {
  const chromeBase = path.join(
    process.env.LOCALAPPDATA,
    "Google",
    "Chrome",
    "User Data"
  );
  if (!fs.existsSync(chromeBase)) return null;

  // Search all Chrome profiles (Default, Profile 1, Profile 2, etc.)
  const profiles = fs.readdirSync(chromeBase).filter((name) => {
    return name === "Default" || name.startsWith("Profile ");
  });

  for (const profile of profiles) {
    const extDir = path.join(chromeBase, profile, "Extensions", extId);
    if (!fs.existsSync(extDir)) continue;

    // Get the latest version folder
    const versions = fs.readdirSync(extDir).sort();
    if (versions.length === 0) continue;

    const latestVersion = path.join(extDir, versions[versions.length - 1]);
    if (fs.existsSync(path.join(latestVersion, "manifest.json"))) {
      return latestVersion;
    }
  }
  return null;
}

function copyDirSync(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDirSync(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

async function loadBTTV() {
  const localDir = path.join(app.getPath("userData"), "extensions");
  fs.mkdirSync(localDir, { recursive: true });

  const chromePath = findChromeExtension(BTTV_ID);
  if (!chromePath) {
    console.log("BetterTTV: not found in Chrome, skipping");
    return;
  }

  const destPath = path.join(localDir, BTTV_ID);
  try {
    if (fs.existsSync(destPath)) {
      fs.rmSync(destPath, { recursive: true });
    }
    copyDirSync(chromePath, destPath);
    await session.defaultSession.loadExtension(destPath);
    console.log("BetterTTV: loaded successfully");
  } catch (e) {
    console.error("BetterTTV: failed to load -", e.message);
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
}

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  // Another instance is already running – quit immediately
  app.quit();
} else {
  // When a second instance is launched, focus the existing window
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    await loadBTTV();
    createWindow();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
