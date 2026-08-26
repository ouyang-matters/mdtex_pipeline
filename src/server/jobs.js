import { randomUUID } from 'crypto';

/**
 * Job manager for long-running backend work (WeChat compilation, PDF builds,
 * AI runs).
 *
 * Every job:
 *   - streams progress events to any number of Server-Sent Events subscribers
 *   - keeps a replayable event log so a client that connects late sees the
 *     whole story rather than joining mid-build
 *   - can be cancelled through an AbortController
 *
 * This is what lets the UI show "Rendering formulas 18/42" and offer a Cancel
 * button instead of appearing frozen.
 */

export const JobStatus = {
  QUEUED: 'queued',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  CANCELLED: 'cancelled',
};

const TERMINAL = new Set([JobStatus.SUCCEEDED, JobStatus.FAILED, JobStatus.CANCELLED]);

export class JobManager {
  constructor({ retain = 40, retainMs = 30 * 60 * 1000 } = {}) {
    this.jobs = new Map();
    this.retain = retain;
    this.retainMs = retainMs;
  }

  /**
   * Start a job. `run` receives ({ signal, progress, log }) and its resolved
   * value becomes the job result.
   */
  start(type, run, { label = '', meta = {} } = {}) {
    const id = randomUUID();
    const controller = new AbortController();

    const job = {
      id,
      type,
      label,
      meta,
      status: JobStatus.QUEUED,
      events: [],
      result: null,
      error: null,
      createdAt: Date.now(),
      startedAt: null,
      finishedAt: null,
      subscribers: new Set(),
      controller,
      _seq: 0,
    };
    this.jobs.set(id, job);
    this._prune();

    const emit = (event) => {
      const enriched = { ...event, seq: ++job._seq, at: Date.now() };
      job.events.push(enriched);
      // Bound the log so a chatty LaTeX build cannot grow without limit.
      if (job.events.length > 4000) job.events.splice(0, job.events.length - 3000);
      for (const send of job.subscribers) {
        try { send(enriched); } catch { /* subscriber went away */ }
      }
    };

    const api = {
      signal: controller.signal,
      progress: (payload) => emit({ kind: 'progress', ...payload }),
      log: (line, level = 'info') => emit({ kind: 'log', level, message: String(line) }),
    };

    job.status = JobStatus.RUNNING;
    job.startedAt = Date.now();
    emit({ kind: 'status', status: JobStatus.RUNNING });

    Promise.resolve()
      .then(() => run(api))
      .then((result) => {
        if (controller.signal.aborted) {
          job.status = JobStatus.CANCELLED;
          job.error = 'Cancelled.';
        } else {
          job.status = JobStatus.SUCCEEDED;
          job.result = result ?? null;
        }
      })
      .catch((err) => {
        if (err?.name === 'AbortError' || controller.signal.aborted) {
          job.status = JobStatus.CANCELLED;
          job.error = 'Cancelled.';
        } else {
          job.status = JobStatus.FAILED;
          job.error = err?.message || String(err);
        }
      })
      .finally(() => {
        job.finishedAt = Date.now();
        emit({ kind: 'status', status: job.status, error: job.error });
        emit({ kind: 'done', status: job.status });
        for (const send of job.subscribers) {
          try { send(null); } catch { /* subscriber went away */ }
        }
        job.subscribers.clear();
      });

    return job;
  }

  get(id) { return this.jobs.get(id) || null; }

  cancel(id) {
    const job = this.jobs.get(id);
    if (!job) return false;
    if (TERMINAL.has(job.status)) return false;
    job.controller.abort();
    return true;
  }

  /** Subscribe to a job's events; replays everything emitted so far. */
  subscribe(id, send) {
    const job = this.jobs.get(id);
    if (!job) return null;

    for (const event of job.events) {
      try { send(event); } catch { return null; }
    }

    if (TERMINAL.has(job.status)) {
      try { send(null); } catch { /* closed */ }
      return () => {};
    }

    job.subscribers.add(send);
    return () => job.subscribers.delete(send);
  }

  /** Public view of a job, without internal machinery. */
  describe(id) {
    const job = this.jobs.get(id);
    if (!job) return null;
    return {
      id: job.id,
      type: job.type,
      label: job.label,
      meta: job.meta,
      status: job.status,
      result: job.result,
      error: job.error,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      durationMs: job.finishedAt ? job.finishedAt - job.startedAt : Date.now() - (job.startedAt || job.createdAt),
      events: job.events,
    };
  }

  list() {
    return [...this.jobs.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(j => ({ id: j.id, type: j.type, label: j.label, status: j.status, createdAt: j.createdAt }));
  }

  /** Cancel everything still running — used on shutdown. */
  cancelAll() {
    for (const job of this.jobs.values()) {
      if (!TERMINAL.has(job.status)) job.controller.abort();
    }
  }

  _prune() {
    const finished = [...this.jobs.values()]
      .filter(j => TERMINAL.has(j.status))
      .sort((a, b) => (a.finishedAt || 0) - (b.finishedAt || 0));

    const now = Date.now();
    for (const job of finished) {
      const tooOld = job.finishedAt && now - job.finishedAt > this.retainMs;
      const tooMany = this.jobs.size > this.retain;
      if (tooOld || tooMany) this.jobs.delete(job.id);
      else break;
    }
  }
}
