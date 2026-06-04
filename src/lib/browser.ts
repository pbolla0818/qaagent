import { chromium, type Browser } from "playwright"

let browser: Browser | null = null

// Linux containers need these flags; macOS/Windows don't.
const LINUX_FLAGS = [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
]

export async function getBrowser(isheadless: boolean = true): Promise<Browser> {
    if (!browser || !browser.isConnected()) {
        const args = process.platform === 'linux'
            ? [...LINUX_FLAGS, "--disable-gpu"]
            : []

        browser = await chromium.launch({
            headless: isheadless,
            timeout: 30_000,
            args,
        })
    }
    return browser
}

export async function closeBrowser(): Promise<void> {
    if (browser) {
        await browser.close()
        browser = null
    }
}
