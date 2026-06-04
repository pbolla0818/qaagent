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
        config.region = await input({ message: 'AWS region:', default: 'us-east-1' })
        config.awsAccessKeyId = await password({
            message: 'AWS access key id:',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })
        config.awsSecretAccessKey = await password({
            message: 'AWS secret access key:',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })
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
        message: `Model (enter for default: ${defaultModel}):`,
    })
    if (customModel.trim().length > 0) config.model = customModel.trim()

    return config
}

async function setupLLM(): Promise<{ primary: ProviderConfig; fallback?: ProviderConfig; roundRobin?: ProviderConfig[] }> {
    const primary = await setupProvider('LLM')

    const advanced = await confirm({
        message: 'Configure advanced LLM options (fallback, round-robin)?',
        default: false,
    })
    if (!advanced) return { primary }

    let fallback: ProviderConfig | undefined
    const wantsFallback = await confirm({ message: 'Add a fallback provider (used on rate-limit)?', default: false })
    if (wantsFallback) fallback = await setupProvider('fallback LLM')

    const roundRobin: ProviderConfig[] = []
    const wantsRR = await confirm({ message: 'Add round-robin providers to spread load?', default: false })
    if (wantsRR) {
        let addMore = true
        while (addMore) {
            roundRobin.push(await setupProvider(`round-robin #${roundRobin.length + 1}`))
            addMore = await confirm({ message: 'Add another provider?', default: false })
        }
    }

    return {
        primary,
        ...(fallback && { fallback }),
        ...(roundRobin.length > 0 && { roundRobin }),
    }
}

async function setupJira(): Promise<JiraConfig | undefined> {
    const wantsJira = await confirm({
        message: 'Configure JIRA Cloud (for `qaagent generate --sprint active`)?',
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
        message: 'JIRA API token:',
        validate: v => v.trim().length > 0 ? true : 'cannot be empty'
    })
    const boardId = await number({
        message: 'Board id for --sprint active (required for sprint mode):',
    })

    const config: JiraConfig = {
        baseURL: baseURL.replace(/\/+$/, ''),
        email,
        apiToken,
        ...(typeof boardId === 'number' && { boardId }),
    }

    const advanced = await confirm({
        message: 'Configure advanced JIRA options (project filter, dev statuses, bug intake)?',
        default: false,
    })
    if (!advanced) return config

    const projectKey = await input({ message: 'JIRA project key filter (optional, e.g. ENG):' })
    if (projectKey.trim().length > 0) config.projectKey = projectKey.trim()

    const wantsIntake = await confirm({
        message: 'File agent-discovered bugs into a separate JIRA project?',
        default: true,
    })
    if (wantsIntake) {
        config.intakeProjectKey = (await input({
            message: 'Bug intake project key (e.g. QABUGS):',
            validate: v => v.trim().length > 0 ? true : 'cannot be empty'
        })).trim()
        config.intakeIssueType = DEFAULT_INTAKE_ISSUE_TYPE
        config.intakeLabels = [...DEFAULT_INTAKE_LABELS]
        config.intakeSeverities = [...DEFAULT_INTAKE_SEVERITIES]
    }

    return config
}

async function setupRepoLoop(defaults: { baseURL?: string; releaseBranch?: string }): Promise<RepoConfig[]> {
    const repos: RepoConfig[] = []
    let addMore = true
    while (addMore) {
        const name = await input({
            message: `repo #${repos.length + 1} — owner/name:`,
            validate: v => /^[^/]+\/[^/]+$/.test(v) ? true : 'must be owner/name'
        })
        const baseURL = await input({
            message: `repo #${repos.length + 1} — app URL (blank = backend/no-UI):`,
            default: defaults.baseURL ?? '',
        })
        const releaseBranch = await input({
            message: `repo #${repos.length + 1} — release branch:`,
            default: defaults.releaseBranch ?? 'main',
        })
        repos.push({
            name,
            ...(baseURL.trim().length > 0 && { baseURL: baseURL.trim() }),
            ...(releaseBranch.trim().length > 0 && { releaseBranch: releaseBranch.trim() }),
        })
        addMore = await confirm({ message: 'Add another repo?', default: false })
    }
    return repos
}

async function setupGit(): Promise<GitConfig | undefined> {
    const wantsGit = await confirm({
        message: 'Configure GitHub (for PR-driven test generation)?',
        default: true,
    })
    if (!wantsGit) return undefined

    const token = await password({
        message: 'GitHub personal access token (repo scope):',
        validate: v => v.trim().length > 0 ? true : 'cannot be empty'
    })
    const repo = await input({
        message: 'Repo (owner/name):',
        validate: v => /^[^/]+\/[^/]+$/.test(v) ? true : 'must be owner/name'
    })
    const baseURL = await input({
        message: 'App URL to test (e.g. https://staging.yourapp.com):',
        validate: v => v.startsWith('http') ? true : 'must start with http:// or https://'
    })
    const releaseBranch = await input({
        message: 'Release branch:',
        default: 'main',
    })

    const advanced = await confirm({
        message: 'Add more repos to the same project (multi-repo mode)?',
        default: false,
    })

    if (!advanced) {
        return {
            host: 'github',
            token,
            repo,
            baseURL,
            ...(releaseBranch.trim().length > 0 && { releaseBranch: releaseBranch.trim() }),
        }
    }

    // Multi-repo — first repo is already collected, loop for the rest
    const repos: RepoConfig[] = [{
        name: repo,
        baseURL,
        ...(releaseBranch.trim().length > 0 && { releaseBranch: releaseBranch.trim() }),
    }]
    console.log('\n  Add additional repos. Press N when done.\n')
    repos.push(...(await setupRepoLoop({
        ...(baseURL && { baseURL }),
        ...(releaseBranch && { releaseBranch }),
    })))

    return {
        host: 'github',
        token,
        repos,
        ...(baseURL && { baseURL }),
        ...(releaseBranch.trim().length > 0 && { releaseBranch: releaseBranch.trim() }),
    }
}

export const setupCommand = new Command('setup')
    .description('Configure LLM, JIRA, and GitHub')
    .action(async () => {
        console.log('\n  👾 qaagent setup\n')

        const llm = await setupLLM()
        const jira = await setupJira()
        const git = await setupGit()

        const config: QaagentConfig = {
            llm,
            ...(jira && { jira }),
            ...(git && { git }),
        }

        saveConfig(config)

        console.log('\n  ✓ saved to', CONFIG_PATH)
        if (jira && git) {
            console.log('  → qaagent generate --sprint active')
        } else {
            console.log('  → qaagent run --url <url> --goal "<goal>"')
        }
        console.log()
    })
