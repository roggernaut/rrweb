/* eslint-disable camelcase -- GitHub's REST API names its fields in snake_case */
export interface IssueData {
  number: number;
  state: 'open' | 'closed';
  title: string;
  labels: string[];
  body: string;
  node_id: string;
}

export interface NewIssue {
  title: string;
  body: string;
  labels: string[];
}

export interface IssuePatch {
  title?: string;
  body?: string;
  state?: 'open' | 'closed';
  state_reason?: 'completed' | 'not_planned' | 'reopened';
  labels?: string[];
}

/** Every label the reporter creates, with its colour. Unlisted ones are grey. */
export const LABEL_COLOURS: Record<string, string> = {
  prerelease: '5319e7',
  'prerelease:functional': 'c5def5',
  'prerelease:performance': 'fbca04',
  'prerelease:recovered': '0e8a16',
  'prerelease:run-broken': 'e99695',
  'prerelease:status': 'bfdadc',
  'engine:chromium': '1d76db',
  'engine:gecko': 'e36209',
  'engine:webkit': '0075ca',
  privacy: 'b60205',
};
const DEFAULT_COLOUR = 'ededed';
const PAGE = 100;

/**
 * A small client for the issue endpoints the reporter uses. The token lives
 * in a private field and only ever goes into the Authorization header, so it
 * cannot reach a log or an error message.
 */
export class GitHub {
  #token: string | undefined;
  #api: string;
  #repo: string;
  #fetch: typeof fetch;

  constructor(
    opts: {
      token?: string;
      repository?: string;
      apiUrl?: string;
      fetch?: typeof fetch;
    } = {},
  ) {
    this.#token = opts.token ?? process.env.GITHUB_TOKEN;
    const repo = opts.repository ?? process.env.GITHUB_REPOSITORY ?? '';
    if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) {
      throw new Error('GITHUB_REPOSITORY must be set to owner/name');
    }
    this.#repo = repo;
    this.#api = (
      opts.apiUrl ??
      process.env.GITHUB_API_URL ??
      'https://api.github.com'
    ).replace(/\/+$/, '');
    this.#fetch = opts.fetch ?? fetch;
  }

  get hasToken(): boolean {
    return Boolean(this.#token);
  }

  async #request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const headers: Record<string, string> = {
      accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'rrweb-prerelease-browsers',
    };
    if (this.#token) headers.authorization = `Bearer ${this.#token}`;
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await this.#fetch(this.#api + path, {
      method,
      headers,
      ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    });
    const text = await res.text();
    if (!res.ok) {
      let detail = text.slice(0, 500);
      try {
        const parsed = JSON.parse(text) as { message?: unknown };
        if (typeof parsed.message === 'string') detail = parsed.message;
      } catch {
        // keep the raw text
      }
      throw new Error(
        `GitHub API ${method} ${path.split('?')[0]} failed: ${[
          res.status,
          res.statusText,
        ]
          .filter(Boolean)
          .join(' ')}: ${detail}`,
      );
    }
    return (text ? JSON.parse(text) : undefined) as T;
  }

  /** Every issue with `label`, open and closed, without pull requests. */
  async listIssues(label: string): Promise<IssueData[]> {
    const out: IssueData[] = [];
    for (let page = 1; ; page++) {
      const query = new URLSearchParams({
        labels: label,
        state: 'all',
        per_page: String(PAGE),
        page: String(page),
      });
      const batch = await this.#request<
        Array<{
          number: number;
          state: 'open' | 'closed';
          title: string;
          labels: Array<{ name: string } | string>;
          body: string | null;
          node_id: string;
          pull_request?: unknown;
        }>
      >('GET', `/repos/${this.#repo}/issues?${query.toString()}`);
      for (const i of batch) {
        if (i.pull_request !== undefined) continue;
        out.push({
          number: i.number,
          state: i.state,
          title: i.title,
          labels: i.labels.map((l) => (typeof l === 'string' ? l : l.name)),
          body: i.body ?? '',
          node_id: i.node_id,
        });
      }
      if (batch.length < PAGE) return out;
    }
  }

  async createIssue(
    issue: NewIssue,
  ): Promise<{ number: number; node_id: string }> {
    const r = await this.#request<{ number: number; node_id: string }>(
      'POST',
      `/repos/${this.#repo}/issues`,
      issue,
    );
    return { number: r.number, node_id: r.node_id };
  }

  async updateIssue(number: number, patch: IssuePatch): Promise<void> {
    await this.#request(
      'PATCH',
      `/repos/${this.#repo}/issues/${number}`,
      patch,
    );
  }

  async comment(number: number, body: string): Promise<void> {
    await this.#request(
      'POST',
      `/repos/${this.#repo}/issues/${number}/comments`,
      { body },
    );
  }

  /** Creates the labels that do not exist yet. Existing labels are never edited. */
  async ensureLabels(names: string[]): Promise<void> {
    const existing = new Set<string>();
    for (let page = 1; ; page++) {
      const batch = await this.#request<Array<{ name: string }>>(
        'GET',
        `/repos/${this.#repo}/labels?per_page=${PAGE}&page=${page}`,
      );
      for (const l of batch) existing.add(l.name.toLowerCase());
      if (batch.length < PAGE) break;
    }
    for (const name of [...new Set(names)]) {
      if (existing.has(name.toLowerCase())) continue;
      await this.#request('POST', `/repos/${this.#repo}/labels`, {
        name,
        color: LABEL_COLOURS[name] ?? DEFAULT_COLOUR,
      });
      existing.add(name.toLowerCase());
    }
  }

  /** Pins an issue to the repository through GraphQL, at `<api>/graphql`. */
  async pinIssue(nodeId: string): Promise<void> {
    const r = await this.#request<{ errors?: Array<{ message: string }> }>(
      'POST',
      '/graphql',
      {
        query:
          'mutation($id: ID!) { pinIssue(input: { issueId: $id }) { issue { number } } }',
        variables: { id: nodeId },
      },
    );
    if (r?.errors?.length) {
      throw new Error(
        `GitHub GraphQL pinIssue failed: ${r.errors
          .map((e) => e.message)
          .join('; ')}`,
      );
    }
  }
}
