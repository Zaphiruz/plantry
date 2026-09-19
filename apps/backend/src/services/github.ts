export interface GithubIssue {
  number: number;
  html_url: string;
}

export interface CreateIssueArgs {
  title: string;
  body: string;
  labels?: string[];
}

export interface GithubIssueState {
  state: 'open' | 'closed';
  state_reason: 'completed' | 'not_planned' | 'reopened' | null;
  closed_at: string | null;
}

export interface GithubClient {
  createIssue(args: CreateIssueArgs): Promise<GithubIssue>;
  getIssue(number: number): Promise<GithubIssueState>;
}

export function createGithubClient(opts: {
  token: string;
  owner: string;
  repo: string;
}): GithubClient {
  const base = `https://api.github.com/repos/${opts.owner}/${opts.repo}`;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  return {
    async createIssue({ title, body, labels }) {
      const res = await fetch(`${base}/issues`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ title, body, labels }),
      });
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      return res.json() as Promise<GithubIssue>;
    },
    async getIssue(number) {
      const res = await fetch(`${base}/issues/${number}`, { method: 'GET', headers });
      if (!res.ok) throw new Error(`GitHub API error: ${res.status}`);
      const j = (await res.json()) as {
        state: 'open' | 'closed';
        state_reason: 'completed' | 'not_planned' | 'reopened' | null;
        closed_at: string | null;
      };
      return { state: j.state, state_reason: j.state_reason, closed_at: j.closed_at };
    },
  };
}
