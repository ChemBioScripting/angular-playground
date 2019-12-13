import * as puppeteer from 'puppeteer';
import chalk from 'chalk';
import { copyFileSync } from 'fs';
import { ConsoleMessage } from 'puppeteer';
import { ErrorReporter, REPORT_TYPE } from '../error-reporter';
import { Config } from '../configure';
import { getSandboxMetadata, removeDynamicImports, SANDBOX_DEST, SANDBOX_PATH, waitForNgServe } from '../utils';

// Used to tailor the version of headless chromium ran by puppeteer
const CHROME_ARGS = [ '--disable-gpu', '--no-sandbox' ];

export interface ScenarioSummary {
    url: string;
    name: string;
    description: string;
}

let browser: puppeteer.Browser;
let currentScenario = '';
let currentScenarioDescription = '';
let reporter: ErrorReporter;
let hostUrl = '';

// Ensure Chromium instances are destroyed on error
process.on('unhandledRejection', () => {
    if (browser) browser.close();
});

export async function verifySandboxes(config: Config) {
    hostUrl = `http://localhost:${config.angularCliPort}`;
    copyFileSync(SANDBOX_PATH, SANDBOX_DEST);
    removeDynamicImports(SANDBOX_DEST);
    await main(config);
}

/////////////////////////////////

async function main(config: Config) {
    const timeoutAttempts = config.timeout;
    browser = await puppeteer.launch({
        headless: true,
        handleSIGINT: false,
        args: CHROME_ARGS,
    });

    // get metadata about scenarios
    const scenarios = getSandboxMetadata(config.randomScenario, config.pathToSandboxes);
    reporter = new ErrorReporter(scenarios, config.reportPath, config.reportType);
    console.log(`Retrieved ${scenarios.length} scenarios.\n`);
    await waitForNgServe(browser, hostUrl, timeoutAttempts);

    // set up page to listen to console events
    const page = await browser.newPage();
    page.on('console', (msg: ConsoleMessage) => onConsoleErr(msg));

    // check each scenario
    for (let i = 0; i < scenarios.length; i++) {
        const scenario = scenarios[i];
        currentScenario = scenario.name;
        currentScenarioDescription = scenario.description;
        const url = `${hostUrl}?scenario=${scenario.url}`;
        console.log(`Checking [${i + 1}/${scenarios.length}]: ${scenario.label}`);

        // load scenario
        const waitForNavigation = page.waitForNavigation({ waitUntil: 'networkidle0' });
        await page.evaluate((sandboxKey, scenarioKey) => (window as any).loadScenario(sandboxKey, scenarioKey),
            scenario.sandboxKey, scenario.scenarioKey);
        await Promise.all([
            waitForNavigation,
            page.waitFor(() => (window as any).isPlaygroundComponentLoaded()),
        ]);
    }

    browser.close();

    const hasErrors = reporter.errors.length > 0;
    // always generate report if report type is a file, or if there are errors
    if (hasErrors || config.reportType !== REPORT_TYPE.LOG) {
        reporter.compileReport();
    }
    const exitCode = hasErrors ? 1 : 0;
    process.exit(exitCode);
}

/**
 * Callback when Chromium page encounters a console error
 */
function onConsoleErr(msg: ConsoleMessage) {
    if (msg.type() === 'error') {
        console.error(chalk.red(`Error in ${currentScenario} (${currentScenarioDescription}):`));
        const getErrors = (type: string, getValue: (_: any) => string) => msg.args()
            .map(a => (a as any)._remoteObject)
            .filter(o => o.type === type)
            .map(getValue);
        const stackTrace = getErrors('object', o => o.description);
        const errorMessage = getErrors('string', o => o.value);
        const description = stackTrace.length ? stackTrace : errorMessage;
        description.map(d => console.error(d));
        if (description.length) {
            reporter.addError(description, currentScenario, currentScenarioDescription);
        }
    }
}

/**
 * Returns a random value between 1 and the provided length (both inclusive).
 * Note: indexing of keys starts at 1, not 0
 */
function getRandomKey(menuItemsLength: number): number {
    return Math.floor(Math.random() * menuItemsLength) + 1;
}
