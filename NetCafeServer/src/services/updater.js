import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { exec, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { db } from '../db.js';
import { ClientManager } from './clientManager.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '../../');

/**
 * ServerUpdater — Enterprise Zero-Downtime GitHub Releases OTA Auto-Updater for Node.js Server.
 * Xususiyatlari:
 * 1. GitHub Releases direct static endpointlari orqali version.json ni davriy tekshirish.
 * 2. User-Agent: Softech-Updater sarlavhasi (GitHub 403 Forbidden ni oldini oladi).
 * 3. 302 Redirect (GitHub -> AWS S3) avtomatik kuzatiladi.
 * 4. Faol seanslar (activeSessions) tekshiruvi: 0 ta bo'lsa yoki admin ruxsati bilan yangilash.
 * 5. Ma'lumotlar bazasi (netcafe.db*) daxlsizligi to'liq ta'minlangan.
 * 6. WebSocket orqali UPDATE_AVAILABLE va SERVER_UPDATE_AVAILABLE hodisalarini tarqatish.
 */
export class ServerUpdater {
  static currentVersion = '1.0.2';
  static manifestUrl = null;
  static updatesDir = path.resolve(ROOT_DIR, 'updates');
  static stagingDir = path.resolve(ROOT_DIR, 'updates/staging');

  static state = {
    isChecking: false,
    isDownloading: false,
    isStaged: false,
    stagedVersion: null,
    latestManifest: null,
    lastChecked: null,
    error: null,
  };

  static timer = null;

  static init() {
    try {
      const pkgPath = path.resolve(ROOT_DIR, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
        this.currentVersion = pkg.version || '1.0.2';
      }
    } catch {
      this.currentVersion = '1.0.2';
    }

    this.manifestUrl = this.resolveManifestUrl();

    if (!fs.existsSync(this.updatesDir)) fs.mkdirSync(this.updatesDir, { recursive: true });
    if (!fs.existsSync(this.stagingDir)) fs.mkdirSync(this.stagingDir, { recursive: true });

    console.log(`🔄 [ServerUpdater] Initsializatsiya qilindi. Joriy versiya: v${this.currentVersion}, Manifest: ${this.manifestUrl}`);
  }

  static resolveManifestUrl() {
    // 1. Muhit o'zgaruvchilarini tekshirish
    if (process.env.UPDATE_MANIFEST_URL) {
      return process.env.UPDATE_MANIFEST_URL.trim();
    }

    // 2. config.json dan qidirish
    try {
      const configPath = path.resolve(ROOT_DIR, 'config.json');
      if (fs.existsSync(configPath)) {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
        if (config.updateManifestUrl) {
          return config.updateManifestUrl.trim();
        }
        if (config.githubOwner && config.githubRepo) {
          return `https://github.com/${config.githubOwner}/${config.githubRepo}/releases/latest/download/version.json`;
        }
      }
    } catch (err) {
      console.warn(`[ServerUpdater] config.json o'qishda xatolik:`, err.message);
    }

    // 3. Fallback standart GitHub reliz URL
    return 'https://github.com/makhmalatifovsafo-arch/Softech-game-club/releases/latest/download/version.json';
  }

  static startPeriodicChecks(intervalMs = 3 * 60 * 1000) {
    this.init();

    // Dastur ishga tushgach 5 soniyadan so'ng dastlabki tekshiruv
    setTimeout(() => {
      this.checkForUpdates().catch(() => {});
    }, 5000);

    if (this.timer) clearInterval(this.timer);
    this.timer = setInterval(() => {
      this.checkForUpdates().catch(() => {});
    }, intervalMs);
  }

  static async checkForUpdates() {
    if (this.state.isChecking || this.state.isDownloading) return this.getStatus();

    this.state.isChecking = true;
    this.state.error = null;
    this.state.lastChecked = new Date().toISOString();

    try {
      console.log(`🌐 [ServerUpdater] GitHub Manifest tekshirilmoqda: ${this.manifestUrl}`);
      const manifest = await this.fetchJson(this.manifestUrl);
      if (!manifest) {
        return this.getStatus();
      }
      this.state.latestManifest = manifest;

      if (!manifest.version) {
        throw new Error("Noto'g'ri manifest formati (version topilmadi)");
      }

      const isNewer = this.compareSemver(manifest.version, this.currentVersion) > 0;

      if (isNewer) {
        console.log(`🚀 [ServerUpdater] Yangi server relizi topildi: v${manifest.version} (Joriy: v${this.currentVersion})`);
        
        // Agar bu versiya allaqachon staged bo'lsa, xabardor qilamiz
        if (this.state.isStaged && this.state.stagedVersion === manifest.version) {
          this.broadcastUpdateNotice();
          return this.getStatus();
        }

        // Yuklab olish va ochish
        const serverFile = manifest.server;
        const downloadUrl = serverFile ? (serverFile.downloadUrl || serverFile.url) : null;

        if (downloadUrl) {
          await this.downloadAndStage(manifest);
        } else {
          console.warn("[ServerUpdater] Manifestda server yangilanish havolasi mavjud emas.");
        }
      } else {
        console.log(`✓ [ServerUpdater] Server eng so'nggi versiyada (v${this.currentVersion}).`);
      }
    } catch (err) {
      this.state.error = err.message;
      console.warn(`⚠️ [ServerUpdater] Tekshirishda xatolik:`, err.message);
    } finally {
      this.state.isChecking = false;
    }

    return this.getStatus();
  }

  static async downloadAndStage(manifest) {
    this.state.isDownloading = true;
    const version = manifest.version;
    const serverFile = manifest.server;
    const downloadUrl = serverFile.downloadUrl || serverFile.url;
    const expectedSha256 = serverFile.sha256;

    const zipFile = path.resolve(this.stagingDir, `server_v${version}.zip`);
    const targetExtractDir = path.resolve(this.updatesDir, `v${version}`);

    try {
      console.log(`⬇️ [ServerUpdater] GitHub Server relizi yuklanmoqda: ${downloadUrl}`);
      await this.downloadFile(downloadUrl, zipFile);

      // SHA256 tekshiruvi (agar ko'rsatilgan bo'lsa)
      if (expectedSha256 && expectedSha256.trim() !== '') {
        const hash = await this.calculateSha256(zipFile);
        if (hash.toLowerCase() !== expectedSha256.toLowerCase().trim()) {
          fs.unlinkSync(zipFile);
          throw new Error(`SHA256 mos kelmadi! Kutilgan: ${expectedSha256}, Hisoblangan: ${hash}`);
        }
        console.log(`🔒 [ServerUpdater] SHA256 yaxlitligi tasdiqlandi.`);
      }

      // Arxivni vX.X.X papkasiga ochish
      if (fs.existsSync(targetExtractDir)) {
        fs.rmSync(targetExtractDir, { recursive: true, force: true });
      }
      fs.mkdirSync(targetExtractDir, { recursive: true });

      await this.extractZip(zipFile, targetExtractDir);
      try { fs.unlinkSync(zipFile); } catch {}

      this.state.isStaged = true;
      this.state.stagedVersion = version;
      console.log(`📦 [ServerUpdater] Versiya v${version} updates/v${version} papkasiga tayyorlab qo'yildi!`);

      this.broadcastUpdateNotice();

      // Agar faol seanslar bo'lmasa (0 ta kompyuter band), avtomatik yangilashni darhol qo'llaymiz
      const activeSessions = this.getActiveSessionsCount();
      if (activeSessions === 0) {
        console.log(`⚡ [ServerUpdater] Faol seanslar yo'q (0 ta PC band). Avtomatik OTA yangilanish qo'llanilmoqda...`);
        setTimeout(() => {
          this.applyUpdate({ force: false }).catch(e => console.warn('[ServerUpdater] Auto-apply xatosi:', e.message));
        }, 3000);
      } else {
        console.log(`⏳ [ServerUpdater] Faol seanslar ketmoqda (${activeSessions} ta). Seanslar tugashi bilan yangilanish qo'llaniladi.`);
      }
    } catch (err) {
      this.state.error = err.message;
      console.error(`❌ [ServerUpdater] Yuklash yoki ochishda xatolik:`, err.message);
      throw err;
    } finally {
      this.state.isDownloading = false;
    }
  }

  static getActiveSessionsCount() {
    try {
      const row = db.prepare("SELECT COUNT(*) as count FROM sessions WHERE status = 'ACTIVE'").get();
      return row ? Number(row.count) : 0;
    } catch {
      return 0;
    }
  }

  static getStatus() {
    const activeSessions = this.getActiveSessionsCount();
    return {
      currentVersion: this.currentVersion,
      latestVersion: this.state.latestManifest?.version || this.currentVersion,
      isChecking: this.state.isChecking,
      isDownloading: this.state.isDownloading,
      isStaged: this.state.isStaged,
      stagedVersion: this.state.stagedVersion,
      activeSessions,
      canApply: this.state.isStaged && activeSessions === 0,
      changelog: this.state.latestManifest?.changelog || null,
      releaseDate: this.state.latestManifest?.releaseDate || null,
      lastChecked: this.state.lastChecked,
      error: this.state.error,
    };
  }

  static broadcastUpdateNotice() {
    const status = this.getStatus();
    try {
      // 1. UPDATE_AVAILABLE hodisasi (talabga asosan)
      ClientManager.broadcast('UPDATE_AVAILABLE', {
        version: status.latestVersion,
        changelog: status.changelog,
        ...status,
      });

      // 2. SERVER_UPDATE_AVAILABLE hodisasi (mavjud UI bilan moslik uchun)
      ClientManager.broadcast('SERVER_UPDATE_AVAILABLE', status);
    } catch (err) {
      console.warn(`[ServerUpdater] Broadcast xatosi:`, err.message);
    }
  }

  static async applyUpdate({ force = false } = {}) {
    if (!this.state.isStaged || !this.state.stagedVersion) {
      return { success: false, error: "Qo'llash uchun tayyorlangan yangilanish mavjud emas." };
    }

    const activeSessions = this.getActiveSessionsCount();
    if (activeSessions > 0 && !force) {
      return {
        success: false,
        error: `Faol o'yin seanslari ketmoqda (${activeSessions} ta kompyuter band). Yangilash uchun seanslar tugashi kerak yoki majburiy rejim zarur.`,
        activeSessions,
        canForce: true,
      };
    }

    const version = this.state.stagedVersion;
    const sourceDir = path.resolve(this.updatesDir, `v${version}`);

    if (!fs.existsSync(sourceDir)) {
      return { success: false, error: `Yangilanish papkasi topilmadi: ${sourceDir}` };
    }

    console.log(`🚀 [ServerUpdater] Server yangilanishi qo'llanilmoqda (v${this.currentVersion} -> v${version})...`);

    // Mutlaqo qora oynasiz (Headless / Silent) yangilash uchun bat va vbs yaratamiz
    const batchScriptPath = path.resolve(ROOT_DIR, 'apply_server_update.bat');
    const vbsScriptPath = path.resolve(ROOT_DIR, 'apply_server_update.vbs');

    const batchContent = `@echo off
cd /d "${ROOT_DIR}"

:: 1. Eski server jarayoni to'xtashini kutish
timeout /t 2 /nobreak >nul 2>&1

:: 2. Zaxira nusxasi yaratilmoqda (netcafe.db daxlsiz qoladi)
if not exist "backup_v${this.currentVersion}" mkdir "backup_v${this.currentVersion}" >nul 2>&1
if exist "src" xcopy /E /I /Y "src" "backup_v${this.currentVersion}\\src" >nul 2>&1
if exist "public" xcopy /E /I /Y "public" "backup_v${this.currentVersion}\\public" >nul 2>&1
if exist "package.json" copy /Y "package.json" "backup_v${this.currentVersion}\\package.json" >nul 2>&1

:: 3. Yangi fayllar ko'chirilmoqda
xcopy /E /I /Y "${sourceDir}\\*" "." >nul 2>&1

:: 4. Serverni qora oynasiz, orqa fonda qayta ishga tushirish
if exist "start_server_background.vbs" (
    start "" wscript.exe //B //Nologo "start_server_background.vbs"
) else if exist ".\\runtime\\node.exe" (
    start "" /B ".\\runtime\\node.exe" src/server.js
) else (
    start "" /B node src/server.js
)

exit
`;

    // Qora konsol oynasini 100% yashiruvchi VBScript
    const vbsContent = `Set WshShell = CreateObject("WScript.Shell")
Set FSO = CreateObject("Scripting.FileSystemObject")
currentDir = "${ROOT_DIR.replace(/\\/g, '\\\\')}"
WshShell.CurrentDirectory = currentDir
WshShell.Run "cmd.exe /c """ & currentDir & "\\apply_server_update.bat""", 0, False
`;

    fs.writeFileSync(batchScriptPath, batchContent, 'utf8');
    fs.writeFileSync(vbsScriptPath, vbsContent, 'utf8');

    // wscript.exe orqali qora oynasiz ishga tushirish
    const child = spawn('wscript.exe', ['//B', '//Nologo', vbsScriptPath], {
      detached: true,
      stdio: 'ignore',
      cwd: ROOT_DIR,
      windowsHide: true,
    });
    child.unref();

    // Serverni xavfsiz to'xtatish
    setTimeout(() => {
      process.exit(0);
    }, 1000);

    return {
      success: true,
      message: `Yangilanish boshlandi. Server v${version} versiyasiga yangilanib, 3-5 soniya ichida qayta ishga tushadi.`,
    };
  }

  // ---- Yordamchi metodlar ----

  static compareSemver(v1, v2) {
    const parse = (v) => {
      const parts = String(v).replace(/^v/i, '').split('.').map(n => parseInt(n, 10) || 0);
      return [parts[0] || 0, parts[1] || 0, parts[2] || 0];
    };
    const [maj1, min1, pat1] = parse(v1);
    const [maj2, min2, pat2] = parse(v2);

    if (maj1 !== maj2) return maj1 - maj2;
    if (min1 !== min2) return min1 - min2;
    return pat1 - pat2;
  }

  static async fetchJson(urlStr) {
    const response = await fetch(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': 'Softech-Updater',
        'Accept': 'application/json',
      },
      redirect: 'follow',
    });

    if (response.status === 404) {
      console.log(`ℹ️ [ServerUpdater] GitHub-da hali yangi reliz e'lon qilinmagan (HTTP 404). Server to'liq faol rejimda ishlamoqda.`);
      return null;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  static async downloadFile(urlStr, destFile) {
    const response = await fetch(urlStr, {
      method: 'GET',
      headers: {
        'User-Agent': 'Softech-Updater',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      throw new Error(`Yuklab bo'lmadi: HTTP ${response.status} ${response.statusText}`);
    }

    const fileStream = fs.createWriteStream(destFile);
    await new Promise((resolve, reject) => {
      Readable.fromWeb(response.body).pipe(fileStream);
      fileStream.on('finish', resolve);
      fileStream.on('error', (err) => {
        try { fs.unlinkSync(destFile); } catch {}
        reject(err);
      });
    });
  }

  static calculateSha256(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('data', data => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  static extractZip(zipPath, targetDir) {
    return new Promise((resolve, reject) => {
      // Windows 10/11 native bsdtar (tez va xavfsiz)
      const cmd = `tar -xf "${zipPath}" -C "${targetDir}"`;
      exec(cmd, (err) => {
        if (!err) {
          return resolve();
        }
        // Fallback: PowerShell Expand-Archive
        const psCmd = `powershell -NoProfile -Command "Expand-Archive -Path '${zipPath}' -DestinationPath '${targetDir}' -Force"`;
        exec(psCmd, (psErr) => {
          if (psErr) reject(psErr);
          else resolve();
        });
      });
    });
  }
}
