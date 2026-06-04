import type { LLM } from '../llm/index.js'
import type { GeneratedGoal, JiraIssue, GitHubPR, LLMInput } from '../types/index.js'
import { PERSONA_NAMES } from '../personas/index.js'

const SYSTEM_PROMPT = `You are a senior QA analyst. You are given a JIRA issue and a GitHub pull request diff that implements it.

Your job: produce a short list of concrete end-to-end test goals an autonomous browser agent can attempt. Each goal must be:
- A single user-facing flow (one happy path or one edge case per goal)
- Phrased as an imperative the agent can attempt, e.g. "Sign up with a valid email and verify the welcome screen loads"
- Tied to the *changed* behavior in the diff, not unrelated parts of the app
- Paired with the persona most likely to surface bugs in that flow

Available personas (use exactly these keys):
${PERSONA_NAMES.join(', ')}

Pick personas deliberately:
- "first-timer" for new-user onboarding flows
- "impatient" for forms with multiple steps or loading
- "power-user" for edge cases, advanced features, keyboard flows
- "adversarial" for any auth, input, or boundary-touching change
- "non-native" when copy or labels changed
- "slow-network" when loading/async changed

Constraints:
- Produce 1–4 goals per issue. Fewer is better.
- Do NOT invent flows that aren't supported by the diff or the issue description.
- If the diff is purely backend/infra/test/docs with no user-facing change, return an empty goals array.

You must respond with valid JSON only. No prose outside JSON.

{
  "goals": [
    {
      "goal": "imperative test goal sentence",
      "persona": "one of the persona keys above",
      "reasoning": "one sentence why this persona for this goal"
    }
  ]
}`

interface GeneratorOutput {
    goals: Array<{ goal: string; persona: string; reasoning?: string }>
}

export interface GoalGeneratorInput {
    issue?: JiraIssue
    pr: GitHubPR
    baseURL: string   // app URL to test against (from git.baseURL in config)
}

export async function generateGoals(
    llm: LLM,
    inputs: GoalGeneratorInput[],
): Promise<GeneratedGoal[]> {
    const results: GeneratedGoal[] = []

    for (const input of inputs) {
        const llmInput = buildPrompt(input)
        let raw: string
        try {
            raw = (await llm.complete(llmInput)).content
        } catch (err) {
            console.warn(`👾 goal generation failed for PR #${input.pr.number}: ${err}`)
            continue
        }

        const parsed = parseGoals(raw)
        if (!parsed) {
            console.warn(`👾 unparseable goal response for PR #${input.pr.number}`)
            continue
        }

        for (const g of parsed.goals) {
            if (!PERSONA_NAMES.includes(g.persona as typeof PERSONA_NAMES[number])) {
                console.warn(`👾 PR #${input.pr.number}: ignoring unknown persona "${g.persona}"`)
                continue
            }
            results.push({
                url: input.baseURL,
                goal: g.goal,
                persona: g.persona,
                source: {
                    ...(input.issue && { jiraKey: input.issue.key }),
                    prNumber: input.pr.number,
                },
            })
        }
    }

    return results
}

function buildPrompt(input: GoalGeneratorInput): LLMInput {
    const issueBlock = input.issue ? [
        `JIRA ${input.issue.key}: ${input.issue.summary}`,
        `Status: ${input.issue.status}`,
        '',
        'Description:',
        input.issue.description || '(none)',
        input.issue.acceptanceCriteria ? `\nAcceptance Criteria:\n${input.issue.acceptanceCriteria}` : '',
    ].filter(Boolean).join('\n') : 'No linked JIRA issue.'

    const prBlock = [
        `PR #${input.pr.number}: ${input.pr.title}`,
        `Branch: ${input.pr.branch}`,
        '',
        'PR body:',
        input.pr.body || '(empty)',
        '',
        'Diff:',
        input.pr.diff,
    ].join('\n')

    return {
        system: SYSTEM_PROMPT,
        messages: [{
            role: 'user',
            content: [issueBlock, '', '── PR ──', prBlock].join('\n')
        }],
    }
}

function parseGoals(raw: string): GeneratorOutput | null {
    const cleaned = raw
        .replace(/^```(?:json)?\n?/m, '')
        .replace(/\n?```$/m, '')
        .trim()
    try {
        const parsed = JSON.parse(cleaned) as GeneratorOutput
        if (!Array.isArray(parsed.goals)) return null
        return parsed
    } catch {
        return null
    }
}
