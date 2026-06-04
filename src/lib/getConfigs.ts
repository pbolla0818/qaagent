import fs from 'fs'
import os from 'os'
import path from 'path'
import type { QaagentConfig } from '../types/index.js';

export const CONFIG_DIR = path.join(os.homedir(), '.qaagent')
export const CONFIG_PATH = path.join(CONFIG_DIR, 'qaagent.config.json')

export function getConfig(): QaagentConfig {
    if (!fs.existsSync(CONFIG_PATH)) {
        throw new Error("Config file not found. Run 'qaagent setup' to create one.");
    }
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    return config;
}

export function saveConfig(config: QaagentConfig): void {
    fs.mkdirSync(CONFIG_DIR, { recursive: true })
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2))
}
