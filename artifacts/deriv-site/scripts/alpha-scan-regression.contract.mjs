import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const scriptDirectory = fileURLToPath(new URL('.', import.meta.url));
const packageJson = JSON.parse(await readFile(`${scriptDirectory}../package.json`, 'utf8'));
const regressionSource = await readFile(`${scriptDirectory}alpha-scan-regression.mjs`, 'utf8');
const alphaScanScripts = packageJson.scripts;

assert.equal(
    alphaScanScripts['test:alpha-scan'],
    'pnpm run test:alpha-scan:contract && node scripts/alpha-scan-regression.mjs',
    'The fixture check must run the contract guard without enabling live feed coverage.',
);
assert.match(
    alphaScanScripts['test:alpha-scan:live'],
    /(?:^|&&\s*)ALPHA_SCAN_LIVE=1 node scripts\/alpha-scan-regression\.mjs$/,
    'The live check must explicitly set ALPHA_SCAN_LIVE=1.',
);
assert.doesNotMatch(
    alphaScanScripts['test:alpha-scan'],
    /ALPHA_SCAN_LIVE\s*=\s*1/,
    'The fixture check must not enable live feed coverage.',
);
assert.equal(
    alphaScanScripts['test:alpha-scan:contract'],
    'node scripts/alpha-scan-regression.contract.mjs',
    'The contract check must remain directly runnable.',
);

assert.match(
    regressionSource,
    /fixture:\s*\{\s*status:\s*'passed'/s,
    'The regression output must keep a machine-readable fixture result section.',
);
assert.match(
    regressionSource,
    /externalFeed:\s*RUN_LIVE\s*\?/s,
    'The regression output must keep a machine-readable externalFeed result section.',
);
assert.match(
    regressionSource,
    /status:\s*'skipped',\s*reason:\s*'Set ALPHA_SCAN_LIVE=1 to run public-feed integration coverage\.'/s,
    'Fixture runs must report why public-feed integration coverage was skipped.',
);
assert.match(
    regressionSource,
    /phase === 'external-feed'\s*\?\s*'Public-feed integration failure'/,
    'Public-feed outages must retain the external integration failure classification.',
);
assert.match(
    regressionSource,
    /ALPHA_SCAN_RESULT_PATH/,
    'Scheduled runs must support an explicit durable result path.',
);
assert.match(
    regressionSource,
    /const persistReport = async report =>/,
    'Every regression run must persist a machine-readable result.',
);
assert.match(
    regressionSource,
    /failureClassification = phase === 'external-feed' \? 'public-feed' : 'fixture-layout'/,
    'Retained failures must distinguish public-feed outages from fixture layout failures.',
);

console.log('Alpha Scan regression command contract passed.');