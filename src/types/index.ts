// qaagent — Types

// Actions
export type ActionType = | 'open' | 'click' | 'type' | 'scroll' | 'select' | 'hover' | 'press' | 'wait' | 'done' | 'stuck'

export interface Action {
  type: ActionType
  target?: string    // element description e.g. "Submit button"
  value?: string   // text to type, url, key to press, scroll direction
  reasoning: string   // why this action — one sentence
  finding?: Finding  // bug or issue spotted at this step
}

export interface ActionResult {
  success: boolean
  error?: string
}

// Findings
export interface Finding {
  severity: 'critical' | 'warning' | 'info'
  description: string
  element?: string | undefined
  screenshot?: string  // path - attached by runner
  step?: number
}

// Page State
export interface PageState {
  url?: string   // undefined for native apps
  title?: string | undefined
  tree: string   // extracted UI elements as text
  timestamp: number
}

// History
export interface HistoryEntry {
  step: number
  pageState: PageState
  action: Action
}

// User Persona for AI Tester
export interface PersonaConfig {
  name: string
  description: string
  systemPrompt: string
  patience: number   // 1-10: how long before giving up
  aggression: number   // 1-10: how destructive
  readingBehavior: 'thorough' | 'skim' | 'skip'
  maxSteps?: number   // optional override, derived from patience if not set
}

// LLM Provider Config
export type ProviderName =
  | 'groq'
  | 'openai'
  | 'anthropic'
  | 'gemini'
  | 'openrouter'
  | 'ollama'
  | 'cerebras'
  | 'mistral'
  | 'azure-foundry'
  | 'bedrock'

export interface ProviderConfig {
  provider: ProviderName
  apiKey?: string
  model?: string
  baseURL?: string
  // Bedrock-specific
  region?: string
  awsAccessKeyId?: string
  awsSecretAccessKey?: string
  awsSessionToken?: string
}

export interface LLMInput {
  system: string
  messages: LLMMessage[]
}

export interface LLMMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface LLMOutput {
  content: string
  provider: ProviderName
  model: string
}

// JIRA Cloud
export interface JiraConfig {
  baseURL: string   // e.g. https://yourco.atlassian.net
  email: string
  apiToken: string
  projectKey?: string   // optional narrow filter, e.g. "ENG"
  boardId?: number   // default board for --sprint active
}

// GitHub
export interface GitConfig {
  host: 'github'
  token: string
  repo: string   // owner/name, e.g. "acme/web"
  baseURL?: string   // app URL to test against (e.g. https://staging.yourapp.com)
  releaseBranch?: string   // PRs are filtered to those targeting this branch in --sprint active mode
}

// qaagent Config (saved at ~/.qaagent/qaagent.config.json)
export interface LLMSection {
  primary: ProviderConfig
  fallback?: ProviderConfig
  roundRobin?: ProviderConfig[]
}

export interface QaagentConfig {
  llm: LLMSection
  jira?: JiraConfig
  git?: GitConfig
}

// Run Result
export interface RunResult {
  persona: string
  url: string
  goal: string
  steps: number
  findings: Finding[]
  goalReached: boolean
  stuck: boolean
  duration: number      // ms
  history: HistoryEntry[]
}

// Generated Goal (output of goalGenerator)
export interface GeneratedGoal {
  url: string
  goal: string
  persona: string   // persona key, e.g. "first-timer"
  source: {
    jiraKey?: string
    prNumber?: number
  }
}

// JIRA / GitHub fetched shapes (passed into goalGenerator)
export interface JiraIssue {
  key: string
  summary: string
  description: string
  acceptanceCriteria?: string
  status: string
}

export interface GitHubPR {
  number: number
  title: string
  branch: string
  body: string
  diff: string
  jiraKeys: string[]   // extracted from title/branch/body
  updatedAt: string
}
