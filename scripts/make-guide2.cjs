/**
 * Replit Beginner's Guide — Comprehensive Annotated PDF
 * Run: node make-guide2.cjs  (from /tmp/pdfgen/ with pdfkit installed)
 */
const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = '/home/runner/workspace/Replit-Beginners-Guide.pdf';
const SCREENSHOT_HOME = '/home/runner/workspace/attached_assets/screenshots/replit_com.png';

const doc = new PDFDocument({
    size: 'A4',
    margin: 0,
    autoFirstPage: false,
    info: {
        Title: "Build Your App on Replit — Complete Visual Guide",
        Author: 'Replit Guide',
        Subject: 'Beginner guide to building web apps on Replit'
    }
});
doc.pipe(fs.createWriteStream(OUT));

// ─── Constants ────────────────────────────────────────────────────────────────
const PW = 595.28;   // A4 width  pts
const PH = 841.89;   // A4 height pts
const ML = 45;       // margin left
const MR = 45;       // margin right
const CW = PW - ML - MR;  // content width
const BLUE   = '#2563EB';
const LBLUE  = '#DBEAFE';
const DARK   = '#0F172A';
const BODY   = '#1E293B';
const MUTED  = '#64748B';
const GREEN  = '#16A34A';
const LGREEN = '#DCFCE7';
const RED    = '#DC2626';
const LRED   = '#FEE2E2';
const YELL   = '#D97706';
const LYELL  = '#FEF3C7';
const WHITE  = '#FFFFFF';
const SHELL  = '#0D1117';
const SHELLG = '#3FB950';

// ─── Page management ─────────────────────────────────────────────────────────
let pageNum = 0;

function newPage(hasHeader) {
    doc.addPage({ size: 'A4', margin: 0 });
    pageNum++;
    doc.y = hasHeader ? 130 : ML;
}

// Check if we need a page break before drawing something of `height` pts
function need(height) {
    if (doc.y + height > PH - 50) {
        doc.addPage({ size: 'A4', margin: 0 });
        pageNum++;
        doc.y = 55;
    }
}

// ─── Drawing helpers ──────────────────────────────────────────────────────────

function arrow(x1, y1, x2, y2, color, thick) {
    color = color || RED;
    thick = thick || 2;
    doc.save()
       .strokeColor(color)
       .lineWidth(thick)
       .moveTo(x1, y1)
       .lineTo(x2, y2)
       .stroke();
    // Arrowhead
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const len = 10;
    doc.save()
       .fillColor(color)
       .moveTo(x2, y2)
       .lineTo(x2 - len * Math.cos(angle - 0.4), y2 - len * Math.sin(angle - 0.4))
       .lineTo(x2 - len * Math.cos(angle + 0.4), y2 - len * Math.sin(angle + 0.4))
       .closePath()
       .fill()
       .restore();
    doc.restore();
}

function highlight(x, y, w, h, color, lineW) {
    color = color || RED;
    lineW = lineW || 2.5;
    doc.save()
       .roundedRect(x - 3, y - 3, w + 6, h + 6, 5)
       .strokeColor(color)
       .lineWidth(lineW)
       .stroke()
       .restore();
}

function callout(x, y, text, color) {
    color = color || RED;
    const tw = doc.widthOfString(text, { fontSize: 9 }) + 16;
    doc.save()
       .roundedRect(x, y, tw, 20, 4)
       .fill(color);
    doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold')
       .text(text, x + 8, y + 6);
    doc.restore();
}

// ─── Typography helpers ───────────────────────────────────────────────────────

function chapterBanner(num, title, subtitle, color) {
    color = color || BLUE;
    doc.rect(0, 0, PW, 115).fill(color);
    // Chapter number tag
    doc.rect(ML, 20, 36, 36).fill('rgba(255,255,255,0.20)');
    doc.fillColor(WHITE).fontSize(18).font('Helvetica-Bold')
       .text(String(num).padStart(2, '0'), ML, 29, { width: 36, align: 'center' });
    doc.fontSize(7).font('Helvetica').text('CHAPTER', ML, 22, { width: 36, align: 'center' });
    // Title
    doc.fontSize(22).font('Helvetica-Bold').fillColor(WHITE)
       .text(title, ML + 46, 24, { width: CW - 46 });
    // Subtitle
    doc.fontSize(11).font('Helvetica').fillColor('rgba(255,255,255,0.80)')
       .text(subtitle, ML + 46, 52, { width: CW - 46 });
    doc.y = 130;
}

function sectionTitle(text) {
    need(42);
    doc.moveDown(0.3);
    const y = doc.y;
    doc.rect(ML, y, CW, 30).fill(BLUE);
    doc.rect(ML, y, 5, 30).fill('#1D4ED8');
    doc.fillColor(WHITE).fontSize(12).font('Helvetica-Bold')
       .text(text, ML + 14, y + 9, { width: CW - 20 });
    doc.y = y + 38;
}

function h2(text) {
    need(30);
    doc.moveDown(0.3);
    doc.fontSize(12).font('Helvetica-Bold').fillColor(BODY)
       .text(text, ML, doc.y);
    doc.moveDown(0.2);
}

function para(text) {
    need(30);
    const h = doc.heightOfString(text, { width: CW, fontSize: 10.5, lineGap: 3 });
    need(h + 8);
    doc.fontSize(10.5).font('Helvetica').fillColor(BODY)
       .text(text, ML, doc.y, { width: CW, lineGap: 3 });
    doc.moveDown(0.3);
}

function bullets(items) {
    items.forEach(item => {
        const h = doc.heightOfString(item, { width: CW - 20, fontSize: 10.5, lineGap: 3 });
        need(h + 10);
        const y = doc.y;
        doc.circle(ML + 7, y + 6, 3).fill(BLUE);
        doc.fontSize(10.5).font('Helvetica').fillColor(BODY)
           .text(item, ML + 18, y, { width: CW - 22, lineGap: 3 });
        doc.moveDown(0.18);
    });
    doc.moveDown(0.3);
}

function numberedStep(num, title, body) {
    const bodyH = doc.heightOfString(body, { width: CW - 56, fontSize: 10.5, lineGap: 3 });
    need(bodyH + 48);
    const y = doc.y;
    // Number circle
    doc.circle(ML + 14, y + 14, 14).fill(BLUE);
    doc.fillColor(WHITE).fontSize(13).font('Helvetica-Bold')
       .text(String(num), ML, y + 8, { width: 28, align: 'center' });
    // Title
    doc.fillColor(BODY).fontSize(11.5).font('Helvetica-Bold')
       .text(title, ML + 34, y + 7, { width: CW - 38 });
    // Body
    doc.fontSize(10.5).font('Helvetica').fillColor('#475569')
       .text(body, ML + 34, y + 23, { width: CW - 38, lineGap: 3 });
    doc.y = y + Math.max(34, bodyH + 28);
    doc.moveDown(0.3);
}

function codeBlock(lines, lang) {
    const lineH = 14;
    const blockH = lines.length * lineH + 20;
    need(blockH + 10);
    const y = doc.y;
    // Dark background
    doc.rect(ML, y, CW, blockH).fill(SHELL);
    // Language tag
    if (lang) {
        doc.roundedRect(ML + CW - 60, y + 5, 52, 16, 3).fill('#21262D');
        doc.fillColor('#8B949E').fontSize(8).font('Helvetica').text(lang, ML + CW - 57, y + 9);
    }
    // Line numbers + code
    lines.forEach((line, i) => {
        const ly = y + 10 + i * lineH;
        doc.fillColor('#6E7681').fontSize(8).font('Courier')
           .text(String(i + 1).padStart(2, ' '), ML + 8, ly, { width: 18 });
        // Colour keywords simply
        doc.fillColor(SHELLG).fontSize(9).font('Courier')
           .text(line, ML + 28, ly, { width: CW - 36, lineGap: 0 });
    });
    doc.y = y + blockH + 4;
    doc.moveDown(0.3);
}

function shellCmd(comment, cmd) {
    need(56);
    const y = doc.y;
    if (comment) {
        doc.fontSize(9).font('Helvetica').fillColor(MUTED).text(comment, ML, y);
        doc.y += 13;
    }
    const cmdY = doc.y;
    doc.rect(ML, cmdY, CW, 28).fill(SHELL);
    doc.rect(ML, cmdY, 4, 28).fill(BLUE);
    doc.fillColor('#F0883E').fontSize(9.5).font('Courier').text('$', ML + 10, cmdY + 9);
    doc.fillColor(SHELLG).fontSize(9.5).font('Courier').text(cmd, ML + 22, cmdY + 9, { width: CW - 30 });
    doc.y = cmdY + 34;
    doc.moveDown(0.15);
}

function tipBox(icon, text, bg, border) {
    bg = bg || LYELL; border = border || YELL;
    const h = doc.heightOfString(text, { width: CW - 50, fontSize: 10, lineGap: 3 });
    const boxH = Math.max(40, h + 24);
    need(boxH + 10);
    const y = doc.y;
    doc.rect(ML, y, CW, boxH).fill(bg);
    doc.rect(ML, y, 4, boxH).fill(border);
    doc.fontSize(15).text(icon, ML + 12, y + (boxH - 18) / 2);
    doc.fillColor(BODY).fontSize(10).font('Helvetica')
       .text(text, ML + 36, y + 12, { width: CW - 50, lineGap: 3 });
    doc.y = y + boxH + 8;
}

// ─── UI DIAGRAM helpers ───────────────────────────────────────────────────────

function browserChrome(x, y, w, url) {
    // Browser bar
    doc.rect(x, y, w, 28).fill('#E5E7EB');
    doc.rect(x, y, w, 1).fill('#D1D5DB');
    // Traffic lights
    doc.circle(x + 14, y + 14, 5).fill('#EF4444');
    doc.circle(x + 26, y + 14, 5).fill('#F59E0B');
    doc.circle(x + 38, y + 14, 5).fill('#22C55E');
    // URL bar
    doc.roundedRect(x + 54, y + 6, w - 68, 16, 4).fill(WHITE).stroke('#D1D5DB');
    doc.fillColor('#6B7280').fontSize(8).font('Helvetica')
       .text(url, x + 60, y + 10, { width: w - 78 });
}

