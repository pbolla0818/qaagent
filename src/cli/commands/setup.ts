import { Command } from 'commander'
import { select, input, password, confirm, number } from '@inquirer/prompts'
import type {
    ProviderConfig,
    ProviderName,
    QaagentConfig,
    JiraConfig,
    GitConfig,
    RepoConfig,
} from '../../types/index.js'
import {
    DEFAULT_INTAKE_ISSUE_TYPE,
    DEFAULT_INTAKE_LABELS,
    DEFAULT_INTAKE_SEVERITIES,
} from '../../types/index.js'
import { saveConfig, CONFIG_PATH } from '../../lib/getConfigs.js'

const DEFAULT_MODELS: Record<ProviderName, string> = {
    groq: 'llama-3.3-70b-versatile',
    openai: 'gpt-4o-mini',
    gemini: 'gemini-2.5-flash',
    anthropic: 'claude-haiku-4-5-20251001',
    openrouter: 'meta-llama/llama-3.3-70b-instruct:free',
    ollama: 'llama3.2',
    cerebras: 'gpt-oss-120b',
    mistral: 'mistral-medium-3-5',
    'azure-foundry': 'gpt-4o-mini',
    bedrock: 'anthropic.claude-haiku-4-5-20251001-v1:0',
}

async function setupProvider(label: string): Promise<ProviderConfig> {
    const provider = await select<ProviderName>({
        message: `Select ${label} provider`,
        choices: [
            { name: 'Groq', value: 'groq' },
            { name: 'Gemini', value: 'gemini' },
            { name: 'Cerebras', value: 'cerebras' },
            { name: 'Mistral', value: 'mistral' },
            { name: 'OpenRouter', value: 'openrouter' },
            { name: 'Ollama', value: 'ollama' },
            { name: 'OpenAI', value: 'openai' },
            { name: 'Anthropic', value: 'anthropic' },
            { name: 'Azure AI Foundry', value: 'azure-foundry' },
            { name: 'AWS Bedrock', value: 'bedrock' },
        ]
    })

    const config: ProviderConfig = { provider }

    if (provider === 'ollama') {
        console.log('  ✓ Ollama runs locally — no API key needed')
    } else if (provider === 'bedrock') {
        config.region = await input({
            message: 'AWS region:',
            default: 'us-east-1',
        })
        config.awsAccessKeyId = await password({
            message: 'AWS access key id:',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })
        config.awsSecretAccessKey = await password({
            message: 'AWS secret access key:',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })
        const wantsSession = await confirm({ message: 'Use temporary credentials (session token)?', default: false })
        if (wantsSession) {
            config.awsSessionToken = await password({
                message: 'AWS session token:',
                validate: v => v.trim().length > 0 ? true : 'cannot be empty'
            })
        }
    } else if (provider === 'azure-foundry') {
        config.baseURL = await input({
            message: 'Foundry endpoint (e.g. https://<resource>.services.ai.azure.com/openai/v1):',
            validate: v => v.startsWith('https://') ? true : 'must start with https://'
        })
        config.apiKey = await password({
            message: 'Foundry api key:',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })
    } else {
        config.apiKey = await password({
            message: `Enter your ${provider} API key:`,
            validate: v => v.trim().length > 0 ? true : 'API key cannot be empty'
        })
    }

    const defaultModel = DEFAULT_MODELS[provider]
    const customModel = await input({
        message: `Model to use (press enter for default: ${defaultModel}):`,
    })
    if (customModel.trim().length > 0) config.model = customModel.trim()

    return config
}

