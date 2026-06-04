import { Command } from 'commander'
import { select, input, password, confirm, number } from '@inquirer/prompts'
import type {
    ProviderConfig,
    ProviderName,
    QaagentConfig,
    JiraConfig,
    GitConfig,
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
        message: 'Default JIRA project key (optional, e.g. ENG):',
    })
    const boardId = await number({
        message: 'Default board id for --sprint active (optional):',
    })

    return {
        baseURL: baseURL.replace(/\/+$/, ''),
        email,
        apiToken,
        ...(projectKey.trim().length > 0 && { projectKey: projectKey.trim() }),
        ...(typeof boardId === 'number' && { boardId }),
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
    const repo = await input({
        message: 'Default repo (owner/name):',
        validate: v => /^[^/]+\/[^/]+$/.test(v) ? true : 'must be in owner/name format'
    })
    const baseURL = await input({
        message: 'Default app URL to test against (e.g. https://staging.yourapp.com):',
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