// ─── COVER ────────────────────────────────────────────────────────────────────
doc.addPage({ size: 'A4', margin: 0 });
pageNum++;

// Background gradient simulation
doc.rect(0, 0, PW, PH).fill('#0D1B2A');
doc.rect(0, 0, PW, 6).fill(BLUE);

// Big title block
doc.rect(0, 200, PW, 200).fill('#112240');

doc.fillColor(BLUE).fontSize(13).font('Helvetica-Bold')
   .text('COMPLETE VISUAL GUIDE', ML, 155, { width: CW, align: 'center', characterSpacing: 3 });

doc.fillColor(WHITE).fontSize(34).font('Helvetica-Bold')
   .text('Build Your App', ML, 215, { width: CW, align: 'center' });
doc.fillColor(BLUE).fontSize(34).font('Helvetica-Bold')
   .text('on Replit', ML, 255, { width: CW, align: 'center' });

doc.fillColor('#94A3B8').fontSize(14).font('Helvetica')
   .text('A step-by-step beginner\'s guide — manual coding, no AI', ML, 305, { width: CW, align: 'center' });

// Features list
const features = [
    '📸  Real screenshots with annotated arrows',
    '💻  Full code for a landing page, signup & login',
    '🖥️  Every Replit button and panel explained',
    '⚡  Keyboard shortcuts cheat sheet',
    '🚀  Deploy your app live to the internet',
    '🐛  Common errors and exactly how to fix them',
];
doc.y = 370;
features.forEach((f, i) => {
    doc.rect(ML + (i % 2) * (CW / 2 + 5), doc.y - (i % 2 === 1 ? 24 : 0), CW / 2 - 5, 22).fill('#1E3A5F');
    doc.fillColor(WHITE).fontSize(10).font('Helvetica')
       .text(f, ML + (i % 2) * (CW / 2 + 5) + 8, doc.y - (i % 2 === 1 ? 24 : 0) + 6, { width: CW / 2 - 20 });
    if (i % 2 === 1) doc.moveDown(0.5);
    else doc.y += 24;
});

doc.y = 580;
doc.fillColor('#CBD5E1').fontSize(11).font('Helvetica')
   .text('CONTENTS', ML, doc.y, { characterSpacing: 2 });
doc.moveDown(0.4);
const toc = [
    ['01', 'Create Your Replit Account', '3'],
    ['02', 'The Replit Interface — Every Panel', '5'],
    ['03', 'Write Your First HTML / CSS / JS', '8'],
    ['04', 'Install Packages (npm & pip)', '11'],
    ['05', 'Build a Full Website (Landing Page + Login + Signup)', '13'],
    ['06', 'React — Build a Modern Web App', '18'],
    ['07', 'Environment Variables & Secrets', '21'],
    ['08', 'Deploy Your App Live', '23'],
    ['09', 'Keyboard Shortcuts Cheat Sheet', '25'],
    ['10', 'Common Errors & Fixes', '27'],
];
toc.forEach(([num, title, pg]) => {
    doc.fillColor(BLUE).fontSize(9).font('Helvetica-Bold').text(num, ML, doc.y, { width: 20 });
    doc.fillColor('#CBD5E1').fontSize(9.5).font('Helvetica').text(title, ML + 24, doc.y - 10, { width: CW - 60 });
    doc.fillColor(MUTED).fontSize(9).text(pg, ML + CW - 14, doc.y - 10, { width: 14, align: 'right' });
    doc.moveDown(0.1);
});

doc.fillColor('#475569').fontSize(8).font('Helvetica')
   .text('replit.com  ·  Made for developers who code manually from scratch', ML, PH - 30, { width: CW, align: 'center' });

// ─── CH 1: CREATE YOUR ACCOUNT ────────────────────────────────────────────────
newPage(false);
chapterBanner(1, 'Create Your Replit Account', 'Sign up, log in, and create your first project — with screenshots');

sectionTitle('STEP 1 — Go to replit.com and click "Create account"');

para('Open any browser (Chrome, Firefox, Safari, Edge — any browser works) and type this address in the address bar at the top:');

need(36);
const y1 = doc.y;
doc.rect(ML, y1, CW, 32).fill(SHELL);
doc.fillColor(SHELLG).fontSize(13).font('Courier-Bold')
   .text('https://replit.com', ML, y1 + 9, { width: CW, align: 'center' });
doc.y = y1 + 40;

para('You will see the Replit homepage below. Look at the TOP RIGHT CORNER of the page:');

// Embed real screenshot
need(220);
const ssY = doc.y;
if (fs.existsSync(SCREENSHOT_HOME)) {
    const ssW = CW;
    const ssH = 200;
    doc.save();
    doc.rect(ML, ssY, ssW, ssH).clip();
    doc.image(SCREENSHOT_HOME, ML, ssY, { width: ssW, height: ssH });
    doc.restore();
    doc.rect(ML, ssY, ssW, ssH).stroke('#CBD5E1');
    // Highlight the "Create account" button — top right area of image
    // In the screenshot it's at roughly x=1240/1456 * CW, y=30/820 * 200
    const btnX = ML + (CW * 0.845);
    const btnY = ssY + (200 * 0.04);
    const btnW = CW * 0.13;
    const btnH = 18;
    highlight(btnX, btnY, btnW, btnH, RED, 3);
    arrow(btnX + btnW + 50, btnY + btnH + 40, btnX + btnW + 4, btnY + btnH / 2, RED, 2.5);
    callout(btnX + btnW + 10, btnY + btnH + 22, '① Click here', RED);
    doc.y = ssY + ssH + 10;
} else {
    // Draw mockup if screenshot missing
    doc.rect(ML, ssY, CW, 60).fill('#F8FAFC');
    doc.fillColor(MUTED).fontSize(10).text('[Screenshot: replit.com homepage]', ML, ssY + 22, { width: CW, align: 'center' });
    doc.y = ssY + 70;
}

tipBox('💡', '"Create account" is the button in the top-right corner. You can also click "Log in" if you already have an account.', LBLUE, BLUE);

// ─── SIGN UP FORM MOCKUP ──────────────────────────────────────────────────────
sectionTitle('STEP 2 — Fill in the signup form');

para('After clicking "Create account" you will see a signup form. Here is exactly what to do:');

need(300);
const formY = doc.y;
const formW = CW * 0.72;
const formX = ML + (CW - formW) / 2;

browserChrome(formX, formY, formW, 'replit.com/signup');

const fBodyY = formY + 28;
doc.rect(formX, fBodyY, formW, 240).fill(WHITE).stroke('#E5E7EB');

// Form content
doc.fillColor(BODY).fontSize(14).font('Helvetica-Bold')
   .text('Create your Replit account', formX + 20, fBodyY + 18, { width: formW - 40, align: 'center' });

// Google button
const gbY = fBodyY + 46;
doc.roundedRect(formX + 20, gbY, formW - 40, 32, 5).fill('#F8FAFC').stroke('#E2E8F0');
doc.fillColor(BODY).fontSize(10).font('Helvetica-Bold')
   .text('G   Continue with Google', formX + 20, gbY + 11, { width: formW - 40, align: 'center' });

// GitHub button
const ghbY = gbY + 40;
doc.roundedRect(formX + 20, ghbY, formW - 40, 32, 5).fill('#24292E').stroke('#374151');
doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold')
   .text('   Continue with GitHub', formX + 20, ghbY + 11, { width: formW - 40, align: 'center' });

// Divider
doc.moveTo(formX + 20, ghbY + 48).lineTo(formX + formW / 2 - 16, ghbY + 48).strokeColor('#E5E7EB').lineWidth(1).stroke();
doc.fillColor(MUTED).fontSize(9).text('or', formX + formW / 2 - 10, ghbY + 43);
doc.moveTo(formX + formW / 2 + 6, ghbY + 48).lineTo(formX + formW - 20, ghbY + 48).strokeColor('#E5E7EB').lineWidth(1).stroke();

// Email field
const efY = ghbY + 60;
doc.rect(formX + 20, efY, formW - 40, 26).fill('#F8FAFC').stroke('#D1D5DB');
doc.fillColor('#9CA3AF').fontSize(9).font('Helvetica').text('Email address', formX + 28, efY + 8);

// Password field
doc.rect(formX + 20, efY + 33, formW - 40, 26).fill('#F8FAFC').stroke('#D1D5DB');
doc.fillColor('#9CA3AF').fontSize(9).text('Password', formX + 28, efY + 41);

// Sign up button
doc.roundedRect(formX + 20, efY + 66, formW - 40, 30, 5).fill(BLUE);
doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold')
   .text('Create account', formX + 20, efY + 75, { width: formW - 40, align: 'center' });

// Annotations
highlight(formX + 16, gbY - 2, formW - 32, 34, GREEN, 2.5);
callout(formX + formW + 5, gbY + 5, '① Easiest — use Google', GREEN);
arrow(formX + formW + 5, gbY + 14, formX + formW - 4, gbY + 14, GREEN, 2);

highlight(formX + 16, efY - 2, formW - 32, 28, BLUE, 2.5);
callout(formX + formW + 5, efY + 3, '② Or use email', BLUE);
arrow(formX + formW + 5, efY + 11, formX + formW - 4, efY + 11, BLUE, 2);

doc.y = formY + 290;

para('Choose one of these options:\n① Click "Continue with Google" — easiest, no new password needed.\n② Type your email address and a password, then click "Create account".');

// ─── CONFIRM EMAIL ────────────────────────────────────────────────────────────
need(80);
sectionTitle('STEP 3 — Confirm your email');
numberedStep(1, 'Check your inbox', 'Replit sends you an email with a confirmation link. Open your email app (Gmail, Outlook, etc.).');
numberedStep(2, 'Click the link', 'Click the blue confirmation link inside the email. This takes you back to Replit.');
numberedStep(3, 'Choose the free plan', 'When asked about a plan, click "Start for free" or "Continue with Free". You do NOT need to pay to start building.');

