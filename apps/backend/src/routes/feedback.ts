import type { FastifyInstance } from 'fastify';
import type { FeedbackSubmission } from '@prisma/client';
import { feedbackSchema, type FeedbackDto } from '@plantry/shared';
import type { Deps } from '../deps.js';
import { AppError, parse } from '../errors.js';
import type { GithubClient } from '../services/github.js';

const DAILY_LIMIT = 5;
const DAY_MS = 24 * 60 * 60 * 1000;
const RECHECK_MS = 60 * 60 * 1000;

function toDto(r: FeedbackSubmission): FeedbackDto {
  const status = r.state !== 'closed' ? 'open' : r.stateReason === 'completed' ? 'done' : 'closed';
  return {
    id: r.id, issueNumber: r.issueNumber, issueUrl: r.issueUrl, title: r.title, createdAt: r.createdAt.toISOString(),
    status, closedAt: status === 'open' ? null : r.closedAt?.toISOString() ?? null,
  };
}

export function registerFeedbackRoutes(app: FastifyInstance, deps: Deps & { github: GithubClient }): void {
  const auth = { preHandler: app.requireAuth };

  app.post('/api/feedback', auth, async (req, reply) => {
    const b = parse(feedbackSchema, req.body);
    const user = req.user!;
    const recent = await deps.prisma.feedbackSubmission.count({
      where: { userSub: user.sub, createdAt: { gte: new Date(Date.now() - DAY_MS) } },
    });
    if (recent >= DAILY_LIMIT) throw new AppError(429, 'rate_limited', 'Too many submissions — try again tomorrow');

    const title = b.body.length > 60 ? `${b.body.slice(0, 57)}…` : b.body;
    const issue = await deps.github.createIssue({
      title,
      body: [b.body, '', '---', `Submitted by **${user.name}** (sub: ${user.sub})`, ...(b.pageUrl ? [`Page: ${b.pageUrl}`] : [])].join('\n'),
      labels: ['feedback', 'user-submitted'],
    });
    const row = await deps.prisma.feedbackSubmission.create({
      data: { userSub: user.sub, issueNumber: issue.number, issueUrl: issue.html_url, title },
    });
    return reply.code(201).send({ data: { issueNumber: row.issueNumber, issueUrl: row.issueUrl } });
  });

  app.get('/api/feedback/mine', auth, async (req) => {
    const rows = await deps.prisma.feedbackSubmission.findMany({ where: { userSub: req.user!.sub }, orderBy: { createdAt: 'desc' } });
    const stale = rows.filter((r) => r.state !== 'closed' && (!r.stateFetchedAt || Date.now() - r.stateFetchedAt.getTime() > RECHECK_MS));
    const results = await Promise.allSettled(stale.map((r) => deps.github.getIssue(r.issueNumber)));
    for (const [i, result] of results.entries()) {
      const row = stale[i]!;
      if (result.status === 'rejected') { req.log.warn({ err: result.reason, issueNumber: row.issueNumber }, 'feedback state refresh failed'); continue; }
      const patch = {
        state: result.value.state, stateReason: result.value.state_reason,
        closedAt: result.value.closed_at ? new Date(result.value.closed_at) : null, stateFetchedAt: new Date(),
      };
      await deps.prisma.feedbackSubmission.update({ where: { id: row.id }, data: patch });
      Object.assign(row, patch);
    }
    return { data: rows.map(toDto) };
  });
}
