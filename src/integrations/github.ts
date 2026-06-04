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

    constructor(private config: GitConfig) {}

    private async fetch<T>(path: string, accept = 'application/vnd.github+json'): Promise<T> {
        const res = await fetch(`${this.apiBase}${path}`, {
            headers: {
                Authorization: `Bearer ${this.config.token}`,
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

    async listOpenPRs(limit = 10, baseBranch?: string): Promise<RawPR[]> {
        const params = new URLSearchParams({
            state: 'open',
            sort: 'updated',
            direction: 'desc',
            per_page: String(limit),
            ...(baseBranch && { base: baseBranch }),
        })
        return this.fetch<RawPR[]>(`/repos/${this.config.repo}/pulls?${params}`)
    }

    // Find PRs that mention a JIRA issue key AND target a specific base branch.
    // Returns sorted most-recently-updated first.
    async findPRsForIssue(issueKey: string, baseBranch: string): Promise<number[]> {
        const q = [
            `repo:${this.config.repo}`,
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

    async getPR(number: number): Promise<RawPR> {
        return this.fetch<RawPR>(`/repos/${this.config.repo}/pulls/${number}`)
    }

    async getPRDiff(number: number): Promise<string> {
        const diff = await this.fetch<string>(
            `/repos/${this.config.repo}/pulls/${number}`,
            'application/vnd.github.v3.diff'
        )
        return diff.length > DIFF_CHAR_CAP
            ? diff.slice(0, DIFF_CHAR_CAP) + '\n\n... [diff truncated]'
            : diff
    }

    async fetchPRs(numbers?: number[], limit = 10, baseBranch?: string): Promise<GitHubPR[]> {
        const raws = numbers && numbers.length > 0
            ? await Promise.all(numbers.map(n => this.getPR(n)))
            : await this.listOpenPRs(limit, baseBranch)

        const result: GitHubPR[] = []
        for (const raw of raws) {
            const diff = await this.getPRDiff(raw.number)
            result.push({
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

// Matches PROJ-123 style keys. Captures uppercase project prefix.
const JIRA_KEY_RE = /\b([A-Z][A-Z0-9]+)-(\d+)\b/g

function extractJiraKeys(text: string): string[] {
    const keys = new Set<string>()
    for (const m of text.matchAll(JIRA_KEY_RE)) {
        keys.add(`${m[1]}-${m[2]}`)
    }
    return Array.from(keys)
}