// ─── CH 2: THE INTERFACE ──────────────────────────────────────────────────────
newPage(false);
chapterBanner(2, 'The Replit Interface', 'Every panel, button, and icon — exactly where to click');

sectionTitle('The Replit Editor — Full Layout');

para('When you open a project in Replit, you see the editor. It is divided into 4 main areas. Study this diagram carefully — every arrow points to a real element:');

need(420);
const edY = doc.y;
const edW = CW;
const edH = 380;

// ── Outer browser frame ──
browserChrome(ML, edY, edW, 'replit.com/@you/my-first-app');
const edBodyY = edY + 28;
doc.rect(ML, edBodyY, edW, edH - 28).fill('#0D1117');

// ── Top toolbar ──
const tbH = 34;
doc.rect(ML, edBodyY, edW, tbH).fill('#161B22');
doc.fillColor('#8B949E').fontSize(8.5).font('Helvetica').text('my-first-app', ML + 10, edBodyY + 12);
// Run button
doc.roundedRect(ML + edW - 100, edBodyY + 7, 55, 20, 4).fill('#238636');
doc.fillColor(WHITE).fontSize(8.5).font('Helvetica-Bold').text('▶  Run', ML + edW - 96, edBodyY + 12);
// Deploy button
doc.roundedRect(ML + edW - 160, edBodyY + 7, 52, 20, 4).fill('#1D4ED8');
doc.fillColor(WHITE).fontSize(8.5).font('Helvetica-Bold').text('Deploy', ML + edW - 153, edBodyY + 12);
// Fork
doc.roundedRect(ML + edW - 220, edBodyY + 7, 48, 20, 4).fill('#21262D');
doc.fillColor('#8B949E').fontSize(8.5).font('Helvetica').text('Fork', ML + edW - 210, edBodyY + 12);
// Share
doc.roundedRect(ML + edW - 275, edBodyY + 7, 48, 20, 4).fill('#21262D');
doc.fillColor('#8B949E').fontSize(8.5).font('Helvetica').text('Share', ML + edW - 263, edBodyY + 12);

// ── Left sidebar (icons) ──
const sbW = 42;
doc.rect(ML, edBodyY + tbH, sbW, edH - 28 - tbH).fill('#010409');
const icons = [['📁','Files'],['🔍','Search'],['🔒','Secrets'],['🌿','Git'],['⚙️','Settings']];
icons.forEach((ic, i) => {
    const iy = edBodyY + tbH + 14 + i * 46;
    doc.rect(ML + 2, iy - 4, sbW - 4, 36).fill(i === 0 ? '#161B22' : 'transparent');
    doc.fontSize(16).text(ic[0], ML + 4, iy, { width: sbW - 8, align: 'center' });
    doc.fillColor('#8B949E').fontSize(6).font('Helvetica').text(ic[1], ML + 4, iy + 19, { width: sbW - 8, align: 'center' });
});

// ── File Explorer ──
const feX = ML + sbW;
const feW = 130;
doc.rect(feX, edBodyY + tbH, feW, edH - 28 - tbH).fill('#0D1117');
doc.rect(feX, edBodyY + tbH, feW, 26).fill('#161B22');
doc.fillColor('#8B949E').fontSize(8).font('Helvetica-Bold').text('FILES', feX + 10, edBodyY + tbH + 9);
doc.fillColor('#3FB950').fontSize(8).text('+', feX + feW - 20, edBodyY + tbH + 9);
// File list
const files = ['📄 index.html', '🎨 style.css', '⚡ script.js', '📁 images/', '  📷 logo.png'];
files.forEach((f, i) => {
    const fy = edBodyY + tbH + 36 + i * 22;
    if (i === 0) doc.rect(feX, fy - 3, feW, 20).fill('#1C2128');
    doc.fillColor(i === 0 ? '#58A6FF' : '#8B949E').fontSize(8).font('Courier')
       .text(f, feX + 8, fy, { width: feW - 12 });
});

// ── Code Editor ──
const ceX = feX + feW;
const ceW = edW * 0.45;
doc.rect(ceX, edBodyY + tbH, ceW, edH - 28 - tbH).fill('#0D1117');
// Tab bar
doc.rect(ceX, edBodyY + tbH, ceW, 24).fill('#161B22');
doc.roundedRect(ceX + 4, edBodyY + tbH + 3, 72, 18, 2).fill('#0D1117');
doc.fillColor('#F0883E').fontSize(8).font('Helvetica').text('index.html  ×', ceX + 8, edBodyY + tbH + 8);
// Code lines
const codeLines = [
    { t: '<!DOCTYPE html>', c: '#8B949E' },
    { t: '<html lang="en">', c: '#58A6FF' },
    { t: '  <head>', c: '#58A6FF' },
    { t: '    <title>My App</title>', c: '#8B949E' },
    { t: '  </head>', c: '#58A6FF' },
    { t: '  <body>', c: '#58A6FF' },
    { t: '    <h1>Hello!</h1>', c: '#3FB950' },
    { t: '  </body>', c: '#58A6FF' },
    { t: '</html>', c: '#58A6FF' },
];
// Line numbers area
doc.rect(ceX, edBodyY + tbH + 24, 26, edH - 28 - tbH - 24).fill('#010409');
codeLines.forEach((l, i) => {
    const ly = edBodyY + tbH + 30 + i * 16;
    doc.fillColor('#4B5563').fontSize(7.5).font('Courier').text(String(i + 1), ceX + 4, ly, { width: 20, align: 'right' });
    doc.fillColor(l.c).fontSize(7.5).font('Courier').text(l.t, ceX + 30, ly, { width: ceW - 36 });
});
// Cursor
doc.rect(ceX + 30, edBodyY + tbH + 30 + 6 * 16 + 1, 1, 10).fill('#58A6FF');

// ── Preview / Console panel ──
const pvX = ceX + ceW;
const pvW = edW - sbW - feW - ceW;
doc.rect(pvX, edBodyY + tbH, pvW, edH - 28 - tbH).fill('#FAFAFA');
// Tabs
doc.rect(pvX, edBodyY + tbH, pvW, 24).fill('#F3F4F6');
['Preview', 'Console', 'Shell'].forEach((tab, i) => {
    const tx = pvX + 4 + i * (pvW / 3);
    if (i === 0) {
        doc.rect(tx, edBodyY + tbH, pvW / 3 - 2, 24).fill(WHITE);
        doc.fillColor(BLUE).fontSize(8).font('Helvetica-Bold').text(tab, tx, edBodyY + tbH + 8, { width: pvW / 3 - 2, align: 'center' });
    } else {
        doc.fillColor('#6B7280').fontSize(8).font('Helvetica').text(tab, tx, edBodyY + tbH + 8, { width: pvW / 3 - 2, align: 'center' });
    }
});
// Preview content
doc.fillColor(BODY).fontSize(12).font('Helvetica-Bold').text('Hello!', pvX + 10, edBodyY + tbH + 40);
doc.fillColor('#6B7280').fontSize(8).text('I built this myself.', pvX + 10, edBodyY + tbH + 58);

doc.y = edBodyY + edH + 8;

// ─── ANNOTATIONS on the diagram ───────────────────────────────────────────────
// A: Top toolbar
highlight(ML + edW - 285, edBodyY + 3, 242, 28, RED, 2);
arrow(ML + edW / 2, edBodyY - 20, ML + edW - 180, edBodyY + 3, RED, 2);
callout(ML + edW / 2 - 30, edBodyY - 32, 'A  TOP TOOLBAR', RED);

// B: File explorer
highlight(feX - 2, edBodyY + tbH - 2, feW + 4, 120, GREEN, 2);
arrow(ML - 5, edBodyY + tbH + 60, feX, edBodyY + tbH + 60, GREEN, 2);
callout(ML - 5, edBodyY + tbH + 45, 'B  FILE EXPLORER', GREEN);

// C: Code editor
highlight(ceX - 2, edBodyY + tbH - 2, ceW + 4, 120, BLUE, 2);
callout(ceX + ceW / 2 - 35, edBodyY + tbH + 130, 'C  CODE EDITOR', BLUE);
arrow(ceX + ceW / 2, edBodyY + tbH + 130, ceX + ceW / 2, edBodyY + tbH + 122, BLUE, 2);

// D: Preview
highlight(pvX - 2, edBodyY + tbH - 2, pvW + 4, 100, '#7C3AED', 2);
callout(pvX + pvW - 80, edBodyY + tbH + 110, 'D  PREVIEW', '#7C3AED');
arrow(pvX + pvW - 50, edBodyY + tbH + 110, pvX + pvW - 20, edBodyY + tbH + 100, '#7C3AED', 2);

// E: Run button
highlight(ML + edW - 104, edBodyY + 3, 62, 28, '#F59E0B', 2.5);
callout(ML + edW - 110, edBodyY + tbH + 20, 'E  RUN BUTTON ▶', '#F59E0B');
arrow(ML + edW - 82, edBodyY + tbH + 20, ML + edW - 82, edBodyY + 31, '#F59E0B', 2);

// F: Secrets icon
highlight(ML + 2, edBodyY + tbH + 14 + 2 * 46 - 4, 38, 36, RED, 2);
callout(ML + sbW + feW + 4, edBodyY + tbH + 14 + 2 * 46 - 2, 'F  SECRETS (🔒)', RED);
arrow(ML + sbW + 4, edBodyY + tbH + 14 + 2 * 46 + 14, ML + 38, edBodyY + tbH + 14 + 2 * 46 + 14, RED, 1.5);