async function setupJira(): Promise<JiraConfig | undefined> {
    const wantsJira = await confirm({
        message: 'Configure JIRA Cloud (required for `qaagent generate --sprint active`)?',
        default: true,
    })
    if (!wantsJira) return undefined

    const baseURL = await input({
        message: 'JIRA Cloud base URL (e.g. https://yourco.atlassian.net):',
        validate: v => v.startsWith('https://') ? true : 'must start with https://'
    })
    const email = await input({
        message: 'JIRA account email:',
        validate: v => v.includes('@') ? true : 'must be a valid email'
    })
    const apiToken = await password({
        message: 'JIRA API token (id.atlassian.com/manage-profile/security/api-tokens):',
        validate: v => v.trim().length > 0 ? true : 'cannot be empty'
    })
    const projectKey = await input({
        message: 'Default JIRA project key (source — where sprint issues live, e.g. ENG):',
    })
    const boardId = await number({
        message: 'Default board id for --sprint active (optional):',
    })

    // Bug intake — separate project where qaagent files the bugs it finds
    const wantsIntake = await confirm({
        message: 'Configure a separate JIRA project to file agent-discovered bugs into?',
        default: true,
    })

    let intakeProjectKey: string | undefined
    let intakeIssueType: string | undefined
    let intakeLabels: string[] | undefined
    let intakeSeverities: Array<'critical' | 'warning' | 'info'> | undefined

    if (wantsIntake) {
        intakeProjectKey = (await input({
            message: 'Bug intake project key (e.g. QABUGS):',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })).trim()

        const customIssueType = await input({
            message: `Issue type for filed bugs (press enter for "${DEFAULT_INTAKE_ISSUE_TYPE}"):`,
        })
        intakeIssueType = customIssueType.trim() || DEFAULT_INTAKE_ISSUE_TYPE

        const labelsRaw = await input({
            message: `Comma-separated labels to apply to every filed bug (press enter for "${DEFAULT_INTAKE_LABELS.join(',')}"):`,
        })
        intakeLabels = labelsRaw.trim()
            ? labelsRaw.split(',').map(s => s.trim()).filter(Boolean)
            : [...DEFAULT_INTAKE_LABELS]

        const severities = await select<Array<'critical' | 'warning' | 'info'>>({
            message: 'Which severities should be filed as bugs?',
            choices: [
                { name: 'Critical only (recommended — avoids noise)', value: ['critical'] },
                { name: 'Critical + Warning', value: ['critical', 'warning'] },
                { name: 'All (Critical + Warning + Info)', value: ['critical', 'warning', 'info'] },
            ],
            default: [...DEFAULT_INTAKE_SEVERITIES],
        })
        intakeSeverities = severities
    }

    return {
        baseURL: baseURL.replace(/\/+$/, ''),
        email,
        apiToken,
        ...(projectKey.trim().length > 0 && { projectKey: projectKey.trim() }),
        ...(typeof boardId === 'number' && { boardId }),
        ...(intakeProjectKey && { intakeProjectKey }),
        ...(intakeIssueType && { intakeIssueType }),
        ...(intakeLabels && { intakeLabels }),
        ...(intakeSeverities && { intakeSeverities }),
    }
}

async function setupRepo(label: string, defaults: { baseURL?: string; releaseBranch?: string }): Promise<RepoConfig> {
    const name = await input({
        message: `${label} — repo (owner/name):`,
        validate: v => /^[^/]+\/[^/]+$/.test(v) ? true : 'must be in owner/name format'
    })
    const baseURL = await input({
        message: `${label} — app URL to test against (leave blank for backend/no-UI repos):`,
        default: defaults.baseURL ?? '',
    })
    const releaseBranch = await input({
        message: `${label} — release branch to scope PRs against:`,
        default: defaults.releaseBranch ?? 'main',
    })
    return {
        name,
        ...(baseURL.trim().length > 0 && { baseURL: baseURL.trim() }),
        ...(releaseBranch.trim().length > 0 && { releaseBranch: releaseBranch.trim() }),
    }
}

