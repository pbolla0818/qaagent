import type { GitConfig, GitHubPR } from '../types/index.js'

interface RawPR {
    number: number
    title: string
    body: string | null
    head: { ref: string }
    updated_at: string
    state: string
}

// Max diff length we send to the LLM per PR. Diffs can be huge.
const DIFF_CHAR_CAP = 12_000

export class GitHubClient {
    private apiBase = 'https://api.github.com'
    private token: string

    constructor(config: Pick<GitConfig, 'token'>) {
        this.token = config.token
    }

    private async fetch<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
        const res = await fetch(`${this.apiBase}${path}`, {
            headers: {
                Authorization: `Bearer ${this.token}`,
                Accept: accept,
                'X-GitHub-Api-Version': '2022-11-28',
            },
        })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`GitHub ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 300)}`)
        }
        if (accept.includes('json')) return res.json() as Promise<T>
        return (await res.text()) as unknown as T
    }

    async listOpenPRs(repo: string, limit = 10, baseBranch?: string): Promise<RawPR[]> {
        const params = new URLSearchParams({
            state: 'open',
            sort: 'updated',
            direction: 'desc',
            per_page: String(limit),
            ...(baseBranch && { base: baseBranch }),
        })
        return this.fetch<RawPR[]>(`/repos/${repo}/pulls?${params}`)
    }

    // Find PRs that mention a JIRA issue key AND target a specific base branch.
    // Returns PR numbers sorted most-recently-updated first.
    async findPRsForIssue(repo: string, issueKey: string, baseBranch: string): Promise<number[]> {
        const q = [
            `repo:${repo}`,
            'is:pr',
            `base:${baseBranch}`,
            issueKey,
        ].join(' ')
        const params = new URLSearchParams({
            q,
            sort: 'updated',
            order: 'desc',
            per_page: '20',
        })
        const data = await this.fetch<{ items: Array<{ number: number }> }>(
            `/search/issues?${params}`
        )
        return data.items.map(i => i.number)
    }

    async getPR(repo: string, number: number): Promise<RawPR> {
        return this.fetch<RawPR>(`/repos/${repo}/pulls/${number}`)
    }

    async getPRDiff(repo: string, number: number): Promise<string> {
        const diff = await this.fetch<string>(
            `/repos/${repo}/pulls/${number}`,
            'application/vnd.github.v3.diff'
        )
        return diff.length > DIFF_CHAR_CAP
            ? diff.slice(0, DIFF_CHAR_CAP) + '\n\n... [diff truncated]'
            : diff
    }

    async fetchPRs(repo: string, numbers?: number[], limit = 10, baseBranch?: string): Promise<GitHubPR[]> {
        const raws = numbers && numbers.length > 0
            ? await Promise.all(numbers.map(n => this.getPR(repo, n)))
            : await this.listOpenPRs(repo, limit, baseBranch)

        const result: GitHubPR[] = []
        for (const raw of raws) {
            const diff = await this.getPRDiff(repo, raw.number)
            result.push({
                repo,
                number: raw.number,
                title: raw.title,
                branch: raw.head.ref,
                body: raw.body ?? '',
                diff,
                jiraKeys: extractJiraKeys(`${raw.title} ${raw.head.ref} ${raw.body ?? ''}`),
                updatedAt: raw.updated_at,
            })
        }
        return result
    }
}

// Matches PROJ-123 style keys.
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g

function extractJiraKeys(text: string): string[] {
    const keys = new Set<string>()
    for (const m of text.matchAll(JIRA_KEY_RE)) {
        keys.add(`${m[1]}-${m[2]}`)
    }
    return Array.from(keys)
}
