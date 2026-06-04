import { DEFAULT_DEV_STATUSES, type JiraConfig, type JiraIssue } from '../types/index.js'

interface JiraSprint {
    id: number
    name: string
    state: 'active' | 'closed' | 'future'
}

interface RawIssue {
    key: string
    fields: {
        summary: string
        description?: unknown
        status: { name: string }
        // acceptance criteria is usually a custom field — we look for it by name in renderedFields too
        [k: string]: unknown
    }
    renderedFields?: { description?: string; [k: string]: unknown }
}

export class JiraClient {
    private baseURL: string
    private auth: string

    constructor(private config: JiraConfig) {
        this.baseURL = config.baseURL.replace(/\/+$/, '')
        this.auth = 'Basic ' + Buffer.from(`${config.email}:${config.apiToken}`).toString('base64')
    }

    private async fetch<T>(path: string): Promise<T> {
        const res = await fetch(`${this.baseURL}${path}`, {
            headers: {
                Authorization: this.auth,
                Accept: 'application/json',
            },
        })
        if (!res.ok) {
            const body = await res.text().catch(() => '')
            throw new Error(`JIRA ${res.status} ${res.statusText} on ${path}: ${body.slice(0, 300)}`)
        }
        return res.json() as Promise<T>
    }

    // Resolve the active sprint(s) for a given board.
    async getActiveSprints(boardId: number): Promise<JiraSprint[]> {
        const data = await this.fetch<{ values: JiraSprint[] }>(
            `/rest/agile/1.0/board/${boardId}/sprint?state=active`
        )
        return data.values
    }

    // Fetch issues in the given sprints, narrowed by project (config) and
    // status filter. Pass an empty `statuses` array to disable the status filter.
    async getIssuesInSprints(sprintIds: number[], statuses?: readonly string[]): Promise<JiraIssue[]> {
        if (sprintIds.length === 0) return []
        const statusFilter = statuses ?? this.config.devStatuses ?? DEFAULT_DEV_STATUSES
        const jqlParts = [
            `sprint in (${sprintIds.join(',')})`,
            this.config.projectKey ? `project = "${this.config.projectKey}"` : null,
            statusFilter.length > 0
                ? `status in (${statusFilter.map(s => `"${s}"`).join(',')})`
                : null,
        ].filter(Boolean) as string[]
        const jql = jqlParts.join(' AND ')

        const params = new URLSearchParams({
            jql,
            fields: 'summary,description,status,customfield_10000',
            maxResults: '100',
            expand: 'renderedFields',
        })
        const data = await this.fetch<{ issues: RawIssue[] }>(`/rest/api/3/search?${params}`)

        return data.issues.map(i => this.normalize(i))
    }

    // Convenience: active sprint(s) for board → open dev-phase issues in those sprints.
    async getActiveSprintIssues(boardId: number, statuses?: readonly string[]): Promise<JiraIssue[]> {
        const sprints = await this.getActiveSprints(boardId)
        return this.getIssuesInSprints(sprints.map(s => s.id), statuses)
    }

    async getIssue(key: string): Promise<JiraIssue> {
        const params = new URLSearchParams({
            fields: 'summary,description,status',
            expand: 'renderedFields',
        })
        const raw = await this.fetch<RawIssue>(`/rest/api/3/issue/${key}?${params}`)
        return this.normalize(raw)
    }

    private normalize(raw: RawIssue): JiraIssue {
        // JIRA Cloud description is ADF (rich JSON) — fall back to renderedFields HTML stripped.
        const description =
            raw.renderedFields?.description
                ? stripHtml(raw.renderedFields.description)
                : adfToText(raw.fields.description)

        const acceptanceCriteria = extractAcceptanceCriteria(description)

        return {
            key: raw.key,
            summary: raw.fields.summary,
            description,
            ...(acceptanceCriteria && { acceptanceCriteria }),
            status: raw.fields.status.name,
        }
    }
}

function stripHtml(html: string): string {
    return html
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<\/p>/gi, '\n')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .trim()
}

// Minimal ADF (Atlassian Document Format) → text walker.
function adfToText(node: unknown): string {
    if (!node || typeof node !== 'object') return ''
    const n = node as { type?: string; text?: string; content?: unknown[] }
    if (typeof n.text === 'string') return n.text
    if (Array.isArray(n.content)) {
        const sep = n.type === 'paragraph' || n.type === 'heading' || n.type === 'listItem' ? '\n' : ''
        return n.content.map(adfToText).join('') + sep
    }
    return ''
}

// Heuristic: pull "Acceptance Criteria" section out of the description.
function extractAcceptanceCriteria(description: string): string | undefined {
    const match = description.match(/acceptance criteria[:\s]*\n?([\s\S]+?)(?:\n\s*\n[A-Z]|$)/i)
    return match?.[1]?.trim() || undefined
}
