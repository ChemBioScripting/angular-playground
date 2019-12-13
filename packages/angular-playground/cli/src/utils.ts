import { readFileSync, writeFileSync } from 'fs';
import { resolve as resolvePath } from 'path';
import { Browser, ConsoleMessage } from 'puppeteer';
import { SandboxFileInformation } from './build-sandboxes';

export const SANDBOX_PATH = resolvePath(__dirname, '../../../dist/build/src/shared/sandboxes.js');
export const SANDBOX_DEST = resolvePath(__dirname, '../../../sandboxes_modified.js');

export function delay(ms: number) {
  return new Promise(resolve => {
      setTimeout(() => {
          resolve();
      }, ms);
  });
}

export function removeDynamicImports(sandboxPath: string) {
  const data = readFileSync(sandboxPath, 'utf-8');
  const dataArray = data.split('\n');
  const getSandboxIndex = dataArray.findIndex(val => val.includes('getSandbox(path)'));
  const result = dataArray.slice(0, getSandboxIndex).join('\n');
  writeFileSync(sandboxPath, result, { encoding: 'utf-8' });
}

/**
 * Creates a Chromium page and navigates to the host url.
 * If Chromium is not able to connect to the provided page, it will issue a series
 * of retries before it finally fails.
 */
export async function waitForNgServe(browser: Browser, hostUrl: string, timeoutAttempts: number) {
    let ngServeErrorCount = 0;
    const ngServeErrors = [];
    for (let i = 0; i < timeoutAttempts; i++) {
        const page = await browser.newPage();
        page.on('console', (msg: ConsoleMessage) => {
            if (msg.type() === 'error') {
                ngServeErrorCount++;
                ngServeErrors.push(msg.text());
            }
        });

        let success = true;
        try {
            await page.goto(hostUrl);
        } catch (e) {
            success = false;
            await delay(1000);
        } finally {
            await page.close();
            if (success) {
                console.log('SUCCESS')
                return;
            }
        }
    }

    if (ngServeErrorCount > 0) {
        const separator = '\n  ';
        throw new Error(`ng serve failure.${separator}${ngServeErrors.join(separator)}`);
    } else {
        throw new Error('Unable to connect to Playground.');
    }
}

export function getSandboxMetadata(selectRandomScenario: boolean, pathToSandboxes = '') {
    const paths = [];
    const mapItem = (item: SandboxFileInformation, scenarioItem: { key: number, description: string }) => ({
        sandboxKey: item.key,
        scenarioKey: scenarioItem.key,
        url: `${encodeURIComponent(item.key)}/${encodeURIComponent(scenarioItem.description)}`,
        label: `${item.name} [${scenarioItem.description}]`,
    });
    loadSandboxMenuItems().forEach((item) => {
        if (item.key.includes(pathToSandboxes)) {
            if (selectRandomScenario) {
                // add single random scenario
                const index = Math.floor(Math.random() * item.scenarioMenuItems.length);
                paths.push(mapItem(item, item.scenarioMenuItems[index]));
            } else {
                // add all scenarios
                item.scenarioMenuItems.forEach((scenarioItem) => {
                    paths.push(mapItem(item, scenarioItem));
                });
            }
        }
    }, []);
    return paths;
}

/**
 * Attempt to load sandboxes.ts and provide menu items
 */
function loadSandboxMenuItems(): SandboxFileInformation[] {
    try {
        return require(SANDBOX_DEST).getSandboxMenuItems();
    } catch (err) {
        throw new Error(`Failed to load sandbox menu items. ${err}`);
    }
}
