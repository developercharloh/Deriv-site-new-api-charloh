// Run after `pnpm --filter @workspace/deriv-site build`.
// Use the real tab IDs: omitting them hides pane-style leakage onto tab headers.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const styles = [];
async function collect(directory) {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
        const filename = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(filename);
        else if (filename.endsWith('.css')) styles.push(await fs.readFile(filename, 'utf8'));
    }
}
await collect(path.join(root, 'dist/static/css'));
const css = styles.join('\n');
assert.ok(css.includes('.dc-tabs__content-panel#id-free-bots'), 'Build the scoped pane styles first');
const tabs = [
    ['id-dbot-dashboard', 'Dashboard'],
    ['id-bot-builder', 'Bot Builder'],
    ['id-charts', 'Charts'],
    ['id-ai-signals', 'AI Signals'],
    ['id-free-bots', 'Free Bots'],
    ['id-ai-analysis', 'AI Analysis'],
    ['id-advanced-dtrader', 'Advanced D-Trader'],
];
const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'main-tabs-layout-'));
const chromium = process.env.CHROMIUM_PATH || '/repl/tools/bin/chromium';

function documentHtml(style, active) {
    const items = tabs.map(([id, label], index) => `<li id="${id}" class="dc-tabs__item dc-tabs__item--top dc-tabs__item--main__tabs ${index === active ? 'dc-tabs__active dc-tabs__item--is-scrollable-and-active' : ''}"><svg width="24" height="24"></svg><span>${label}</span></li>`).join('');
    return `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><style>${style}</style></head><body>
    <div class="main"><div class="main__container"><div><div class="dc-tabs dc-tabs--main__tabs dc-tabs--top">
    <div class="dc-tabs__list--header--main__tabs"><ul class="dc-tabs__list dc-tabs__list--main__tabs dc-tabs__list--border-bottom">
    <div class="dc-themed-scrollbars dc-themed-scrollbars-wrapper dc-themed-scrollbars--only-horizontal">${items}</div></ul></div>
    <div class="dc-tabs__content"><div class="dc-tabs__content-panel" id="${tabs[active][0]}">Content</div></div>
    </div></div></div></div>
    <script>
    const rail=document.querySelector('.dc-themed-scrollbars-wrapper');
    const measure=()=>[...rail.children].map(el=>{
        const rect=el.getBoundingClientRect(), style=getComputedStyle(el);
        return {label:el.innerText,top:rect.top,height:rect.height,direction:style.flexDirection,padding:parseFloat(style.paddingBottom)};
    });
    const before=measure(); rail.scrollLeft=rail.scrollWidth;
    document.body.dataset.result=JSON.stringify({before,after:measure(),scrollable:rail.scrollWidth>rail.clientWidth});
    </script></body></html>`;
}

async function measure(style, width, active, name) {
    const filename = path.join(directory, `${name}-${width}-${active}.html`);
    await fs.writeFile(filename, documentHtml(style, active));
    const result = spawnSync(chromium, ['--headless', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage', `--window-size=${width},874`, '--dump-dom', `file://${filename}`], { encoding: 'utf8', timeout: 30000, maxBuffer: 5 * 1024 * 1024 });
    assert.equal(result.status, 0, result.stderr);
    const match = result.stdout.match(/data-result="([^"]+)"/);
    assert.ok(match, 'Browser did not return layout metrics');
    return JSON.parse(match[1].replaceAll('&quot;', '"').replaceAll('&amp;', '&'));
}

try {
    // Prove this fixture catches the original bug, rather than merely passing
    // a simplified header that has none of the IDs used by the real component.
    const oldCss = css.replaceAll('.dc-tabs__content-panel#id-', '#id-');
    const broken = await measure(oldCss, 454, 2, 'before');
    assert.ok(broken.before.some(item => item.direction === 'column' || item.padding > 20), 'Fixture did not reproduce pane styling on a tab header');
    console.log('Reproduced the original pane-style leakage with the unscoped selectors.');
    for (const width of [390, 454, 980]) {
        for (const active of [0, 2, 4, 5, 6]) {
            const result = await measure(css, width, active, 'after');
            for (const items of [result.before, result.after]) {
                for (const item of items) {
                    assert.ok(Math.abs(item.top - items[0].top) < 1, `${width}px ${item.label}: mismatched top`);
                    assert.ok(Math.abs(item.height - 40) < 1, `${width}px ${item.label}: wrong height`);
                    assert.equal(item.direction, 'row', `${width}px ${item.label}: stacked label`);
                    assert.equal(item.padding, 0, `${width}px ${item.label}: inherited pane padding`);
                }
            }
        }
        console.log(`PASS ${width}px: Dashboard, Charts, Free Bots, AI Analysis and Advanced D-Trader; aligned before and after horizontal scroll.`);
    }
} finally {
    await fs.rm(directory, { recursive: true, force: true });
}