// ─── Legend ───────────────────────────────────────────────────────────────────
need(90);
sectionTitle('Diagram Legend — What Each Letter Means');
const legend = [
    ['A', 'Top Toolbar', 'Contains the ▶ Run button, Deploy, Fork, and Share. Use ▶ Run to start your app every time you want to test it.', RED],
    ['B', 'File Explorer', 'Shows all your project files. Click any file to open it. Click + to create a new file or folder.', GREEN],
    ['C', 'Code Editor', 'Where you TYPE your code. Click inside and start writing. Has line numbers on the left.', BLUE],
    ['D', 'Preview / Console / Shell', 'THREE tabs: Preview = see your running app. Console = see printed output and errors. Shell = type commands.', '#7C3AED'],
    ['E', 'Run Button ▶', 'Click this (or press Ctrl + Enter) to RUN your project and see the result in the Preview tab.', '#F59E0B'],
    ['F', 'Secrets 🔒', 'Store passwords and API keys safely here — never put them in your code files.', RED],
];
legend.forEach(([letter, title, desc]) => {
    need(36);
    const ly = doc.y;
    doc.circle(ML + 10, ly + 10, 10).fill(BLUE);
    doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text(letter, ML, ly + 4, { width: 20, align: 'center' });
    doc.fillColor(BODY).fontSize(10.5).font('Helvetica-Bold').text(title, ML + 24, ly + 2, { width: 120 });
    doc.fillColor('#475569').fontSize(9.5).font('Helvetica').text(desc, ML + 24, ly + 16, { width: CW - 28 });
    doc.y = ly + 36;
});

// ─── CH 3: WRITE FIRST CODE ───────────────────────────────────────────────────
newPage(false);
chapterBanner(3, 'Write Your First HTML Page', 'Type your first code manually — every line explained');

sectionTitle('STEP 1 — Create a new project (Repl)');

para('Go to your Replit dashboard (click the Replit logo top-left). Then:');

// Dashboard mockup
need(280);
const dashY = doc.y;
doc.rect(ML, dashY, CW, 240).fill('#0D1117');
// Left sidebar
doc.rect(ML, dashY, 48, 240).fill('#010409');
doc.fillColor('#F78166').fontSize(18).text('⬡', ML + 8, dashY + 12);
doc.fillColor('#8B949E').fontSize(7).font('Helvetica').text('Home', ML + 4, dashY + 36, { width: 40, align: 'center' });
doc.fontSize(18).text('📁', ML + 8, dashY + 58);
doc.fontSize(7).text('My Repls', ML + 4, dashY + 82, { width: 40, align: 'center' });
// Main content
doc.rect(ML + 48, dashY, CW - 48, 40).fill('#161B22');
doc.fillColor('#F0F6FC').fontSize(11).font('Helvetica-Bold').text('Home', ML + 62, dashY + 13);
// Create button
const cbX = ML + CW - 135;
const cbY = dashY + 10;
doc.roundedRect(cbX, cbY, 88, 26, 5).fill(BLUE);
doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold').text('+ Create Repl', cbX + 8, cbY + 8);

// Existing repls
['my-first-website', 'trading-bot', 'portfolio-site'].forEach((name, i) => {
    const rx = ML + 56 + (i % 2) * (CW / 2 - 10);
    const ry = dashY + 56 + Math.floor(i / 1) * 50;
    doc.rect(rx, ry + i * 0, CW / 2 - 20, 40).fill('#161B22').stroke('#21262D');
    doc.fillColor('#58A6FF').fontSize(9).font('Helvetica-Bold').text(name, rx + 8, ry + i * 0 + 8, { width: CW / 2 - 30 });
    doc.fillColor('#8B949E').fontSize(7.5).text('HTML, CSS, JS', rx + 8, ry + i * 0 + 22, { width: CW / 2 - 30 });
});

// Annotate Create button
highlight(cbX - 2, cbY - 2, 92, 30, RED, 3);
arrow(cbX + 44, cbY + 55, cbX + 44, cbY + 30, RED, 2.5);
callout(cbX - 5, cbY + 58, 'Click + Create Repl here', RED);

doc.y = dashY + 246;

// Create Repl dialog mockup
need(300);
sectionTitle('STEP 2 — Choose your template');
para('A dialog box appears. Here is what it looks like and what to click:');

const dlgY = doc.y;
const dlgW = CW * 0.78;
const dlgX = ML + (CW - dlgW) / 2;
doc.rect(dlgX, dlgY, dlgW, 240).fill(WHITE).stroke('#E5E7EB');
// Shadow
doc.rect(dlgX + 3, dlgY + 3, dlgW, 240).fill('#00000015');
doc.rect(dlgX, dlgY, dlgW, 240).fill(WHITE).stroke('#E5E7EB');
// Header
doc.rect(dlgX, dlgY, dlgW, 40).fill('#F9FAFB');
doc.fillColor(BODY).fontSize(13).font('Helvetica-Bold').text('Create a Repl', dlgX + 16, dlgY + 12);
doc.fillColor('#9CA3AF').fontSize(16).text('×', dlgX + dlgW - 30, dlgY + 10);

// Search box
doc.rect(dlgX + 12, dlgY + 50, dlgW - 24, 28).fill('#F3F4F6').stroke('#D1D5DB');
doc.fillColor('#9CA3AF').fontSize(9).font('Helvetica').text('🔍  Search templates...', dlgX + 20, dlgY + 60);

// Template cards
const templates = [
    { name: 'HTML, CSS, JS', icon: '🌐', desc: 'Basic website — start here' },
    { name: 'Node.js', icon: '🟢', desc: 'Backend server' },
    { name: 'React', icon: '⚛️', desc: 'Modern web app' },
    { name: 'Python', icon: '🐍', desc: 'Scripts & data' },
];
templates.forEach((t, i) => {
    const tx = dlgX + 12 + (i % 2) * ((dlgW - 24) / 2 + 2);
    const ty = dlgY + 88 + Math.floor(i / 2) * 64;
    const tw = (dlgW - 28) / 2;
    doc.rect(tx, ty, tw, 54).fill(i === 0 ? LBLUE : WHITE).stroke(i === 0 ? BLUE : '#E5E7EB');
    doc.fontSize(18).text(t.icon, tx + 8, ty + 8);
    doc.fillColor(i === 0 ? BLUE : BODY).fontSize(9.5).font('Helvetica-Bold').text(t.name, tx + 36, ty + 12);
    doc.fillColor(i === 0 ? BLUE : MUTED).fontSize(8.5).font('Helvetica').text(t.desc, tx + 36, ty + 26);
});

// Title field
doc.rect(dlgX + 12, dlgY + 222, dlgW - 24, 0).fill(WHITE);

// Annotations
highlight(dlgX + 8, dlgY + 86, (dlgW - 28) / 2 + 4, 58, BLUE, 3);
callout(dlgX + dlgW - 90, dlgY + 210, '① Best for beginners', BLUE);
arrow(dlgX + dlgW - 90, dlgY + 218, dlgX + (dlgW - 28) / 2 / 2 + 12, dlgY + 144, BLUE, 2);

doc.y = dlgY + 250;

tipBox('💡', 'For your first project, choose "HTML, CSS, JS". It gives you a simple webpage — the best place to start. Later you can try React or Node.js.', LBLUE, BLUE);

// Title + Create
need(100);
sectionTitle('STEP 3 — Name your project and create it');
numberedStep(1, 'Type a project name', 'In the "Title" field at the bottom of the dialog, type a short name with no spaces — use hyphens instead. Example: my-first-app or portfolio-site');
numberedStep(2, 'Click "Create Repl"', 'The blue button at the bottom. Replit will set up your project in about 5 seconds and then open the editor automatically.');

// ─── CH 3 CONTINUED: WRITE CODE ───────────────────────────────────────────────
newPage(false);
chapterBanner(3, 'Write Your First Code', 'HTML → CSS → JavaScript, line by line');

sectionTitle('Open index.html and start typing');
para('In the File Explorer on the left, click "index.html" to open it. It may already have some starter code. SELECT ALL of it (Ctrl + A) and DELETE it. Then type this from scratch:');

codeBlock([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <title>My First App</title>',
    '    <link rel="stylesheet" href="style.css" />',
    '  </head>',
    '  <body>',
    '    <h1>Hello, World!</h1>',
    '    <p>This is my first app. I built it myself.</p>',
    '    <button id="myBtn">Click me</button>',
    '    <script src="script.js"></script>',
    '  </body>',
    '</html>',
], 'HTML');

tipBox('💡', 'After typing each line, press Ctrl + S to save. Then click ▶ Run. You should see "Hello, World!" in the Preview tab on the right.', LBLUE, BLUE);

sectionTitle('Create style.css — add colours and styling');
para('In the File Explorer, click the "+" icon → New File → type "style.css" → press Enter. Then type:');

codeBlock([
    '/* This file controls how your page looks */',
    'body {',
    '  font-family: Arial, sans-serif;',
    '  background-color: #0f172a;',
    '  color: #f1f5f9;',
    '  text-align: center;',
    '  padding: 60px 20px;',
    '}',
    '',
    'h1 {',
    '  font-size: 2.5rem;',
    '  color: #3b82f6;',
    '  margin-bottom: 16px;',
    '}',
    '',
    'p {',
    '  font-size: 1.1rem;',
    '  color: #94a3b8;',
    '}',
    '',
    '#myBtn {',
    '  background: #3b82f6;',
    '  color: white;',
    '  border: none;',
    '  padding: 12px 28px;',
    '  font-size: 1rem;',
    '  border-radius: 8px;',
    '  cursor: pointer;',
    '  margin-top: 20px;',
    '}',
    '',
    '#myBtn:hover {',
    '  background: #2563eb;',
    '}',
], 'CSS');

sectionTitle('Create script.js — add interactivity');
para('Click "+" → New File → type "script.js" → press Enter. Then type:');

codeBlock([
    '// Get a reference to the button',
    "const btn = document.getElementById('myBtn');",
    '',
    '// When the button is clicked, run this code',
    "btn.addEventListener('click', function () {",
    "  alert('You clicked the button! Great job!');",
    '});',
], 'JavaScript');

tipBox('✅', 'Save all files (Ctrl + S on each), then click ▶ Run. Your preview should show a dark page with a blue heading, a description, and a clickable blue button.', LGREEN, GREEN);

// ─── CH 5: FULL WEBSITE ───────────────────────────────────────────────────────
newPage(false);
chapterBanner(5, 'Build a Full Website', 'Landing page + Signup form + Login form — complete code');

sectionTitle('Part A — The Landing Page (Home page)');
para('A landing page is the first page visitors see. It has a navigation bar, a hero section (big headline), features, and a footer. Here is the complete code:');

