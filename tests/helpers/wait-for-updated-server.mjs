// A successful package receipt precedes the server's approval polling tick.
// Wait for both business readiness and the matching updater status, not just
// the new version reported by the restricted health endpoint.
export async function waitForUpdatedServer(url, version, readReceipt, {
  timeoutMs = 120000, pollMs = 250, requestTimeoutMs = 1500
} = {}) {
  const deadline = Date.now() + timeoutMs;
  let last = 'no response';
  while (Date.now() < deadline) {
    try {
      const healthResponse = await fetch(url + '/api/health', { signal: AbortSignal.timeout(requestTimeoutMs) });
      const health = await healthResponse.json();
      last = `health HTTP ${healthResponse.status}, version=${health.version}, pending=${health.updatePending}`;
      if (healthResponse.ok && health.app === 'NetCafeServer' && health.status === 'ok' &&
          health.version === version && health.updatePending === false) {
        const receipt = readReceipt();
        if (receipt?.version === version) {
          const response = await fetch(url + '/api/updates/status', { signal: AbortSignal.timeout(requestTimeoutMs) });
          const status = await response.json();
          last = `status HTTP ${response.status}, version=${status.currentVersion}, error=${status.error ?? 'none'}`;
          if (response.ok && status.currentVersion === version && !status.error) return status;
        } else last = 'matching update success receipt not yet available';
      }
    } catch (error) { last = error.message; }
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
  throw new Error(`Updated server ${version} did not become ready: ${last}`);
}
