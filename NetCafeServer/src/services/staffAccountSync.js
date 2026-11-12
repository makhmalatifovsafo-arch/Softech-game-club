import { applyManagerAccount, applyAdministratorAccount, getManagerRevision, getAdministratorRevision } from './localOwnerSetup.js';
import { cloudFetch } from './cloudIpv4.js';

export function createStaffAccountSync({ db, getLicense, getSignedLicense, getCloudUrl, fetcher = cloudFetch }) {
  let inFlight;
  return function sync() {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      const license = getLicense();
      if (!license) return { success: false };
      try {
        const response = await fetcher(getCloudUrl() + '/api/telemetry/staff-accounts', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clubId: license.clubId, signedLicense: getSignedLicense(),
            managerRevision: getManagerRevision(db, license.clubId), administratorRevision: getAdministratorRevision(db, license.clubId) }),
          signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) throw new Error('Akkaunt sinxronlash: HTTP ' + response.status);
        const result = await response.json();
        if (!result.success) throw new Error('Akkaunt sinxronlash javobi yaroqsiz.');
        let success = Object.keys(result.errors || {}).length === 0;
        for (const [key, apply] of [['managerAccount', applyManagerAccount], ['administratorAccount', applyAdministratorAccount]]) {
          if (!result[key]) continue;
          try { apply(db, result[key], license); }
          catch (error) { success = false; console.warn('[Staff sync]', error.message); }
        }
        return { success };
      } catch (error) {
        console.warn('[Staff sync]', error.message);
        return { success: false };
      }
    })().finally(() => { inFlight = null; });
    return inFlight;
  };
}