sectionTitle('index.html — Complete Landing Page Structure');
codeBlock([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width" />',
    '  <title>MyApp — Build Your Future</title>',
    '  <link rel="stylesheet" href="style.css" />',
    '</head>',
    '<body>',
    '',
    '  <!-- NAVIGATION BAR -->',
    '  <nav class="navbar">',
    '    <div class="nav-logo">MyApp</div>',
    '    <ul class="nav-links">',
    '      <li><a href="#">Home</a></li>',
    '      <li><a href="#">Features</a></li>',
    '      <li><a href="#">Pricing</a></li>',
    '    </ul>',
    '    <div class="nav-buttons">',
    '      <a href="login.html" class="btn-outline">Log in</a>',
    '      <a href="signup.html" class="btn-primary">Sign up free</a>',
    '    </div>',
    '  </nav>',
    '',
    '  <!-- HERO SECTION -->',
    '  <section class="hero">',
    '    <h1>Build something <span class="highlight">amazing</span></h1>',
    '    <p>The simplest way to create, share, and deploy your app.</p>',
    '    <a href="signup.html" class="btn-primary btn-large">Get started — it\'s free</a>',
    '  </section>',
    '',
    '  <!-- FEATURES SECTION -->',
    '  <section class="features">',
    '    <div class="feature-card">',
    '      <div class="feature-icon">🚀</div>',
    '      <h3>Fast</h3>',
    '      <p>Deploy in seconds, not days.</p>',
    '    </div>',
    '    <div class="feature-card">',
    '      <div class="feature-icon">🔒</div>',
    '      <h3>Secure</h3>',
    '      <p>Your data is always safe.</p>',
    '    </div>',
    '    <div class="feature-card">',
    '      <div class="feature-icon">💡</div>',
    '      <h3>Simple</h3>',
    '      <p>Anyone can use it, no experience needed.</p>',
    '    </div>',
    '  </section>',
    '',
    '  <!-- FOOTER -->',
    '  <footer>',
    '    <p>© 2025 MyApp. Built on Replit.</p>',
    '  </footer>',
    '',
    '  <script src="script.js"></script>',
    '</body>',
    '</html>',
], 'HTML');

newPage(false);
sectionTitle('style.css — Landing Page Styles');

