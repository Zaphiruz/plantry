import cron from 'node-cron';
import type { Deps } from '../deps.js';
import { runAutoDeduct } from './auto-deduct.js';
import { runLowStockDigest } from './low-stock.js';
import { runSweeps } from './sweeps.js';

export interface JobLog { info(obj: unknown, msg?: string): void; error(obj: unknown, msg?: string): void }
const JOB = 'daily';
const STALE_CLAIM_MS = 60 * 60 * 1000;

export const shouldCatchUp = (lastRunAt: Date | null, now: Date): boolean =>
  !lastRunAt || now.getTime() - lastRunAt.getTime() > 24 * 60 * 60 * 1000;

/** Claim via an atomic row update — safe with Prisma's connection pool (session advisory locks are not). */
async function claim(deps: Deps, now: Date): Promise<boolean> {
  const stale = new Date(now.getTime() - STALE_CLAIM_MS);
  // Both conditions matter: `started_at` guards against a second claim while a run is in flight (or
  // stuck/crashed, via the staleness window); `last_run_at` guards against a second claim landing
  // *after* a concurrent run already finished and reset started_at to null for this same `now` — a
  // fast job (e.g. an empty test fixture) can complete before a racing caller's INSERT is even sent.
  const rows = await deps.prisma.$queryRaw<{ job: string }[]>`
    INSERT INTO job_runs (job, started_at) VALUES (${JOB}, ${now})
    ON CONFLICT (job) DO UPDATE SET started_at = ${now}
      WHERE (job_runs.started_at IS NULL OR job_runs.started_at < ${stale})
        AND (job_runs.last_run_at IS NULL OR job_runs.last_run_at < ${now})
    RETURNING job`;
  return rows.length === 1;
}

export async function runDaily(deps: Deps, now: Date, log: JobLog): Promise<{ ran: boolean }> {
  if (!(await claim(deps, now))) return { ran: false };
  const stage = async (name: string, fn: () => Promise<unknown>) => {
    try { log.info({ stage: name, result: await fn() }, 'daily stage done'); }
    catch (err) { log.error({ err, stage: name }, 'daily stage failed'); }
  };
  await stage('auto-deduct', () => runAutoDeduct(deps.prisma, now, (err, msg) => log.error({ err }, msg)));
  await stage('low-stock', () => runLowStockDigest(deps.prisma, deps.push, now, (err, msg) => log.error({ err }, msg)));
  await stage('sweeps', () => runSweeps(deps.prisma, deps.storage, now));
  await deps.prisma.jobRun.update({ where: { job: JOB }, data: { lastRunAt: now, startedAt: null } });
  return { ran: true };
}

/** 06:00 in the container's TZ, plus a boot catch-up if the last run is >24h old. */
export function startDailySchedule(deps: Deps, log: JobLog): { stop(): void } {
  const task = cron.schedule('0 6 * * *', () => { void runDaily(deps, new Date(), log); });
  void (async () => {
    const last = await deps.prisma.jobRun.findUnique({ where: { job: JOB } });
    if (shouldCatchUp(last?.lastRunAt ?? null, new Date())) await runDaily(deps, new Date(), log);
  })().catch((err) => log.error({ err }, 'boot catch-up failed'));
  return { stop: () => task.stop() };
}
