const wait = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function runRemoteMaintenance(action, options, { updater, progress, markRestart, sleep = wait }) {
  updater.remoteMaintenance = true;
  try {
    progress('Eng yangi release tekshirilmoqda va yuklanmoqda.');
    const deadline = Date.now() + 10 * 60000;
    while (updater.state.isChecking || updater.state.isDownloading || updater.preparing || updater.applying) {
      if (Date.now() > deadline) throw Error('Boshqa yangilanish tugashini kutish vaqti tugadi.');
      await sleep(500);
    }
    const status = await updater.checkForUpdates({remote:true});
    if (status.error) throw Error(status.error);
    if (!status.latestManifest) throw Error('Eng yangi release manzili tekshirilmadi.');
    const version = status.latestManifest.version;
    const newer = updater.compareSemver(version, updater.currentVersion) > 0;
    if (newer && (!status.isStaged || status.stagedVersion !== version))
      throw Error('Yangilanish tayyor emas yoki avvalgi urinishda xato bergan.');
    if (!newer && action === 'FORCE_UPDATE') return { complete:true, message:`Server allaqachon v${updater.currentVersion} versiyada.` };
    const delay = Math.max(0, Math.min(300, Number(options.delaySeconds) || 0));
    if (delay) { progress(`${delay} soniyadan keyin dastur qayta ochiladi.`); await sleep(delay * 1000); }
    if (action === 'RESTART_SERVER' && options.force !== true && updater.getActiveSessionsCount() !== 0)
      return { deferred:true, message:'Faol seanslar tugashi kutilmoqda.' };
    markRestart(newer ? version : updater.currentVersion);
    const result = await updater.applyUpdate({ force:true, restartOnly:!newer });
    if (!result.success) throw Error(result.error || 'Dastur qayta ochilmadi.');
    return { awaitingRestart:true };
  } finally { updater.remoteMaintenance = false; }
}