async function setupGit(): Promise<GitConfig | undefined> {
    const wantsGit = await confirm({
        message: 'Configure GitHub (required for PR-driven test generation)?',
        default: true,
    })
    if (!wantsGit) return undefined

    const token = await password({
        message: 'GitHub personal access token (repo scope):',
        validate: v => v.trim().length > 0 ? true : 'cannot be empty'
    })

    const mode = await select<'single' | 'multi'>({
        message: 'Single repo or multiple repos under one project?',
        choices: [
            { name: 'Single repo', value: 'single' },
            { name: 'Multiple repos (frontend + backend + mobile etc.)', value: 'multi' },
        ],
    })

    if (mode === 'single') {
        const repo = await input({
            message: 'Repo (owner/name):',
            validate: v => /^[^/]+\/[^/]+$/.test(v) ? true : 'must be in owner/name format'
        })
        const baseURL = await input({
            message: 'App URL to test against (e.g. https://staging.yourapp.com):',
            validate: v => v.startsWith('http') ? true : 'must start with http:// or https://'
        })
        const releaseBranch = await input({
            message: 'Release branch to scope PRs against (e.g. release/2026.07, main):',
            default: 'main',
        })
        return {
            host: 'github',
            token,
            repo,
            baseURL,
            ...(releaseBranch.trim().length > 0 && { releaseBranch: releaseBranch.trim() }),
        }
    }

    // multi-repo
    console.log('\n  Add repos one by one. Press N when done.\n')

    const defaultBaseURL = await input({
        message: 'Default app URL for repos (used when a repo omits its own):',
        default: '',
    })
    const defaultReleaseBranch = await input({
        message: 'Default release branch for repos (used when a repo omits its own):',
        default: 'main',
    })

    const repos: RepoConfig[] = []
    let addMore = true
    while (addMore) {
        const repo = await setupRepo(`repo #${repos.length + 1}`, {
            ...(defaultBaseURL && { baseURL: defaultBaseURL }),
            ...(defaultReleaseBranch && { releaseBranch: defaultReleaseBranch }),
        })
        repos.push(repo)
        addMore = await confirm({ message: 'Add another repo?', default: false })
    }

    return {
        host: 'github',
        token,
        repos,
        ...(defaultBaseURL.trim().length > 0 && { baseURL: defaultBaseURL.trim() }),
        ...(defaultReleaseBranch.trim().length > 0 && { releaseBranch: defaultReleaseBranch.trim() }),
    }
}

export const setupCommand = new Command('setup')
    .description('Configure LLM providers, JIRA, and GitHub')
    .action(async () => {
        console.log('\n  👾 qaagent setup\n')

        // LLM
        const primary = await setupProvider('primary LLM')

        const wantsFallback = await confirm({ message: 'Add a fallback provider?', default: false })
        const fallback = wantsFallback ? await setupProvider('fallback LLM') : undefined

        const wantsRoundRobin = await confirm({
            message: 'Add round-robin providers to spread load across multiple providers?',
            default: false,
        })

        const roundRobin: ProviderConfig[] = []
        if (wantsRoundRobin) {
            console.log('\n  Add providers one by one. Press N when done.\n')
            let addMore = true
            while (addMore) {
                const provider = await setupProvider(`round-robin #${roundRobin.length + 1}`)
                roundRobin.push(provider)
                addMore = await confirm({ message: 'Add another provider?', default: false })
            }
        }

        // JIRA + GitHub
        const jira = await setupJira()
        const git = await setupGit()

        const config: QaagentConfig = {
            llm: {
                primary,
                ...(fallback && { fallback }),
                ...(roundRobin.length > 0 && { roundRobin }),
            },
            ...(jira && { jira }),
            ...(git && { git }),
        }

        saveConfig(config)

        console.log('\n  ✓ Config saved to', CONFIG_PATH)
        console.log('  Run qaagent run --url <url> --goal "<goal>" to start testing')
        if (jira && git) {
            console.log('  Or qaagent generate --sprint active to generate tests from your active sprint\n')
        } else {
            console.log()
        }
    })