codeBlock([
    '/* ── Reset & base ──────────────────── */',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body { font-family: Arial, sans-serif; background: #fff; color: #1e293b; }',
    'a { text-decoration: none; }',
    '',
    '/* ── Buttons ───────────────────────── */',
    '.btn-primary {',
    '  background: #3b82f6; color: white; padding: 10px 22px;',
    '  border-radius: 8px; font-weight: bold; border: none; cursor: pointer;',
    '}',
    '.btn-outline {',
    '  border: 2px solid #3b82f6; color: #3b82f6; padding: 8px 20px;',
    '  border-radius: 8px; font-weight: bold;',
    '}',
    '.btn-large { padding: 16px 36px; font-size: 1.1rem; }',
    '',
    '/* ── Navbar ────────────────────────── */',
    '.navbar {',
    '  display: flex; align-items: center; justify-content: space-between;',
    '  padding: 18px 60px; border-bottom: 1px solid #e2e8f0;',
    '  position: sticky; top: 0; background: white; z-index: 100;',
    '}',
    '.nav-logo { font-size: 1.4rem; font-weight: 900; color: #3b82f6; }',
    '.nav-links { display: flex; gap: 32px; list-style: none; }',
    '.nav-links a { color: #475569; font-size: 0.95rem; }',
    '.nav-links a:hover { color: #3b82f6; }',
    '.nav-buttons { display: flex; gap: 12px; align-items: center; }',
    '',
    '/* ── Hero ──────────────────────────── */',
    '.hero {',
    '  text-align: center; padding: 100px 20px 80px;',
    '  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);',
    '}',
    '.hero h1 { font-size: 3rem; font-weight: 900; color: #0f172a; }',
    '.highlight { color: #3b82f6; }',
    '.hero p { font-size: 1.2rem; color: #64748b; margin: 20px 0 36px; }',
    '',
    '/* ── Features ──────────────────────── */',
    '.features {',
    '  display: flex; gap: 24px; justify-content: center;',
    '  padding: 80px 60px; flex-wrap: wrap;',
    '}',
    '.feature-card {',
    '  background: #f8fafc; border: 1px solid #e2e8f0;',
    '  border-radius: 16px; padding: 36px 28px; width: 240px; text-align: center;',
    '}',
    '.feature-icon { font-size: 2.5rem; margin-bottom: 16px; }',
    '.feature-card h3 { font-size: 1.2rem; margin-bottom: 8px; color: #0f172a; }',
    '.feature-card p { color: #64748b; font-size: 0.95rem; }',
    '',
    '/* ── Footer ────────────────────────── */',
    'footer {',
    '  text-align: center; padding: 40px; background: #f1f5f9;',
    '  color: #94a3b8; font-size: 0.9rem;',
    '}',
], 'CSS');

// ─── SIGNUP PAGE ──────────────────────────────────────────────────────────────
newPage(false);
chapterBanner(5, 'Part B — Signup & Login Pages', 'Create signup.html and login.html with working forms');

sectionTitle('signup.html — Complete Signup Page');

codeBlock([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <title>Sign up — MyApp</title>',
    '  <link rel="stylesheet" href="style.css" />',
    '  <link rel="stylesheet" href="auth.css" />',
    '</head>',
    '<body>',
    '  <div class="auth-container">',
    '    <div class="auth-card">',
    '      <div class="auth-logo">MyApp</div>',
    '      <h2>Create your account</h2>',
    '      <p class="auth-sub">Join thousands of builders today</p>',
    '',
    '      <form id="signupForm" class="auth-form">',
    '        <div class="form-group">',
    '          <label for="name">Full name</label>',
    '          <input type="text" id="name" placeholder="Charlie Johnson" required />',
    '        </div>',
    '        <div class="form-group">',
    '          <label for="email">Email address</label>',
    '          <input type="email" id="email" placeholder="charlie@example.com" required />',
    '        </div>',
    '        <div class="form-group">',
    '          <label for="password">Password</label>',
    '          <input type="password" id="password" placeholder="Min. 8 characters" required />',
    '        </div>',
    '        <button type="submit" class="btn-primary btn-full">Create account</button>',
    '      </form>',
    '',
    '      <p class="auth-footer">',
    '        Already have an account? <a href="login.html">Log in</a>',
    '      </p>',
    '    </div>',
    '  </div>',
    '  <script src="auth.js"></script>',
    '</body>',
    '</html>',
], 'HTML');

sectionTitle('login.html — Complete Login Page');

codeBlock([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <title>Log in — MyApp</title>',
    '  <link rel="stylesheet" href="style.css" />',
    '  <link rel="stylesheet" href="auth.css" />',
    '</head>',
    '<body>',
    '  <div class="auth-container">',
    '    <div class="auth-card">',
    '      <div class="auth-logo">MyApp</div>',
    '      <h2>Welcome back</h2>',
    '      <p class="auth-sub">Log in to your account</p>',
    '',
    '      <form id="loginForm" class="auth-form">',
    '        <div class="form-group">',
    '          <label for="email">Email address</label>',
    '          <input type="email" id="email" placeholder="charlie@example.com" required />',
    '        </div>',
    '        <div class="form-group">',
    '          <label for="password">Password</label>',
    '          <input type="password" id="password" placeholder="Your password" required />',
    '        </div>',
    '        <div class="form-extra">',
    '          <label><input type="checkbox" /> Remember me</label>',
    '          <a href="#">Forgot password?</a>',
    '        </div>',
    '        <button type="submit" class="btn-primary btn-full">Log in</button>',
    '      </form>',
    '',
    '      <p class="auth-footer">',
    "        Don't have an account? <a href=\"signup.html\">Sign up free</a>",
    '      </p>',
    '    </div>',
    '  </div>',
    '  <script src="auth.js"></script>',
    '</body>',
    '</html>',
], 'HTML');

newPage(false);
sectionTitle('auth.css — Styles for Signup and Login Pages');

codeBlock([
    '/* Shared styles for login.html and signup.html */',
    '.auth-container {',
    '  min-height: 100vh;',
    '  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);',
    '  display: flex;',
    '  align-items: center;',
    '  justify-content: center;',
    '  padding: 40px 20px;',
    '}',
    '',
    '.auth-card {',
    '  background: white;',
    '  border-radius: 20px;',
    '  padding: 48px 44px;',
    '  width: 100%;',
    '  max-width: 420px;',
    '  box-shadow: 0 20px 60px rgba(0,0,0,0.08);',
    '  text-align: center;',
    '}',
    '',
    '.auth-logo {',
    '  font-size: 1.6rem;',
    '  font-weight: 900;',
    '  color: #3b82f6;',
    '  margin-bottom: 24px;',
    '}',
    '',
    '.auth-card h2 {',
    '  font-size: 1.6rem;',
    '  font-weight: 800;',
    '  color: #0f172a;',
    '  margin-bottom: 8px;',
    '}',
    '',
    '.auth-sub {',
    '  color: #64748b;',
    '  margin-bottom: 32px;',
    '  font-size: 0.95rem;',
    '}',
    '',
    '.auth-form {',
    '  display: flex;',
    '  flex-direction: column;',
    '  gap: 20px;',
    '  text-align: left;',
    '}',
    '',
    '.form-group label {',
    '  display: block;',
    '  font-size: 0.875rem;',
    '  font-weight: 600;',
    '  color: #374151;',
    '  margin-bottom: 6px;',
    '}',
    '',
    '.form-group input {',
    '  width: 100%;',
    '  padding: 12px 16px;',
    '  border: 1.5px solid #d1d5db;',
    '  border-radius: 10px;',
    '  font-size: 0.95rem;',
    '  color: #1e293b;',
    '  outline: none;',
    '  transition: border-color 0.2s;',
    '}',
    '',
    '.form-group input:focus { border-color: #3b82f6; }',
    '',
    '.form-extra {',
    '  display: flex;',
    '  justify-content: space-between;',
    '  align-items: center;',
    '  font-size: 0.875rem;',
    '  color: #64748b;',
    '}',
    '.form-extra a { color: #3b82f6; }',
    '',
    '.btn-full { width: 100%; padding: 14px; font-size: 1rem; }',
    '',
    '.auth-footer {',
    '  margin-top: 24px;',
    '  font-size: 0.9rem;',
    '  color: #64748b;',
    '}',
    '.auth-footer a { color: #3b82f6; font-weight: 600; }',
], 'CSS');

sectionTitle('auth.js — Form Validation & Submission Logic');

codeBlock([
    '// ── Signup form logic ──────────────────────',
    "const signupForm = document.getElementById('signupForm');",
    "const loginForm  = document.getElementById('loginForm');",
    '',
    'if (signupForm) {',
    "  signupForm.addEventListener('submit', function (e) {",
    '    e.preventDefault();  // stop page from reloading',
    '',
    "    const name     = document.getElementById('name').value;",
    "    const email    = document.getElementById('email').value;",
    "    const password = document.getElementById('password').value;",
    '',
    '    // Basic validation',
    '    if (password.length < 8) {',
    "      alert('Password must be at least 8 characters.');",
    '      return;',
    '    }',
    '',
    '    // In a real app you would send this to a server.',
    '    // For now we just show a success message:',
    "    alert('Account created! Welcome, ' + name + '!');",
    "    window.location.href = 'login.html';",
    '  });',
    '}',
    '',
    '// ── Login form logic ────────────────────────',
    'if (loginForm) {',
    "  loginForm.addEventListener('submit', function (e) {",
    '    e.preventDefault();',
    '',
    "    const email    = document.getElementById('email').value;",
    "    const password = document.getElementById('password').value;",
    '',
    '    // In a real app: check credentials against a database.',
    '    // For now, accept any email + password:',
    "    alert('Logged in as ' + email + '! Redirecting...');",
    "    window.location.href = 'index.html';",
    '  });',
    '}',
], 'JavaScript');

tipBox('📁', 'Your project should now have these files:\n  index.html  →  landing page\n  signup.html  →  create account page\n  login.html  →  login page\n  style.css   →  shared styles\n  auth.css    →  form styles\n  auth.js     →  form logic\n  script.js   →  landing page scripts', LYELL, YELL);

// ─── CH 6: REACT ─────────────────────────────────────────────────────────────
newPage(false);
chapterBanner(6, 'React — Build a Modern Web App', 'Components, state, and a complete React project');

sectionTitle('What is React and why use it?');
para('React is a JavaScript library that makes building complex web apps much easier. Instead of writing one giant HTML file, you split your app into small reusable pieces called "components". Think of components like LEGO blocks — each one does one job, and you connect them together to build your app.');

// React vs HTML comparison diagram
need(120);
const rcY = doc.y;
// Left: HTML approach
doc.rect(ML, rcY, CW / 2 - 10, 100).fill('#FEF2F2');
doc.rect(ML, rcY, CW / 2 - 10, 24).fill('#DC2626');
doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text('❌  Plain HTML Approach', ML + 8, rcY + 7);
doc.fillColor(BODY).fontSize(9.5).font('Helvetica')
   .text('• ONE big index.html file\n• Copy-paste nav bar on every page\n• Update one thing → edit every page\n• Gets messy after 5 pages', ML + 12, rcY + 32, { lineGap: 4 });

// Right: React approach
const rcRX = ML + CW / 2 + 10;
doc.rect(rcRX, rcY, CW / 2 - 10, 100).fill(LGREEN);
doc.rect(rcRX, rcY, CW / 2 - 10, 24).fill(GREEN);
doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text('✅  React Approach', rcRX + 8, rcY + 7);
doc.fillColor(BODY).fontSize(9.5).font('Helvetica')
   .text('• <Navbar /> component used everywhere\n• Change Navbar once → updates everywhere\n• Easy to scale to 100+ pages\n• Industry standard for modern apps', rcRX + 12, rcY + 32, { lineGap: 4 });
doc.y = rcY + 110;

sectionTitle('Create a React Project on Replit');
numberedStep(1, 'Create a new Repl', 'Go to your dashboard, click "+ Create Repl".');
numberedStep(2, 'Choose the React template', 'In the search box type "React" and select "React" or "React + Vite".');
numberedStep(3, 'Name it and click Create', 'Example name: "my-react-app". Click "Create Repl".');
numberedStep(4, 'Click ▶ Run', 'Replit installs all dependencies automatically (this takes ~30 seconds the first time). A default React page appears in the Preview.');

sectionTitle('React Project File Structure');
codeBlock([
    'my-react-app/',
    '├── src/',
    '│   ├── main.jsx         ← Entry point (DO NOT delete)',
    '│   ├── App.jsx          ← Your main component (start here)',
    '│   ├── App.css          ← Styles for App',
    '│   └── components/      ← Put your own components here',
    '│       ├── Navbar.jsx',
    '│       ├── Hero.jsx',
    '│       └── Footer.jsx',
    '├── public/',
    '│   └── index.html       ← Base HTML (leave this as-is)',
    '├── package.json         ← Project config',
    '└── vite.config.js       ← Build tool (leave this as-is)',
], 'Project Structure');

sectionTitle('Your First React Component — App.jsx');
para('Open src/App.jsx. Delete everything. Type this:');

codeBlock([
    "import { useState } from 'react';",
    "import './App.css';",
    '',
    '// This is the main App component',
    'function App() {',
    '  // useState creates a variable React watches.',
    '  // When count changes, React re-draws the page automatically.',
    '  const [count, setCount] = useState(0);',
    "  const [name,  setName]  = useState('');",
    '',
    '  return (',
    '    <div className="container">',
    '      <h1>My React App</h1>',
    '',
    '      {/* Counter section */}',
    '      <div className="card">',
    '        <p>Count: <strong>{count}</strong></p>',
    '        <button onClick={() => setCount(count + 1)}>+ Add 1</button>',
    '        <button onClick={() => setCount(0)}>Reset</button>',
    '      </div>',
    '',
    '      {/* Name input section */}',
    '      <div className="card">',
    '        <input',
    "          type='text'",
    "          placeholder='Type your name...'",
    '          value={name}',
    '          onChange={(e) => setName(e.target.value)}',
    '        />',
    '        {name && <p>Hello, {name}! 👋</p>}',
    '      </div>',
    '    </div>',
    '  );',
    '}',
    '',
    'export default App;',
], 'React JSX');

sectionTitle('5 React Rules Every Beginner Must Know');
bullets([
    'Component names MUST start with a CAPITAL letter: function Navbar() {}  ←  correct    function navbar() {}  ←  WRONG',
    'Every component must return ONE parent element. Wrap multiple elements in <div> or use the empty shorthand <> ... </>',
    'Use {curly braces} to put JavaScript values inside JSX: <h1>{userName}</h1> or <p>Count: {count}</p>',
    'Never modify state directly. Always use the setter function: setCount(count + 1)  ←  correct    count = count + 1  ←  WRONG',
    'Event handlers use camelCase: onClick, onChange, onSubmit — NOT onclick or on-click',
]);

// ─── CH 7: SECRETS ───────────────────────────────────────────────────────────
newPage(false);
chapterBanner(7, 'Secrets & Environment Variables', 'Keep passwords and API keys safe — never in your code');

sectionTitle('What are Environment Variables?');
para('Imagine your app needs an API key to talk to a weather service. The wrong way is to paste that key directly in your code — if your project is public on GitHub, ANYONE can steal it and run up charges on your account. The right way is to store it as a "Secret" — encrypted, outside your code.');

tipBox('⛔', 'NEVER do this in your code: const apiKey = "sk-abc123realkey"; — This is visible to anyone who views your code. Use Secrets instead.', LRED, RED);

sectionTitle('How to Add a Secret in Replit — Step by Step');

// Annotated Secrets panel mockup
need(320);
const spY = doc.y;
const spW = CW * 0.68;
const spX = ML + (CW - spW) / 2;

doc.rect(spX, spY, spW, 280).fill('#0D1117');
// Header
doc.rect(spX, spY, spW, 40).fill('#161B22');
doc.fontSize(16).text('🔒', spX + 14, spY + 12);
doc.fillColor('#F0F6FC').fontSize(11).font('Helvetica-Bold').text('Secrets', spX + 40, spY + 14);

// Existing secret
const esY = spY + 52;
doc.rect(spX + 12, esY, spW - 24, 44).fill('#21262D');
doc.rect(spX + 12, esY, 4, 44).fill(GREEN);
doc.fillColor('#3FB950').fontSize(9).font('Courier-Bold').text('MY_API_KEY', spX + 22, esY + 10);
doc.fillColor('#8B949E').fontSize(8).font('Courier').text('••••••••••••••••', spX + 22, esY + 26);
doc.fillColor('#8B949E').fontSize(8).font('Helvetica').text('Added today', spX + spW - 80, esY + 18);

// New secret form
const nsY = esY + 60;
doc.rect(spX + 12, nsY, spW - 24, 24).fill('#21262D').stroke('#30363D');
doc.fillColor('#8B949E').fontSize(9).font('Helvetica').text('Key (e.g. MY_API_KEY)', spX + 20, nsY + 7);

doc.rect(spX + 12, nsY + 32, spW - 24, 24).fill('#21262D').stroke('#30363D');
doc.fillColor('#8B949E').fontSize(9).text('Value (e.g. sk-abc123...)', spX + 20, nsY + 39);

// Add button
doc.roundedRect(spX + 12, nsY + 64, spW - 24, 28, 5).fill(BLUE);
doc.fillColor(WHITE).fontSize(10).font('Helvetica-Bold').text('+ Add Secret', spX + 12, nsY + 72, { width: spW - 24, align: 'center' });

// Annotations
highlight(spX + 8, esY - 4, spW - 16, 52, GREEN, 2.5);
callout(spX + spW + 5, esY + 10, 'Existing secret', GREEN);
arrow(spX + spW + 5, esY + 18, spX + spW - 4, esY + 18, GREEN, 1.5);

highlight(spX + 8, nsY - 4, spW - 16, 32, BLUE, 2.5);
callout(spX + spW + 5, nsY + 6, '① Type the name here', BLUE);
arrow(spX + spW + 5, nsY + 14, spX + spW - 4, nsY + 14, BLUE, 1.5);

highlight(spX + 8, nsY + 28, spW - 16, 32, '#F59E0B', 2.5);
callout(spX + spW + 5, nsY + 38, '② Paste value here', '#F59E0B');
arrow(spX + spW + 5, nsY + 46, spX + spW - 4, nsY + 46, '#F59E0B', 1.5);

highlight(spX + 8, nsY + 60, spW - 16, 36, RED, 2.5);
callout(spX + spW + 5, nsY + 68, '③ Click to save', RED);
arrow(spX + spW + 5, nsY + 76, spX + spW - 4, nsY + 76, RED, 1.5);

doc.y = spY + 292;

sectionTitle('How to Access Secrets in Your Code');
h2('In JavaScript (Node.js or React):');
codeBlock([
    '// Access the secret — process.env reads from Replit Secrets',
    'const myApiKey = process.env.MY_API_KEY;',
    "console.log('Key loaded:', myApiKey ? 'YES' : 'NO');",
    '',
    '// Use it in a fetch call:',
    "fetch('https://api.example.com/data', {",
    '  headers: {',
    "    'Authorization': 'Bearer ' + myApiKey",
    '  }',
    '})',
], 'JavaScript');

h2('In Python:');
codeBlock([
    'import os',
    '',
    '# os.environ.get() reads from Replit Secrets',
    "my_api_key = os.environ.get('MY_API_KEY')",
    "print('Key loaded:', 'YES' if my_api_key else 'NO')",
], 'Python');

// ─── CH 8: DEPLOY ─────────────────────────────────────────────────────────────
newPage(false);
chapterBanner(8, 'Deploy Your App Live', 'Make your app accessible to anyone, anywhere in the world');

sectionTitle('What "Deploying" means');
para('Right now your app only runs INSIDE Replit — it stops when you close your browser. Deploying means putting your app on a permanent server so it runs 24/7 and has a real URL like "https://myapp.username.repl.co" that anyone can visit.');

sectionTitle('Deploy with Replit — Step by Step');

// Deploy panel mockup
need(320);
const dpY = doc.y;
const dpW = CW * 0.72;
const dpX = ML + (CW - dpW) / 2;
browserChrome(dpX, dpY, dpW, 'replit.com/@you/my-first-app');
const dpBY = dpY + 28;
doc.rect(dpX, dpBY, dpW, 280).fill('#0D1117');

// Toolbar
doc.rect(dpX, dpBY, dpW, 34).fill('#161B22');
doc.roundedRect(dpX + dpW - 100, dpBY + 7, 55, 20, 4).fill('#238636');
doc.fillColor(WHITE).fontSize(8.5).font('Helvetica-Bold').text('▶  Run', dpX + dpW - 96, dpBY + 12);
doc.roundedRect(dpX + dpW - 162, dpBY + 7, 54, 20, 4).fill(BLUE);
doc.fillColor(WHITE).fontSize(8.5).font('Helvetica-Bold').text('⬆ Deploy', dpX + dpW - 157, dpBY + 12);

// Deploy panel content
doc.rect(dpX + dpW * 0.45, dpBY + 34, dpW * 0.55, 246).fill('#161B22');
doc.fillColor('#F0F6FC').fontSize(11).font('Helvetica-Bold').text('Deploy your app', dpX + dpW * 0.45 + 12, dpBY + 46);
doc.fillColor('#8B949E').fontSize(8.5).font('Helvetica').text('Publish to the internet', dpX + dpW * 0.45 + 12, dpBY + 62);

// Deployment type options
const dtY = dpBY + 78;
doc.rect(dpX + dpW * 0.45 + 12, dtY, (dpW * 0.55 - 24) / 2 - 4, 52).fill('#21262D').stroke(BLUE);
doc.fillColor('#58A6FF').fontSize(8.5).font('Helvetica-Bold').text('Autoscale', dpX + dpW * 0.45 + 18, dtY + 8);
doc.fillColor('#8B949E').fontSize(7.5).font('Helvetica').text('Scales automatically.\nBest for web apps.', dpX + dpW * 0.45 + 18, dtY + 22, { lineGap: 2 });

doc.rect(dpX + dpW * 0.45 + 12 + (dpW * 0.55 - 24) / 2, dtY, (dpW * 0.55 - 24) / 2 - 4, 52).fill('#21262D').stroke('#30363D');
doc.fillColor('#8B949E').fontSize(8.5).font('Helvetica-Bold').text('Static', dpX + dpW * 0.45 + 12 + (dpW * 0.55 - 24) / 2 + 6, dtY + 8);
doc.fillColor('#8B949E').fontSize(7.5).font('Helvetica').text('For HTML/CSS/JS\nwithout a server.', dpX + dpW * 0.45 + 12 + (dpW * 0.55 - 24) / 2 + 6, dtY + 22, { lineGap: 2 });

// Run command field
const rcfY = dtY + 60;
doc.fillColor('#8B949E').fontSize(7.5).font('Helvetica').text('RUN COMMAND', dpX + dpW * 0.45 + 12, rcfY);
doc.rect(dpX + dpW * 0.45 + 12, rcfY + 12, dpW * 0.55 - 24, 22).fill('#21262D').stroke('#30363D');
doc.fillColor('#3FB950').fontSize(8.5).font('Courier').text('npm run start', dpX + dpW * 0.45 + 18, rcfY + 18);

// Deploy button
doc.roundedRect(dpX + dpW * 0.45 + 12, rcfY + 44, dpW * 0.55 - 24, 28, 5).fill(BLUE);
doc.fillColor(WHITE).fontSize(9).font('Helvetica-Bold').text('Deploy →', dpX + dpW * 0.45 + 12, rcfY + 50, { width: dpW * 0.55 - 24, align: 'center' });

// Live URL result
const luY = rcfY + 82;
doc.rect(dpX + dpW * 0.45 + 12, luY, dpW * 0.55 - 24, 34).fill('#0D1117').stroke('#238636');
doc.circle(dpX + dpW * 0.45 + 22, luY + 10, 5).fill(GREEN);
doc.fillColor('#3FB950').fontSize(7.5).font('Helvetica-Bold').text('DEPLOYED', dpX + dpW * 0.45 + 30, luY + 7);
doc.fillColor('#58A6FF').fontSize(7).font('Courier').text('https://my-app.you.repl.co', dpX + dpW * 0.45 + 18, luY + 20);

// Annotations
highlight(dpX + dpW - 166, dpBY + 3, 62, 28, RED, 3);
arrow(dpX + dpW * 0.45 - 30, dpBY + 80, dpX + dpW - 140, dpBY + 17, RED, 2);
callout(dpX + dpW * 0.45 - 90, dpBY + 68, '① Click Deploy button', RED);

highlight(dpX + dpW * 0.45 + 8, dtY - 4, (dpW * 0.55 - 24) / 2 + 2, 60, BLUE, 2);
callout(dpX + dpW * 0.45 - 90, dtY + 14, '② Choose Autoscale', BLUE);
arrow(dpX + dpW * 0.45 - 4, dtY + 22, dpX + dpW * 0.45 + 8, dtY + 22, BLUE, 1.5);

highlight(dpX + dpW * 0.45 + 8, rcfY + 40, dpW * 0.55 - 20, 36, GREEN, 2);
callout(dpX + dpW * 0.45 - 90, rcfY + 50, '③ Click Deploy!', GREEN);
arrow(dpX + dpW * 0.45 - 4, rcfY + 58, dpX + dpW * 0.45 + 8, rcfY + 58, GREEN, 1.5);

doc.y = dpY + 322;

numberedStep(1, 'Click the "Deploy" button', 'Find the blue Deploy button in the top toolbar (highlighted above with the red box).');
numberedStep(2, 'Choose "Autoscale"', 'For most web apps, pick Autoscale. For plain HTML/CSS/JS sites with no server, pick Static.');
numberedStep(3, 'Set the run command', 'Type the command that starts your app. For Node.js: "npm run start". For React + Vite: "npm run preview".');
numberedStep(4, 'Click the blue Deploy button', 'Wait 1–3 minutes. When it says "DEPLOYED" in green, your app is live!');
numberedStep(5, 'Copy your URL', 'Replit gives you a live URL. Click it to see your app. Share it with anyone!');

// ─── CH 9: SHORTCUTS ─────────────────────────────────────────────────────────
newPage(false);
chapterBanner(9, 'Keyboard Shortcuts Cheat Sheet', 'Work faster — memorise these and you\'ll save hours every week');

sectionTitle('Editor Shortcuts');

const shortcuts = [
    ['Ctrl + S', 'SAVE the current file', 'Use constantly — save after every few lines you write'],
    ['Ctrl + Z', 'UNDO the last change', 'Accidentally deleted something? Press this immediately'],
    ['Ctrl + Y', 'REDO (un-undo)', 'Undo too many times? This brings changes back'],
    ['Ctrl + A', 'SELECT ALL text', 'Select everything in the current file'],
    ['Ctrl + C', 'COPY selected text', 'Select text first with mouse, then copy'],
    ['Ctrl + X', 'CUT selected text', 'Like copy but removes the original'],
    ['Ctrl + V', 'PASTE', 'Paste copied/cut text at cursor position'],
    ['Ctrl + F', 'FIND text in file', 'Opens a search box — type what you are looking for'],
    ['Ctrl + H', 'FIND AND REPLACE', 'Change all occurrences of a word at once'],
    ['Ctrl + /', 'COMMENT / UNCOMMENT', 'Disables or re-enables selected lines of code'],
    ['Ctrl + D', 'Select next match', 'Highlight a word, press Ctrl+D to select the next same word'],
    ['Ctrl + Enter', 'RUN the project', 'Same as clicking the ▶ Run button'],
    ['Tab', 'INDENT right', 'Moves selected lines right (add spaces)'],
    ['Shift + Tab', 'INDENT left', 'Moves selected lines left (remove spaces)'],
    ['Alt + ↑ / ↓', 'MOVE LINE up/down', 'Move the current line up or down'],
    ['Ctrl + Shift + P', 'COMMAND PALETTE', 'Search for any editor command by name'],
];

shortcuts.forEach((s, i) => {
    need(28);
    const ky = doc.y;
    doc.rect(ML, ky, CW, 24).fill(i % 2 === 0 ? '#F8FAFC' : WHITE);
    // Key badge
    doc.roundedRect(ML + 4, ky + 4, 130, 16, 3).fill(DARK);
    doc.fillColor('#86EFAC').fontSize(8.5).font('Courier-Bold').text(s[0], ML + 8, ky + 7, { width: 124 });
    // Action
    doc.fillColor(BLUE).fontSize(9.5).font('Helvetica-Bold').text(s[1], ML + 142, ky + 6, { width: 120 });
    // Description
    doc.fillColor(MUTED).fontSize(8.5).font('Helvetica').text(s[2], ML + 268, ky + 6, { width: CW - 272 });
    doc.y = ky + 24;
});

doc.moveDown(0.5);
sectionTitle('Shell Tab Commands — Must Know');

const cmds = [
    ['node --version', 'Check which version of Node.js is installed'],
    ['npm install', 'Install all packages listed in package.json'],
    ['npm install express', 'Install a specific package called "express"'],
    ['npm run dev', 'Start the development server (hot-reload enabled)'],
    ['npm run build', 'Build/compile the app for production deployment'],
    ['npm run start', 'Run the production-ready app'],
    ['ls', 'List all files and folders in the current directory'],
    ['cd foldername', 'Enter a folder called "foldername"'],
    ['cd ..', 'Go back up one folder level'],
    ['mkdir foldername', 'Create a new folder'],
    ['touch filename.js', 'Create a new empty file'],
    ['clear', 'Clear the shell screen (just visual — does not delete anything)'],
];

cmds.forEach(([cmd, desc]) => {
    need(32);
    const cy = doc.y;
    doc.rect(ML, cy, 170, 24).fill(SHELL);
    doc.rect(ML, cy, 4, 24).fill(BLUE);
    doc.fillColor('#F0883E').fontSize(9).font('Courier').text('$', ML + 8, cy + 7);
    doc.fillColor(SHELLG).fontSize(9).font('Courier').text(cmd, ML + 20, cy + 7, { width: 148 });
    doc.fillColor(BODY).fontSize(9.5).font('Helvetica').text(desc, ML + 178, cy + 7, { width: CW - 182 });
    doc.y = cy + 28;
});

// ─── CH 10: ERRORS ───────────────────────────────────────────────────────────
newPage(false);
chapterBanner(10, 'Common Errors & How to Fix Them', 'Read the error message — it is telling you exactly what is wrong');

sectionTitle('How to Read an Error Message');
para('When something goes wrong, Replit shows the error in the CONSOLE tab (right panel). The error always has three parts:');

need(90);
const errY = doc.y;
doc.rect(ML, errY, CW, 76).fill(SHELL);
doc.rect(ML, errY, 4, 76).fill(RED);
doc.fillColor('#F85149').fontSize(10).font('Courier-Bold')
   .text('ReferenceError: myVariable is not defined', ML + 12, errY + 10);
doc.fillColor('#8B949E').fontSize(9).font('Courier')
   .text('    at script.js:14:5', ML + 12, errY + 28);
doc.fillColor('#6E7681').fontSize(8.5).font('Helvetica')
   .text('    at HTMLButtonElement.onclick (index.html:12)', ML + 12, errY + 44);

// Annotations
arrow(ML + CW - 50, errY + 14, ML + CW * 0.82, errY + 14, RED, 1.5);
callout(ML + CW - 48, errY + 8, 'Error type + message', RED);
arrow(ML + CW - 50, errY + 32, ML + CW * 0.6, errY + 32, YELL, 1.5);
callout(ML + CW - 48, errY + 26, 'File name + line number', YELL);

doc.y = errY + 82;
para('Read "ReferenceError" → tells you the TYPE of error. Read "not defined" → tells you THE PROBLEM. Read "script.js:14" → tells you THE EXACT LINE to fix.');

sectionTitle('The Most Common Errors');

const errors = [
    {
        name: 'ReferenceError: X is not defined',
        cause: 'You used a variable before declaring it, or misspelled the name.',
        bad:  "console.log(myNmae);  // typo in the name",
        good: "const myName = 'Charlie';\nconsole.log(myName);",
    },
    {
        name: 'SyntaxError: Unexpected token',
        cause: 'Missing bracket, parenthesis, or comma. Look at the line number and check for missing { } ( ) [ ] , or "',
        bad:  'function greet( {\n  return "hello";\n}  // missing ) after (',
        good: "function greet() {\n  return 'hello';\n}",
    },
    {
        name: "TypeError: Cannot read properties of undefined (reading 'name')",
        cause: 'You are trying to use .name on a variable that has no value yet. Check the variable exists first.',
        bad:  'console.log(user.name);  // user might be undefined',
        good: "if (user && user.name) {\n  console.log(user.name);  // safe\n}",
    },
    {
        name: "Cannot find module 'express'",
        cause: 'You imported a package but forgot to install it first.',
        bad:  "const express = require('express');  // crashes if not installed",
        good: '// In the Shell tab, first run:\n// $ npm install express\n// THEN use require()',
    },
];

errors.forEach(err => {
    need(140);
    const ey = doc.y;
    doc.rect(ML, ey, CW, 28).fill(LRED);
    doc.rect(ML, ey, 4, 28).fill(RED);
    doc.fillColor(RED).fontSize(10).font('Courier-Bold').text(err.name, ML + 12, ey + 9, { width: CW - 16 });
    doc.y = ey + 32;
    doc.fillColor(BODY).fontSize(10).font('Helvetica').text('Cause: ' + err.cause, ML + 4, doc.y, { width: CW - 8, lineGap: 2 });
    doc.moveDown(0.3);
    // Bad code
    doc.fillColor(RED).fontSize(8.5).font('Helvetica-Bold').text('❌ WRONG', ML + 4, doc.y);
    doc.y += 12;
    const badLines = err.bad.split('\n');
    const badH = badLines.length * 14 + 10;
    doc.rect(ML, doc.y, CW / 2 - 6, badH).fill(SHELL);
    doc.fillColor('#F85149').fontSize(8.5).font('Courier').text(err.bad, ML + 8, doc.y + 6, { width: CW / 2 - 18, lineGap: 3 });
    const savedY = doc.y;
    // Good code
    doc.fillColor(GREEN).fontSize(8.5).font('Helvetica-Bold').text('✅ FIX', ML + CW / 2 + 8, savedY - 12);
    doc.rect(ML + CW / 2 + 6, savedY, CW / 2 - 6, badH).fill(SHELL);
    doc.fillColor(SHELLG).fontSize(8.5).font('Courier').text(err.good, ML + CW / 2 + 14, savedY + 6, { width: CW / 2 - 22, lineGap: 3 });
    doc.y = savedY + badH + 8;
    doc.moveDown(0.3);
});

sectionTitle('Quick Fix Checklist for Any Error');
bullets([
    'Preview is blank → Open the Console tab and read the red error message',
    'App not updating after edit → Press Ctrl + S to save, then click ▶ Run again',
    '"command not found: node" → Your project might be Python-based; use python instead of node',
    'Packages seem broken or missing → Open Shell and run: npm install',
    '"Permission denied" in Shell → Add sudo before the command: sudo npm install -g nodemon',
    'Changes not saving → Check you are editing the right file (look at the tab name at the top)',
    'Error on line X → Click on the line number in the Console to jump to that line in the editor',
]);

// ─── BACK COVER ───────────────────────────────────────────────────────────────
doc.addPage({ size: 'A4', margin: 0 });
doc.rect(0, 0, PW, PH).fill(DARK);
doc.rect(0, 0, PW, 6).fill(BLUE);

doc.fillColor(BLUE).fontSize(11).font('Helvetica-Bold')
   .text('YOU ARE READY TO BUILD', ML, 220, { width: CW, align: 'center', characterSpacing: 3 });
doc.fillColor(WHITE).fontSize(36).font('Helvetica-Bold')
   .text("Now go build something! 🚀", ML, 248, { width: CW, align: 'center' });
doc.fillColor('#94A3B8').fontSize(13).font('Helvetica')
   .text("Every great developer started exactly where you are now.\nYou have the code. You have the guide. Just start typing.", ML, 310, { width: CW, align: 'center', lineGap: 6 });

// Summary of what was covered
doc.rect(ML, 390, CW, 300).fill('#112240');
doc.fillColor('#93C5FD').fontSize(11).font('Helvetica-Bold').text('What you now know how to do:', ML + 20, 408);
const summary = [
    '✅  Create a Replit account and your first project',
    '✅  Navigate the editor — files, code, preview, shell',
    '✅  Write HTML, CSS, and JavaScript from scratch',
    '✅  Build a full landing page with navbar, hero, and features',
    '✅  Create a signup page and a login page with working forms',
    '✅  Install packages with npm install',
    '✅  Build a React app with components and useState',
    '✅  Keep API keys safe using Replit Secrets',
    '✅  Deploy your app live so anyone can visit it',
    '✅  Read and fix error messages',
];
summary.forEach((item, i) => {
    doc.fillColor(i < 5 ? WHITE : '#BFDBFE').fontSize(10.5).font('Helvetica')
       .text(item, ML + 20, 432 + i * 24);
});

doc.fillColor('#475569').fontSize(9).font('Helvetica')
   .text('replit.com  ·  Complete Visual Beginner\'s Guide', ML, PH - 30, { width: CW, align: 'center' });

doc.end();
doc.on('end', () => {
    const stats = fs.statSync(OUT);
    console.log('✅ PDF generated: ' + OUT);
    console.log('   Size: ' + (stats.size / 1024).toFixed(0) + ' KB');
});
