import { Command } from 'commander'
import ora from 'ora'
import chalk from 'chalk'

import { Orchestrator } from '../../core/orchestrator.js'
import { LLM } from '../../llm/index.js'
import { loadPersonas } from '../../personas/loader.js'
import { resolvePersona } from '../../personas/index.js'
import { getConfig } from '../../lib/getConfigs.js'
import { agentDone, agentStarted, printFinding, printHeader, printSummary } from '../../lib/display.js'
import { generateReport, saveReport } from '../../core/reporter.js'
import { JiraClient } from '../../integrations/jira.js'
import { GitHubClient } from '../../integrations/github.js'
import { generateGoals, type GoalGeneratorInput } from '../../core/goalGenerator.js'
import type { GeneratedGoal, JiraIssue, GitHubPR, PersonaConfig } from '../../types/index.js'

interface GenerateOptions {
    sprint?: string   // 'active'
    pr?: string   // '' (no value) or comma-separated numbers
    board?: string   // overrides jira.boardId
    releaseBranch?: string   // overrides git.releaseBranch
    limit?: string   // for --pr without numbers
    steps?: string
    concurrency?: string
    headed?: boolean
    roundRobin?: boolean
    dryRun?: boolean
}

export const generateCommand = new Command('generate')
    .description('Generate test cases from JIRA active sprint and/or GitHub PRs, then run them')
    .option('--sprint <state>', 'Pull issues from sprint (only "active" supported)')
    .option('--pr [numbers]', 'PR numbers (comma-separated). Omit value to use latest open PRs')
    .option('--board <id>', 'JIRA board id (overrides jira.boardId in config)')
    .option('--release-branch <name>', 'Release branch to scope PRs against (overrides git.releaseBranch)')
    .option('--limit <n>', 'How many latest PRs to fetch when --pr has no value', '10')
    .option('--steps <n>', 'Max steps per agent', '25')
    .option('--concurrency <n>', 'Agents running in parallel', '2')
    .option('--headed', 'Run browser in headed mode')
    .option('--round-robin', 'Spread LLM load across configured providers')
    .option('--dry-run', 'Print generated goals and exit without running browser')
    .action(async (options: GenerateOptions) => {
        const config = getConfig()

        if (!options.sprint && options.pr === undefined) {
            console.error(chalk.red('  ✗ Must provide --sprint active or --pr [numbers]'))
            process.exit(1)
        }
        if (options.sprint && options.sprint !== 'active') {
            console.error(chalk.red(`  ✗ --sprint only supports "active", got "${options.sprint}"`))
            process.exit(1)
        }
        if (!config.git) {
            console.error(chalk.red('  ✗ GitHub not configured. Run qaagent setup.'))
            process.exit(1)
        }
        if (options.sprint && !config.jira) {
            console.error(chalk.red('  ✗ JIRA not configured. Run qaagent setup.'))
            process.exit(1)
        }

        const llm = LLM.fromConfig(config.llm, !!options.roundRobin)
        const github = new GitHubClient(config.git)
        const jira = config.jira ? new JiraClient(config.jira) : null

        // 1. fetch JIRA issues (if --sprint active)
        let issues: JiraIssue[] = []
        if (options.sprint === 'active' && jira) {
            const boardId = options.board ? parseInt(options.board, 10) : config.jira?.boardId
            if (!boardId) {
                console.error(chalk.red('  ✗ Board id required: pass --board <id> or set jira.boardId in config'))
                process.exit(1)
            }
            const spinner = ora({ text: chalk.gray(`fetching active sprint for board ${boardId}...`), spinner: 'dots' }).start()
            try {
                issues = await jira.getActiveSprintIssues(boardId)
                spinner.stopAndPersist({ symbol: '📋', text: chalk.gray(`${issues.length} active-sprint issue(s) fetched`) })
            } catch (err) {
                spinner.fail(chalk.red(`JIRA fetch failed: ${err}`))
                process.exit(1)
            }
        }

        // 2. fetch PRs — semantics depend on mode
        const releaseBranch = options.releaseBranch ?? config.git.releaseBranch
        const explicitNumbers = typeof options.pr === 'string' && options.pr.length > 0
            ? options.pr.split(',').map(s => parseInt(s.trim(), 10)).filter(n => Number.isFinite(n))
            : undefined

        const prSpinner = ora({ text: chalk.gray('fetching PRs...'), spinner: 'dots' }).start()
        let prs: GitHubPR[] = []
        try {
            if (options.sprint === 'active' && !explicitNumbers) {
                // Per-issue lookup: find the latest PR per issue that targets the release branch.
                if (!releaseBranch) {
                    prSpinner.fail(chalk.red('Release branch required in --sprint active mode: pass --release-branch or set git.releaseBranch in config'))
                    process.exit(1)
                }
                const numbers = new Set<number>()
                for (const issue of issues) {
                    const found = await github.findPRsForIssue(issue.key, releaseBranch)
                    if (found.length > 0) numbers.add(found[0]!)   // latest first
                }
                prs = numbers.size > 0
                    ? await github.fetchPRs(Array.from(numbers))
                    : []
            } else {
                // PR-driven: explicit numbers, or latest N open PRs (optionally narrowed to release branch).
                prs = await github.fetchPRs(
                    explicitNumbers,
                    parseInt(options.limit ?? '10', 10),
                    releaseBranch,
                )
            }
            prSpinner.stopAndPersist({ symbol: '🔀', text: chalk.gray(`${prs.length} PR(s) fetched${releaseBranch ? ` (base: ${releaseBranch})` : ''}`) })
        } catch (err) {
            prSpinner.fail(chalk.red(`GitHub fetch failed: ${err}`))
            process.exit(1)
        }

        // 3. correlate issues ↔ PRs and build generator inputs
        const generatorInputs = buildGeneratorInputs(prs, issues, options.sprint === 'active', config.git.baseURL ?? '')
        if (generatorInputs.length === 0) {
            console.log(chalk.yellow('\n  ⚠ No issue/PR pairs to generate from. Exiting.'))
            return
        }

        // 4. generate goals
        const genSpinner = ora({ text: chalk.gray(`generating goals from ${generatorInputs.length} input(s)...`), spinner: 'dots' }).start()
        const goals = await generateGoals(llm, generatorInputs)
        genSpinner.stopAndPersist({ symbol: '🎯', text: chalk.gray(`${goals.length} goal(s) generated`) })

        if (goals.length === 0) {
            console.log(chalk.yellow('  ⚠ No goals produced. Exiting.'))
            return
        }

        printGoals(goals)

        if (options.dryRun) return

        // 5. run goals through the Orchestrator (one persona per goal)
        const personas = await loadPersonas()
        await runGoals(goals, personas, llm, options)
    })

