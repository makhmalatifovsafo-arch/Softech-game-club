import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import { fetchUpdateManifest, downloadUpdateFile } from './updateTransport.js';
import { db } from '../db.js';
import { canApplyUpdate, validateRelease } from './updatePolicy.js';

const execute = promisify(execFile);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export class ServerUpdater {
  static currentVersion = '1.0.0';
  static manifestUrl = null;
  static updatesDir = path.join(ROOT_DIR, 'updates');
  static stagingDir = path.join(this.updatesDir, 'staging');
  static timer = null;
  static idleTimer = null;
  static pendingWrites = 0;
  static applying = false;
  static preparing = false;
  static evaluating = false;
  static minimumIdleSeconds = 10;
  static idleSeconds = -1;
  static nextApplyAttempt = 0;
  static onShutdown = () => process.exit(0);
  static state = { isChecking: false, isDownloading: false, isStaged: false, stagedVersion: null,
    source: null, latestManifest: null, lastChecked: null, lastSuccessfulCheck: null,
    downloadedBytes: 0, totalBytes: null, error: null };

  static init() {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    this.currentVersion = pkg.version;
    let config = {};
    try { config = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config.json'), 'utf8')); } catch {}
    this.minimumIdleSeconds = Math.min(3600, Math.max(5, (Number(config.updateIdleSeconds) === 30 ? 10 : Number(config.updateIdleSeconds)) || 10));
    this.manifestUrl = process.env.UPDATE_MANIFEST_URL || config.updateManifestUrl ||
      'https://github.com/makhmalatifovsafo-arch/Softech-game-club/releases/latest/download/version.json';
    fs.mkdirSync(this.stagingDir, { recursive: true });
  }

  static startPeriodicChecks(intervalMs = 60000) {
    this.init();
    setTimeout(() => this.checkForUpdates(), 5000).unref();
    this.timer = setInterval(() => this.checkForUpdates(), intervalMs);
    this.idleTimer = setInterval(() => this.evaluateIdleUpdate(), 1000);
  }

  static async checkForUpdates() {
    if (this.state.isChecking || this.state.isDownloading || this.applying || this.preparing) return this.getStatus();
    this.state.isChecking = true;
    this.state.lastChecked = new Date().toISOString();
    try {
      const manifest = await this.fetchJson(this.manifestUrl);
      if (!manifest) return this.getStatus();
      const release = validateRelease(manifest, 'server');
      this.state.latestManifest = manifest;
      this.state.lastSuccessfulCheck = new Date().toISOString();
      this.state.error = null;
      if (this.compareSemver(release.version, this.currentVersion) <= 0 || this.isFailedVersion(release.version))
        return this.getStatus();
      if (this.state.stagedVersion !== release.version) await this.downloadAndStage(manifest);
    } catch (error) { this.state.error = error.message; }
    finally { this.state.isChecking = false; }
    return this.getStatus();
  }

  static isFailedVersion(version) {
    try { return JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'updates-failed-version.json'), 'utf8')).version === version; }
    catch { return false; }
  }

  static async downloadAndStage(manifest) {
    const release = validateRelease(manifest, 'server');
    this.state.isDownloading = true;
    this.state.downloadedBytes = 0;
    this.state.totalBytes = null;
    const candidate = path.join(this.stagingDir, 'v' + release.version + '-' + crypto.randomUUID());
    fs.mkdirSync(candidate, { recursive: true });
    const zip = path.join(candidate, 'download.zip');
    const extracted = path.join(candidate, 'package');
    let staged = false;
    try {
      await this.downloadFile(release.url, zip);
      if (await this.calculateSha256(zip) !== release.sha256) throw new Error('Release SHA256 mismatch');
      await this.extractZip(zip, extracted);
      const metadata = JSON.parse(fs.readFileSync(path.join(extracted, 'update-package.json'), 'utf8'));
      if (metadata.kind !== 'server' || metadata.version !== release.version ||
          !fs.existsSync(path.join(extracted, 'SoftechUpdater.exe')) || !fs.existsSync(path.join(extracted, 'src/server.js')))
        throw new Error('Incomplete server update package');
      fs.unlinkSync(zip);
      this.state.source = extracted;
      this.state.stagedVersion = release.version;
      this.state.isStaged = true;
      staged = true;
      this.state.error = null;
    } finally {
      this.state.isDownloading = false;
      if (!staged) {
        try { fs.rmSync(candidate, { recursive: true, force: true }); } catch {}
      }
    }
  }

  static getActiveSessionsCount() {
    try { return Number(db.prepare("SELECT COUNT(*) AS count FROM sessions WHERE status = 'ACTIVE'").get().count); }
    catch { return -1; } // Unknown must never be treated as zero.
  }
  static policy() {
    return { staged: this.state.isStaged, applying: this.applying, activeSessions: this.getActiveSessionsCount(),
      pendingWrites: this.pendingWrites, idleSeconds: this.idleSeconds, minimumIdleSeconds: this.minimumIdleSeconds };
  }
  static getStatus() {
    return { ...this.state, source: undefined, currentVersion: this.currentVersion,
      latestVersion: this.state.latestManifest?.version || null,
      activeSessions: this.getActiveSessionsCount(), isApplying: this.applying, silent: true,
      idleSeconds: this.idleSeconds, canApply: canApplyUpdate(this.policy()) };
  }
  static broadcastUpdateNotice() { /* Silent updates do not interrupt the cashier. */ }

  static async probeIdle() {
    if (process.platform !== 'win32') return -1;
    try {
      const { stdout } = await execute(path.join(ROOT_DIR, 'SoftechUpdater.exe'), ['--probe-idle'],
        { windowsHide: true, timeout: 5000 });
      const seconds = JSON.parse(stdout).idleSeconds;
      return Number.isFinite(seconds) ? seconds : -1;
    } catch { return -1; }
  }

  static async evaluateIdleUpdate() {
    if (!this.state.isStaged || this.applying || this.evaluating || Date.now() < this.nextApplyAttempt) return;
    this.evaluating = true;
    try { await this.applyUpdate(); }
    catch (error) { this.state.error = error.message; this.nextApplyAttempt = Date.now() + 60000; }
    finally { this.evaluating = false; }
  }

  static async applyUpdate() {
    // Manual/remote requests cannot force a restart through a live game session.
    if (this.applying || this.preparing || !this.state.isStaged || this.state.isDownloading)
      return { success: false, error: 'No idle update ready.' };
    this.idleSeconds = await this.probeIdle();
    if (!canApplyUpdate(this.policy())) return { success: false, error: 'Waiting for idle input, no active sessions and no pending writes.' };
    this.preparing = true; // Keep serving the cashier while files are copied.
    const handover = path.join(this.stagingDir, 'handover-' + crypto.randomUUID());
    fs.mkdirSync(handover);
    const helperPath = path.join(handover, 'SoftechUpdater.exe');
    const source = this.state.source;
    let committed = false;
    try {
      fs.copyFileSync(path.join(source, 'SoftechUpdater.exe'), helperPath);
      const cockpitPid = Number(process.env.SOFTECH_COCKPIT_PID);
      const cockpitExe = process.env.SOFTECH_COCKPIT_EXE;
      const useCockpit = Number.isInteger(cockpitPid) && cockpitPid > 0 && cockpitExe && fs.existsSync(cockpitExe);
      const plan = {
        Source: source, Target: ROOT_DIR, Version: this.state.stagedVersion, Kind: 'server',
        ParentPids: useCockpit ? [process.pid, cockpitPid] : [process.pid],
        RestartExecutable: useCockpit ? cockpitExe : process.execPath,
        RestartArguments: useCockpit ? [] : ['src/server.js'],
        ReadyFile: path.join(handover, 'ready'), CommitFile: path.join(handover, 'commit'),
        CancelFile: path.join(handover, 'cancel'), HealthFile: path.join(handover, 'healthy'),
        HealthUrl: 'http://127.0.0.1:' + (process.env.PORT || 5000) + '/api/health'
      };
      fs.writeFileSync(path.join(handover, 'plan.json'), JSON.stringify(plan));
      const helper = spawn(helperPath, ['--plan', path.join(handover, 'plan.json')],
        { detached: true, windowsHide: true, stdio: 'ignore', cwd: handover });
      let spawnError;
      helper.on('error', error => { spawnError = error; });
      helper.unref();
      const deadline = Date.now() + 55000;
      while (!fs.existsSync(plan.ReadyFile)) {
        if (spawnError || helper.exitCode !== null || Date.now() > deadline || fs.existsSync(plan.ReadyFile + '.error'))
          throw new Error('Updater preparation failed; current server stays running.');
        await sleep(100);
      }
      this.idleSeconds = await this.probeIdle();
      if (!canApplyUpdate({ ...this.policy(), applying: false }))
        throw new Error('Cashier activity resumed; update postponed.');
      // No async gap between the final gate and handing off the exact processes.
      this.applying = true;
      fs.writeFileSync(plan.CommitFile, plan.Version);
      if (useCockpit) fs.writeFileSync(path.join(this.updatesDir, 'cockpit-exit.json'),
        JSON.stringify({ pid: cockpitPid, at: Date.now() }));
      committed = true;
      setTimeout(() => this.onShutdown(), 100);
      return { success: true, message: 'Silent update committed.' };
    } catch (error) {
      fs.writeFileSync(path.join(handover, 'cancel'), 'cancel');
      this.state.error = error.message;
      this.nextApplyAttempt = Date.now() + 60000;
      return { success: false, error: error.message };
    } finally { this.preparing = false; if (!committed) this.applying = false; }
  }

  static compareSemver(a, b) {
    const x = a.replace(/^v/i, '').split('.').map(Number);
    const y = b.replace(/^v/i, '').split('.').map(Number);
    for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
    return 0;
  }
  static async fetchJson(url) {
    return fetchUpdateManifest(url);
  }
  static async downloadFile(url, destination) {
    return downloadUpdateFile(url, destination, { onProgress: (bytes, total) => {
      this.state.downloadedBytes = bytes; this.state.totalBytes = total;
    } });
  }
  static async calculateSha256(file) {
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
    return hash.digest('hex');
  }
  static async extractZip(zip, target) {
    await execute(path.join(ROOT_DIR, 'SoftechUpdater.exe'), ['--extract', zip, target],
      { windowsHide: true, timeout: 120000 });
  }
}
