// Cloud/mobile initialization must not take down the local cashier. Keep the
// original data intact and retry; never report an unavailable sync as successful.
export class OptionalService {
  constructor(name, create, { retryMs = 60000, warn = console.warn } = {}) {
    Object.assign(this, { name, create, retryMs, warn });
    this.stopped = true;
    this.service = null;
  }
  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt();
  }
  attempt() {
    if (this.stopped || this.service) return;
    let candidate;
    try {
      candidate = this.create();
      candidate.start();
      this.service = candidate;
      this.lastError = null;
    } catch (error) {
      try { candidate?.stop(); } catch {}
      this.lastError = error.message;
      this.warn(`[${this.name}] Initialization failed; local cashier remains available: ${error.message}`);
      this.timer = setTimeout(() => this.attempt(), this.retryMs);
      this.timer.unref();
    }
  }
  requestSoon() { this.service?.requestSoon(); }
  async flush() { return this.service ? this.service.flush() : false; }
  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.service?.stop();
    this.service = null;
  }
}