function buildGeneratorInputs(
    prs: GitHubPR[],
    issues: JiraIssue[],
    sprintMode: boolean,
    baseURL: string,
): GoalGeneratorInput[] {
    const issueByKey = new Map(issues.map(i => [i.key, i]))
    const inputs: GoalGeneratorInput[] = []

    for (const pr of prs) {
        const matchedIssue = pr.jiraKeys.map(k => issueByKey.get(k)).find(Boolean)

        // In --sprint active mode, only PRs linked to an active-sprint issue are tested
        if (sprintMode && !matchedIssue) continue

        inputs.push({
            pr,
            ...(matchedIssue && { issue: matchedIssue }),
            baseURL,
        })
    }
    return inputs
}

function printGoals(goals: GeneratedGoal[]): void {
    console.log()
    for (const g of goals) {
        const src = [
            g.source.jiraKey ? chalk.cyan(g.source.jiraKey) : null,
            g.source.prNumber ? chalk.magenta(`#${g.source.prNumber}`) : null,
        ].filter(Boolean).join(' ')
        console.log(`  ${chalk.gray('•')} ${chalk.white(g.goal)}`)
        console.log(`    ${chalk.gray('persona:')} ${g.persona}  ${chalk.gray('source:')} ${src}`)
    }
    console.log()
}

async function runGoals(
    goals: GeneratedGoal[],
    allPersonas: PersonaConfig[],
    llm: LLM,
    options: GenerateOptions,
): Promise<void> {
    // Group by goal so each invocation runs one persona against one goal
    const allResults = []
    for (const g of goals) {
        const persona = resolveOrFallback(g.persona, allPersonas)

        printHeader(g.url, g.goal, [persona.name])

        const orchestrator = new Orchestrator({
            url: g.url,
            goal: g.goal,
            llm,
            personas: [persona],
            maxSteps: parseInt(options.steps ?? '25', 10),
            concurrency: parseInt(options.concurrency ?? '2', 10),
            headless: !options.headed,
            onAgentStart: (name) => agentStarted(name),
            onAgentDone: (result) => {
                agentDone(result)
                result.findings.forEach(f => printFinding(f, result.persona))
            },
        })
        const results = await orchestrator.run()
        allResults.push(...results)
    }

    printSummary(allResults)

    const reportSpinner = ora({ text: chalk.gray('generating report...'), spinner: 'dots' }).start()
    const { title, report } = await generateReport(allResults, 'multi-goal run', 'generated from JIRA/PRs', llm)
    const filepath = saveReport(title, report)
    reportSpinner.stopAndPersist({ symbol: '📋', text: chalk.gray('report saved → ') + chalk.white(filepath) })
}

function resolveOrFallback(key: string, all: PersonaConfig[]): PersonaConfig {
    try {
        return resolvePersona(key)
    } catch {
        // fall back to first-timer if the generator returned an unknown key past validation
        return all[0]!
    }
}
