/**
 * Replit Beginner's Guide — Clean A4 PDF, no blank pages, no dark backgrounds
 */
'use strict';
const PDFDocument = require('pdfkit');
const fs          = require('fs');

const OUT = '/home/runner/workspace/Replit-Beginners-Guide.pdf';
const SS  = '/home/runner/workspace/attached_assets/screenshots/replit_com.png';

const doc = new PDFDocument({ size: 'A4', margin: 0, autoFirstPage: false,
    info: { Title: 'Build Your App on Replit — Complete Visual Guide' } });
doc.pipe(fs.createWriteStream(OUT));

// ── page geometry ─────────────────────────────────────────────────────────────
const PW = 595.28, PH = 841.89;
const L = 44, R = 44, T = 50;           // left/right/top margins
const CW = PW - L - R;                   // content width  = 507.28

// ── palette ───────────────────────────────────────────────────────────────────
const B   = '#2563EB';   // blue
const LB  = '#EFF6FF';   // light blue bg
const DK  = '#0F172A';   // dark text
const MID = '#475569';   // body text
const GR  = '#16A34A';   // green
const LG  = '#F0FDF4';   // light green bg
const RD  = '#DC2626';   // red
const LR  = '#FEF2F2';   // light red bg
const YL  = '#D97706';   // yellow/amber
const LY  = '#FFFBEB';   // light yellow bg
const WH  = '#FFFFFF';
const SH  = '#0D1117';   // shell dark

// ── state ─────────────────────────────────────────────────────────────────────
let curY = T;

function Y() { return curY; }
function setY(v) { curY = v; }
function advY(v) { curY += v; }

// ── page management ───────────────────────────────────────────────────────────
function addPage() {
    doc.addPage({ size: 'A4', margin: 0 });
    // White background always
    doc.rect(0, 0, PW, PH).fill(WH);
    setY(T);
}

// Ensure `h` pts fit on page; add new page if not
function need(h) {
    if (Y() + h > PH - 44) {
        addPage();
    }
}

// ── drawing primitives ────────────────────────────────────────────────────────
function arrow(x1, y1, x2, y2, col, w) {
    col = col || RD; w = w || 2;
    const a = Math.atan2(y2 - y1, x2 - x1), hs = 9;
    doc.save()
       .strokeColor(col).lineWidth(w)
       .moveTo(x1, y1).lineTo(x2, y2).stroke()
       .fillColor(col)
       .moveTo(x2, y2)
       .lineTo(x2 - hs * Math.cos(a - 0.38), y2 - hs * Math.sin(a - 0.38))
       .lineTo(x2 - hs * Math.cos(a + 0.38), y2 - hs * Math.sin(a + 0.38))
       .fill()
       .restore();
}

function box(x, y, w, h, fill, stroke, r) {
    r = r || 0;
    doc.save().roundedRect(x, y, w, h, r);
    if (fill)  doc.fill(fill);
    if (stroke) doc.roundedRect(x, y, w, h, r).stroke(stroke);
    doc.restore();
}

function badge(x, y, txt, bg, fg) {
    bg = bg || RD; fg = fg || WH;
    const tw = doc.widthOfString(txt, { fontSize: 8.5, font: 'Helvetica-Bold' }) + 14;
    box(x, y, tw, 18, bg, null, 4);
    doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(fg).text(txt, x + 7, y + 5).restore();
    return tw;
}

function calloutBox(x, y, txt, bg, fg) {
    bg = bg || RD; fg = fg || WH;
    const tw = doc.widthOfString(txt, { fontSize: 9, font: 'Helvetica-Bold' }) + 16;
    box(x, y, tw, 20, bg, null, 5);
    doc.save().font('Helvetica-Bold').fontSize(9).fillColor(fg).text(txt, x + 8, y + 6).restore();
    return tw;
}

// ── typography ────────────────────────────────────────────────────────────────
function pageHeader(chapNum, title, sub, col) {
    col = col || B;
    // Coloured strip top
    doc.rect(0, 0, PW, 42).fill(col);
    // Chapter chip
    box(L, 8, 32, 26, 'rgba(255,255,255,0.2)', null, 4);
    doc.save().font('Helvetica-Bold').fontSize(7).fillColor('rgba(255,255,255,0.7)')
       .text('CH', L + 4, 12).restore();
    doc.save().font('Helvetica-Bold').fontSize(13).fillColor(WH)
       .text(String(chapNum).padStart(2,'0'), L + 2, 19).restore();
    // Title
    doc.save().font('Helvetica-Bold').fontSize(17).fillColor(WH)
       .text(title, L + 42, 8, { width: CW - 42 }).restore();
    // Sub
    doc.save().font('Helvetica').fontSize(9.5).fillColor('rgba(255,255,255,0.80)')
       .text(sub, L + 42, 27, { width: CW - 42 }).restore();
    setY(56);
}

function sectionBar(txt) {
    need(36);
    advY(4);
    doc.rect(L, Y(), CW, 26).fill(B);
    doc.rect(L, Y(), 5, 26).fill('#1D4ED8');
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(WH)
       .text(txt, L + 14, Y() + 8, { width: CW - 20 }).restore();
    advY(32);
}

function h2(txt) {
    need(28);
    advY(6);
    doc.save().font('Helvetica-Bold').fontSize(11.5).fillColor(DK)
       .text(txt, L, Y(), { width: CW }).restore();
    advY(16);
}

function para(txt) {
    const h = doc.heightOfString(txt, { width: CW, font: 'Helvetica', fontSize: 10.5, lineGap: 3 }) + 6;
    need(h);
    doc.save().font('Helvetica').fontSize(10.5).fillColor(MID)
       .text(txt, L, Y(), { width: CW, lineGap: 3 }).restore();
    advY(h);
}

function bullets(items) {
    items.forEach(item => {
        const h = doc.heightOfString(item, { width: CW - 18, font: 'Helvetica', fontSize: 10.5, lineGap: 3 }) + 6;
        need(h + 4);
        const y = Y();
        doc.circle(L + 7, y + 6, 3).fill(B);
        doc.save().font('Helvetica').fontSize(10.5).fillColor(MID)
           .text(item, L + 17, y, { width: CW - 18, lineGap: 3 }).restore();
        advY(h + 2);
    });
    advY(4);
}

function numStep(n, title, body) {
    const bh = doc.heightOfString(body, { width: CW - 52, font: 'Helvetica', fontSize: 10.5, lineGap: 3 });
    need(bh + 44);
    const y = Y();
    doc.circle(L + 14, y + 14, 14).fill(B);
    doc.save().font('Helvetica-Bold').fontSize(13).fillColor(WH)
       .text(String(n), L, y + 8, { width: 28, align: 'center' }).restore();
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(DK)
       .text(title, L + 32, y + 6, { width: CW - 34 }).restore();
    doc.save().font('Helvetica').fontSize(10.5).fillColor(MID)
       .text(body, L + 32, y + 22, { width: CW - 34, lineGap: 3 }).restore();
    advY(bh + 34);
}

function tip(icon, txt, bg, border) {
    bg = bg || LY; border = border || YL;
    const h = doc.heightOfString(txt, { width: CW - 48, font: 'Helvetica', fontSize: 10, lineGap: 3 }) + 20;
    need(h + 6);
    const y = Y();
    box(L, y, CW, h, bg, null, 6);
    doc.rect(L, y, 4, h).fill(border);
    doc.save().fontSize(14).text(icon, L + 10, y + (h - 14) / 2).restore();
    doc.save().font('Helvetica').fontSize(10).fillColor(MID)
       .text(txt, L + 34, y + 10, { width: CW - 48, lineGap: 3 }).restore();
    advY(h + 8);
}

function codeBlock(lines, lang) {
    const lh = 13.5;
    const bh = lines.length * lh + 16;
    need(bh + 6);
    const y = Y();
    box(L, y, CW, bh, SH, null, 5);
    if (lang) {
        box(L + CW - 58, y + 5, 52, 15, '#21262D', null, 3);
        doc.save().font('Helvetica').fontSize(7.5).fillColor('#8B949E').text(lang, L + CW - 55, y + 9).restore();
    }
    lines.forEach((line, i) => {
        const ly = y + 8 + i * lh;
        doc.save().font('Courier').fontSize(7.5).fillColor('#6E7681')
           .text(String(i+1).padStart(2,' '), L + 6, ly, { width: 16 }).restore();
        doc.save().font('Courier').fontSize(8.5).fillColor('#E6EDF3')
           .text(line, L + 24, ly, { width: CW - 32, lineGap: 0 }).restore();
    });
    advY(bh + 6);
}

function shellCmd(comment, cmd) {
    if (comment) {
        need(14);
        doc.save().font('Helvetica').fontSize(8.5).fillColor(MID).text(comment, L, Y()).restore();
        advY(13);
    }
    need(30);
    const y = Y();
    box(L, y, CW, 26, SH, null, 4);
    doc.rect(L, y, 4, 26).fill(B);
    doc.save().font('Courier-Bold').fontSize(9.5).fillColor('#F0883E').text('$', L + 10, y + 8).restore();
    doc.save().font('Courier').fontSize(9.5).fillColor('#3FB950').text(cmd, L + 24, y + 8, { width: CW - 30 }).restore();
    advY(32);
}

// ── browser chrome helper ─────────────────────────────────────────────────────
function browserBar(x, y, w, url) {
    box(x, y, w, 28, '#E5E7EB', '#D1D5DB');
    doc.circle(x+14, y+14, 5).fill('#EF4444');
    doc.circle(x+26, y+14, 5).fill('#F59E0B');
    doc.circle(x+38, y+14, 5).fill('#22C55E');
    box(x+52, y+6, w-64, 16, WH, '#D1D5DB', 3);
    doc.save().font('Helvetica').fontSize(8).fillColor('#6B7280').text(url, x+58, y+10, {width: w-72}).restore();
}

// ─────────────────────────────────────────────────────────────────────────────
// COVER  (no dark background — uses gradient via coloured rects only)
// ─────────────────────────────────────────────────────────────────────────────
addPage();

// Blue top band
doc.rect(0, 0, PW, 8).fill(B);
// Title block
doc.rect(0, 180, PW, 160).fill(LB);
doc.rect(0, 340, PW, 6).fill(B);

doc.save().font('Helvetica-Bold').fontSize(11).fillColor(B)
   .text('COMPLETE VISUAL GUIDE', 0, 150, { width: PW, align: 'center', characterSpacing: 2 }).restore();
doc.save().font('Helvetica-Bold').fontSize(36).fillColor(DK)
   .text('Build Your App', 0, 195, { width: PW, align: 'center' }).restore();
doc.save().font('Helvetica-Bold').fontSize(36).fillColor(B)
   .text('on Replit', 0, 238, { width: PW, align: 'center' }).restore();
doc.save().font('Helvetica').fontSize(13).fillColor(MID)
   .text('Manual coding · No AI · Step-by-step with screenshots & arrows', 0, 285, { width: PW, align: 'center' }).restore();

// Feature pills
const feats = ['📸 Real screenshots','💻 Full code examples','🔑 Keyboard shortcuts','🚀 Deploy live'];
feats.forEach((f, i) => {
    const fx = L + i * (CW / 4);
    box(fx, 360, CW/4 - 8, 32, WH, '#CBD5E1', 8);
    doc.save().font('Helvetica').fontSize(9.5).fillColor(MID).text(f, fx + 6, 371, { width: CW/4 - 16 }).restore();
});

// Contents table
doc.save().font('Helvetica-Bold').fontSize(11).fillColor(DK).text('CONTENTS', L, 420).restore();
doc.moveTo(L, 434).lineTo(L + CW, 434).strokeColor('#CBD5E1').lineWidth(1).stroke();

const toc = [
    ['01','Create Your Account + Interface Tour','3'],
    ['02','Write Your First HTML / CSS / JavaScript','5'],
    ['03','Install Packages (npm & pip)','8'],
    ['04','Build a Full Website — Landing Page + Login + Signup','10'],
    ['05','React — Build a Modern Web App','15'],
    ['06','Environment Variables & Secrets','19'],
    ['07','Deploy Your App Live','21'],
    ['08','Keyboard Shortcuts Cheat Sheet','23'],
    ['09','Common Errors & Fixes','25'],
];
toc.forEach(([n, t, p], i) => {
    const ty = 442 + i * 34;
    box(L, ty, 28, 26, i%2===0 ? LB : '#F8FAFC', null, 4);
    doc.save().font('Helvetica-Bold').fontSize(11).fillColor(B).text(n, L, ty+7, {width:28,align:'center'}).restore();
    doc.save().font('Helvetica-Bold').fontSize(10.5).fillColor(DK).text(t, L+36, ty+4, {width: CW-60}).restore();
    doc.save().font('Helvetica').fontSize(9).fillColor(MID).text('Pg '+p, L+36, ty+17, {width: CW-60}).restore();
    doc.moveTo(L+36, ty+32).lineTo(L+CW, ty+32).strokeColor('#F1F5F9').lineWidth(0.5).stroke();
});

doc.save().font('Helvetica').fontSize(8.5).fillColor('#94A3B8')
   .text('replit.com  ·  Complete Visual Guide for Beginners', 0, PH-26, {width:PW, align:'center'}).restore();

// ─────────────────────────────────────────────────────────────────────────────
// CHAPTER 1 — Create Account + Interface
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(1, 'Create Your Replit Account', 'Sign up and understand every panel in the editor', B);

sectionBar('STEP 1 — Go to replit.com in your browser');

para('Open any web browser (Chrome, Firefox, Safari, or Edge). Click the address bar at the top of the browser window and type:');
need(36);
const urlY = Y();
box(L, urlY, CW, 32, SH, null, 5);
doc.save().font('Courier-Bold').fontSize(14).fillColor('#3FB950')
   .text('https://replit.com', L, urlY+9, {width:CW, align:'center'}).restore();
advY(38);

para('Press Enter. You will see the Replit homepage. Below is a real screenshot — look at the TOP RIGHT corner:');

// REAL SCREENSHOT
need(220);
const ssY = Y();
if (fs.existsSync(SS)) {
    doc.save();
    doc.rect(L, ssY, CW, 200).clip();
    doc.image(SS, L, ssY, { width: CW, height: 200 });
    doc.restore();
    box(L, ssY, CW, 200, null, '#CBD5E1');

    // "Create account" button is at ~84% x, ~4% y of image
    const bx = L + CW * 0.845;
    const by = ssY + 200 * 0.035;
    const bw = CW * 0.130, bh = 200 * 0.055;
    // Red highlight ring
    doc.save().roundedRect(bx-3, by-3, bw+6, bh+6, 4)
       .strokeColor(RD).lineWidth(2.5).stroke().restore();
    // Arrow from label to button
    arrow(bx - 80, by + bh + 26, bx + bw/2, by + bh + 2, RD, 2.5);
    calloutBox(bx - 90, by + bh + 30, '① Click "Create account"', RD);

    // "Log in" also annotated
    const lx = L + CW * 0.80, ly = ssY + 200 * 0.035;
    doc.save().roundedRect(lx-3, ly-3, CW*0.038+6, bh+6, 4)
       .strokeColor(YL).lineWidth(2).stroke().restore();
    arrow(L + 30, ly + bh + 50, lx + CW*0.019, ly + bh + 2, YL, 2);
    calloutBox(L + 6, ly + bh + 54, '② Or "Log in" if you have account', YL);

    advY(210);
} else {
    box(L, ssY, CW, 60, '#F8FAFC', '#CBD5E1');
    doc.save().font('Helvetica').fontSize(10).fillColor(MID).text('[Replit homepage screenshot]', L, ssY+22, {width:CW,align:'center'}).restore();
    advY(68);
}

tip('💡', '"Create account" is at the TOP RIGHT corner. Use Google login — it\'s the fastest, no new password needed.', LB, B);

sectionBar('STEP 2 — Sign up form: what to click');

// SIGNUP FORM MOCKUP (drawn, not screenshot — reliable)
need(270);
const fY = Y();
const fW = CW * 0.68, fX = L + (CW - fW) / 2;
browserBar(fX, fY, fW, 'replit.com/signup');
box(fX, fY+28, fW, 230, WH, '#E5E7EB');

doc.save().font('Helvetica-Bold').fontSize(13).fillColor(DK)
   .text('Create your Replit account', fX, fY+42, {width:fW, align:'center'}).restore();

// Google button
const gbY = fY + 70;
box(fX+16, gbY, fW-32, 30, '#F8FAFC', '#E2E8F0', 6);
doc.save().font('Helvetica-Bold').fontSize(10).fillColor(DK)
   .text('G   Continue with Google', fX+16, gbY+9, {width:fW-32, align:'center'}).restore();

// GitHub button
const gkY = gbY + 38;
box(fX+16, gkY, fW-32, 30, '#24292E', null, 6);
doc.save().font('Helvetica-Bold').fontSize(10).fillColor(WH)
   .text('  Continue with GitHub', fX+16, gkY+9, {width:fW-32, align:'center'}).restore();

// OR divider
doc.save().font('Helvetica').fontSize(9).fillColor('#9CA3AF').text('or', fX+fW/2-8, gkY+38).restore();
doc.moveTo(fX+16, gkY+44).lineTo(fX+fW/2-14, gkY+44).strokeColor('#E5E7EB').lineWidth(1).stroke();
doc.moveTo(fX+fW/2+6, gkY+44).lineTo(fX+fW-16, gkY+44).strokeColor('#E5E7EB').lineWidth(1).stroke();

// Email field
const efY = gkY + 56;
box(fX+16, efY, fW-32, 24, '#F9FAFB', '#D1D5DB', 4);
doc.save().font('Helvetica').fontSize(9).fillColor('#9CA3AF').text('Email address', fX+22, efY+7).restore();

// Password field
box(fX+16, efY+30, fW-32, 24, '#F9FAFB', '#D1D5DB', 4);
doc.save().font('Helvetica').fontSize(9).fillColor('#9CA3AF').text('Password', fX+22, efY+37).restore();

// Create button
box(fX+16, efY+62, fW-32, 28, B, null, 6);
doc.save().font('Helvetica-Bold').fontSize(10).fillColor(WH)
   .text('Create account', fX+16, efY+71, {width:fW-32, align:'center'}).restore();

// Annotations
doc.save().roundedRect(fX+12, gbY-3, fW-24, 36, 5).strokeColor(GR).lineWidth(2.5).stroke().restore();
calloutBox(fX+fW+6, gbY+6, '① Easiest — use Google', GR);
arrow(fX+fW+6, gbY+14, fX+fW, gbY+14, GR, 2);

doc.save().roundedRect(fX+12, efY-3, fW-24, 30, 5).strokeColor(B).lineWidth(2.5).stroke().restore();
calloutBox(fX+fW+6, efY+3, '② Or type email', B);
arrow(fX+fW+6, efY+11, fX+fW, efY+11, B, 2);

doc.save().roundedRect(fX+12, efY+58, fW-24, 36, 5).strokeColor(RD).lineWidth(2.5).stroke().restore();
calloutBox(fX+fW+6, efY+66, '③ Click to create', RD);
arrow(fX+fW+6, efY+74, fX+fW, efY+74, RD, 2);

advY(270);

sectionBar('STEP 3 — Confirm email & choose free plan');
numStep(1,'Check your email inbox','Replit sends a confirmation email. Open it (Gmail, Outlook, etc.).');
numStep(2,'Click the blue link inside the email','This takes you back to Replit and activates your account.');
numStep(3,'Choose the free plan','Click "Start for free". You do NOT need to pay to start building real apps.');

// ─────────────────────────────────────────────────────────────────────────────
// PAGE: The Editor Diagram
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(1, 'The Replit Editor', 'Every panel labelled — study this before you start coding', B);

sectionBar('The Editor has 4 main areas — every one is labelled below');
para('When you open any project, this is what you see. The coloured letters A–E match the legend below the diagram.');

need(400);
const edY = Y();
const edH = 370, edW = CW;
const edBodyY = edY + 28;
const edBodyH = edH - 28;

// browser bar
browserBar(L, edY, edW, 'replit.com/@you/my-first-app');
// editor background
box(L, edBodyY, edW, edBodyH, '#0D1117', null);

// TOP TOOLBAR
const tbH = 34;
box(L, edBodyY, edW, tbH, '#161B22', null);
doc.save().font('Helvetica-Bold').fontSize(9).fillColor('#58A6FF')
   .text('my-first-app', L+10, edBodyY+12).restore();
// Share
box(L+edW-280, edBodyY+7, 48, 20, '#21262D', '#30363D', 4);
doc.save().font('Helvetica').fontSize(8).fillColor('#C9D1D9').text('Share', L+edW-265, edBodyY+12).restore();
// Fork
box(L+edW-226, edBodyY+7, 40, 20, '#21262D', '#30363D', 4);
doc.save().font('Helvetica').fontSize(8).fillColor('#C9D1D9').text('Fork', L+edW-215, edBodyY+12).restore();
// Deploy
box(L+edW-178, edBodyY+7, 52, 20, '#1D4ED8', null, 4);
doc.save().font('Helvetica-Bold').fontSize(8).fillColor(WH).text('⬆ Deploy', L+edW-172, edBodyY+12).restore();
// Run button
box(L+edW-118, edBodyY+7, 56, 20, '#238636', null, 4);
doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(WH).text('▶  Run', L+edW-111, edBodyY+12).restore();

// LEFT ICON BAR
const sbW = 44;
box(L, edBodyY+tbH, sbW, edBodyH-tbH, '#010409', null);
const ics = [['📁','Files'],['🔍','Search'],['🔒','Secrets'],['🌿','Git'],['⚙️','Cfg']];
ics.forEach((ic, i) => {
    const iy = edBodyY+tbH+12+i*46;
    if (i===0) box(L+2, iy-4, sbW-4, 38, '#161B22', null, 3);
    doc.save().fontSize(17).text(ic[0], L+4, iy, {width:sbW-8, align:'center'}).restore();
    doc.save().font('Helvetica').fontSize(6.5).fillColor('#8B949E').text(ic[1], L+4, iy+20, {width:sbW-8, align:'center'}).restore();
});

// FILE EXPLORER
const feX = L+sbW, feW = 126;
box(feX, edBodyY+tbH, feW, edBodyH-tbH, '#0D1117', null);
box(feX, edBodyY+tbH, feW, 26, '#161B22', null);
doc.save().font('Helvetica-Bold').fontSize(8).fillColor('#8B949E').text('FILES', feX+10, edBodyY+tbH+9).restore();
doc.save().font('Helvetica-Bold').fontSize(12).fillColor('#3FB950').text('+', feX+feW-20, edBodyY+tbH+7).restore();
const fnames = ['📄 index.html','🎨 style.css','⚡ script.js','📁 images/'];
fnames.forEach((f, i) => {
    const fy = edBodyY+tbH+35+i*22;
    if (i===0) box(feX, fy-3, feW, 20, '#1C2128', null);
    doc.save().font('Courier').fontSize(7.5).fillColor(i===0?'#58A6FF':'#8B949E')
       .text(f, feX+8, fy, {width:feW-12}).restore();
});

// CODE EDITOR
const ceX = feX+feW, ceW = edW*0.44;
box(ceX, edBodyY+tbH, ceW, edBodyH-tbH, '#0D1117', null);
box(ceX, edBodyY+tbH, ceW, 24, '#161B22', null);
box(ceX+4, edBodyY+tbH+3, 76, 18, '#0D1117', null, 2);
doc.save().font('Helvetica').fontSize(7.5).fillColor('#F0883E')
   .text('index.html  ×', ceX+8, edBodyY+tbH+8).restore();
box(ceX, edBodyY+tbH+24, 24, edBodyH-tbH-24, '#010409', null);
const clines = [
    {t:'<!DOCTYPE html>',c:'#6E7681'},
    {t:'<html lang="en">',c:'#58A6FF'},
    {t:'  <head>',c:'#58A6FF'},
    {t:'    <title>My App</title>',c:'#8B949E'},
    {t:'  </head>',c:'#58A6FF'},
    {t:'  <body>',c:'#58A6FF'},
    {t:'    <h1>Hello!</h1>',c:'#3FB950'},
    {t:'    <p>I built this.</p>',c:'#8B949E'},
    {t:'  </body>',c:'#58A6FF'},
    {t:'</html>',c:'#58A6FF'},
];
clines.forEach((cl, i) => {
    const ly = edBodyY+tbH+30+i*15;
    doc.save().font('Courier').fontSize(7).fillColor('#4B5563').text(String(i+1), ceX+4, ly, {width:18,align:'right'}).restore();
    doc.save().font('Courier').fontSize(7.5).fillColor(cl.c).text(cl.t, ceX+28, ly, {width:ceW-34}).restore();
});

// PREVIEW PANEL
const pvX = ceX+ceW, pvW = edW-sbW-feW-ceW;
box(pvX, edBodyY+tbH, pvW, edBodyH-tbH, '#FAFAFA', null);
box(pvX, edBodyY+tbH, pvW, 24, '#F3F4F6', null);
['Preview','Console','Shell'].forEach((tab, i) => {
    const tx = pvX + 4 + i*(pvW/3);
    if (i===0) {
        box(tx, edBodyY+tbH, pvW/3-2, 24, WH, null);
        doc.save().font('Helvetica-Bold').fontSize(7.5).fillColor(B).text(tab, tx, edBodyY+tbH+8, {width:pvW/3-2,align:'center'}).restore();
    } else {
        doc.save().font('Helvetica').fontSize(7.5).fillColor('#6B7280').text(tab, tx, edBodyY+tbH+8, {width:pvW/3-2,align:'center'}).restore();
    }
});
doc.save().font('Helvetica-Bold').fontSize(12).fillColor(DK).text('Hello!', pvX+8, edBodyY+tbH+34).restore();
doc.save().font('Helvetica').fontSize(8).fillColor('#6B7280').text('I built this myself.', pvX+8, edBodyY+tbH+52).restore();

advY(edH + 6);

// ── LEGEND TABLE ──────────────────────────────────────────────────────────────
// ── ANNOTATIONS on diagram ────────────────────────────────────────────────────
// A: Toolbar
doc.save().roundedRect(L+edW-284, edBodyY+3, 242, 28, 3).strokeColor(RD).lineWidth(2).stroke().restore();
arrow(L+edW/2+20, edBodyY-16, L+edW-180, edBodyY+3, RD, 2);
badge(L+edW/2-4, edBodyY-24, 'A  TOP TOOLBAR', RD);

// B: File Explorer
doc.save().rect(feX-1, edBodyY+tbH-1, feW+2, 100).strokeColor(GR).lineWidth(2).stroke().restore();
badge(feX+4, edBodyY+tbH+108, 'B  FILES', GR);

// C: Code Editor
doc.save().rect(ceX-1, edBodyY+tbH-1, ceW+2, 100).strokeColor(B).lineWidth(2).stroke().restore();
badge(ceX+ceW/2-20, edBodyY+tbH+108, 'C  CODE EDITOR', B);

// D: Preview
doc.save().rect(pvX-1, edBodyY+tbH-1, pvW+2, 100).strokeColor('#7C3AED').lineWidth(2).stroke().restore();
badge(pvX+4, edBodyY+tbH+108, 'D  PREVIEW', '#7C3AED');

// E: Run button
doc.save().roundedRect(L+edW-122, edBodyY+3, 60, 28, 3).strokeColor(YL).lineWidth(2.5).stroke().restore();
badge(L+edW-130, edBodyY+tbH+5, 'E  ▶ RUN', YL, DK);
arrow(L+edW-100, edBodyY+tbH+5, L+edW-100, edBodyY+31, YL, 1.5);

// F: Secrets icon  
doc.save().roundedRect(L+2, edBodyY+tbH+12+2*46-4, sbW-4, 40, 3).strokeColor(RD).lineWidth(2).stroke().restore();
badge(feX+4, edBodyY+tbH+12+2*46+42, 'F  SECRETS 🔒', RD);
arrow(feX+badgeWidth('F  SECRETS 🔒'), edBodyY+tbH+12+2*46+52, L+sbW, edBodyY+tbH+12+2*46+18, RD, 1.5);

need(160);
sectionBar('What each labelled area does');
const legend = [
    ['A','Top Toolbar — RUN, DEPLOY, SHARE buttons. Click ▶ Run every time you want to test your code.',RD],
    ['B','File Explorer — all your project files. Click a file to open it. Click + to create a new file.',GR],
    ['C','Code Editor — this is where you TYPE your code. Line numbers are on the left.',B],
    ['D','Preview tab — see your running app. Console tab — see errors. Shell tab — type commands.',`#7C3AED`],
    ['E','Run Button ▶ — starts your app. Shortcut: Ctrl + Enter (same result).',YL],
    ['F','Secrets 🔒 — store API keys and passwords here. NEVER put them in your code files.',RD],
];
legend.forEach(([letter, desc, col]) => {
    need(30);
    const ly = Y();
    doc.circle(L+10, ly+10, 10).fill(col);
    doc.save().font('Helvetica-Bold').fontSize(10).fillColor(WH).text(letter, L, ly+4, {width:20,align:'center'}).restore();
    doc.save().font('Helvetica').fontSize(10).fillColor(MID).text(desc, L+24, ly+4, {width:CW-28, lineGap:2}).restore();
    advY(28);
});

// helper to measure badge width
function badgeWidth(txt) {
    return doc.widthOfString(txt, {fontSize:8.5, font:'Helvetica-Bold'}) + 14;
}

// ─────────────────────────────────────────────────────────────────────────────
// CH 2 — Write First Code
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(2, 'Write Your First Code', 'HTML page + CSS styles + JavaScript — type every line yourself', GR);

sectionBar('CREATE a new project first');
numStep(1,'Click "+ Create Repl" on your dashboard','Go to the Replit homepage. Click the big blue "+ Create Repl" button on the left sidebar.');
numStep(2,'Search for "HTML, CSS, JS"','Type it in the search box. Select that template — it gives you a blank webpage, perfect for beginners.');
numStep(3,'Type a name like "my-first-app" and click Create','Replit builds your project in about 5 seconds and opens the editor.');

sectionBar('OPEN index.html and type this HTML');
para('In the File Explorer (left panel), click "index.html". Select all text (Ctrl + A) and delete it. Then type this — do not paste it, TYPING it builds the skill:');

codeBlock([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
    '  <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '  <title>My First App</title>',
    '  <link rel="stylesheet" href="style.css" />',
    '</head>',
    '<body>',
    '',
    '  <h1>Hello, World!</h1>',
    '  <p>I built this myself on Replit.</p>',
    '  <button id="myBtn">Click me</button>',
    '',
    '  <script src="script.js"></script>',
    '</body>',
    '</html>',
],'HTML');

tip('💾', 'Press Ctrl + S to SAVE, then click ▶ Run. In the Preview tab you should see "Hello, World!" — plain text for now, we will style it next.', LB, B);

sectionBar('CREATE style.css — add colours');
para('In the File Explorer, click the + icon → "New File" → type "style.css" → press Enter. Then type:');

codeBlock([
    '/* Controls how the page looks */',
    'body {',
    '  font-family: Arial, sans-serif;',
    '  background-color: #0f172a;',
    '  color: #f1f5f9;',
    '  text-align: center;',
    '  padding: 60px 20px;',
    '}',
    'h1 {',
    '  font-size: 2.5rem;',
    '  color: #3b82f6;',
    '}',
    'p  { color: #94a3b8; font-size: 1.1rem; }',
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
    '#myBtn:hover { background: #1d4ed8; }',
],'CSS');

sectionBar('CREATE script.js — add a click action');
para('Click + icon → "New File" → type "script.js" → press Enter. Then type:');

codeBlock([
    "// Get the button element",
    "const btn = document.getElementById('myBtn');",
    '',
    "// When the button is clicked, run this:",
    "btn.addEventListener('click', function () {",
    "  alert('You clicked the button! 🎉');",
    '});',
],'JavaScript');

tip('✅', 'Save all files (Ctrl + S on each tab), click ▶ Run. Preview shows a dark page, blue heading, grey text, and a blue button. Click the button — an alert pops up.', LG, GR);

// ─────────────────────────────────────────────────────────────────────────────
// CH 3 — PACKAGES
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(3, 'Installing Packages', 'Add ready-made code libraries with npm and pip', '#7C3AED');

sectionBar('What is a package?');
para('A "package" (also called a library or module) is code someone else already wrote. Instead of building everything yourself, you install a package and use it. For example: the "express" package builds a web server in 5 lines. Without it, you would need 200 lines.');

sectionBar('The Shell tab — where you type commands');
para('Look at the right panel. Click the "Shell" tab. You will see a black terminal with a cursor. This is where you type npm commands:');

need(180);
const shellDiagY = Y();
// Shell mockup
box(L, shellDiagY, CW, 150, SH, null, 6);
doc.rect(L, shellDiagY, CW, 28).fill('#161B22');
['Shell','Console','Output'].forEach((t, i) => {
    const tx = L+8+i*80;
    if (i===0) {
        box(tx, shellDiagY+4, 72, 20, SH, null, 3);
        doc.save().font('Helvetica-Bold').fontSize(9).fillColor('#3FB950').text(t, tx, shellDiagY+10, {width:72,align:'center'}).restore();
    } else {
        doc.save().font('Helvetica').fontSize(9).fillColor('#6E7681').text(t, tx, shellDiagY+10, {width:72,align:'center'}).restore();
    }
});
const shellLines = [
    {t:'~/my-first-app  $ npm install express', c:'#3FB950'},
    {t:'added 57 packages in 2.3s', c:'#6E7681'},
    {t:'', c:''},
    {t:'~/my-first-app  $ node --version', c:'#3FB950'},
    {t:'v20.11.0', c:'#8B949E'},
    {t:'', c:''},
    {t:'~/my-first-app  $ _', c:'#58A6FF'},
];
shellLines.forEach((sl, i) => {
    doc.save().font('Courier').fontSize(8.5).fillColor(sl.c).text(sl.t, L+12, shellDiagY+36+i*14).restore();
});

// Annotations
doc.save().rect(L+2, shellDiagY+4, 73, 22).strokeColor(RD).lineWidth(2).stroke().restore();
arrow(L+120, shellDiagY-20, L+38, shellDiagY+4, RD, 2);
calloutBox(L+100, shellDiagY-28, '① Click "Shell" tab here', RD);

advY(158);

sectionBar('npm — Node.js Package Manager commands');
para('Type these in the Shell tab. Press Enter after each command to run it:');

shellCmd('Install a package (example: express)', 'npm install express');
shellCmd('Install multiple packages at once', 'npm install axios dotenv lodash');
shellCmd('Install a dev-only package (only needed while coding)', 'npm install --save-dev nodemon');
shellCmd('Remove a package you no longer need', 'npm uninstall express');
shellCmd('See all installed packages', 'npm list --depth=0');
shellCmd('Run the "start" script from package.json', 'npm run start');
shellCmd('Run the development server (auto-reload on save)', 'npm run dev');

tip('💡', 'After running npm install, a folder called "node_modules" appears in your file explorer. Never edit anything inside it — it is auto-generated and can be re-created any time.', LB, B);

sectionBar('pip — Python Package Manager (for Python projects)');
shellCmd('Install a package', 'pip install flask');
shellCmd('Install from a requirements.txt file', 'pip install -r requirements.txt');
shellCmd('See all installed packages', 'pip list');

sectionBar('The package.json file');
para('For Node.js projects, "package.json" is your project\'s main config file. It lists what packages your project needs. It is created automatically — never delete it.');

codeBlock([
    '{',
    '  "name": "my-first-app",',
    '  "version": "1.0.0",',
    '  "scripts": {',
    '    "start": "node server.js",',
    '    "dev":   "nodemon server.js",',
    '    "build": "vite build"',
    '  },',
    '  "dependencies": {',
    '    "express": "^4.18.2"',
    '  },',
    '  "devDependencies": {',
    '    "nodemon": "^3.0.1"',
    '  }',
    '}',
],'package.json');

// ─────────────────────────────────────────────────────────────────────────────
// CH 4 — FULL WEBSITE
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(4, 'Build a Full Website', 'Landing page + Signup + Login — complete code', '#D97706');

sectionBar('Your project will have these 6 files');
need(100);
const fileTreeY = Y();
box(L, fileTreeY, CW*0.52, 90, SH, null, 6);
const ftLines = [
    {t:'my-website/', c:'#F0F6FC'},
    {t:'├── index.html    ← landing page', c:'#58A6FF'},
    {t:'├── signup.html   ← create account', c:'#3FB950'},
    {t:'├── login.html    ← log in', c:'#3FB950'},
    {t:'├── style.css     ← shared styles', c:'#F0883E'},
    {t:'├── auth.css      ← form styles', c:'#F0883E'},
    {t:'└── auth.js       ← form logic', c:'#FDE68A'},
];
ftLines.forEach((fl, i) => {
    doc.save().font('Courier').fontSize(8.5).fillColor(fl.c).text(fl.t, L+12, fileTreeY+8+i*12).restore();
});
advY(98);

sectionBar('index.html — Landing Page (complete code)');
codeBlock([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '<head>',
    '  <meta charset="UTF-8" />',
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
    '    </ul>',
    '    <div class="nav-btns">',
    '      <a href="login.html"  class="btn-outline">Log in</a>',
    '      <a href="signup.html" class="btn-primary">Sign up free</a>',
    '    </div>',
    '  </nav>',
    '',
    '  <!-- HERO SECTION -->',
    '  <section class="hero">',
    '    <h1>Build something <span class="hl">amazing</span></h1>',
    '    <p>The simplest way to create and deploy your app.</p>',
    '    <a href="signup.html" class="btn-primary btn-lg">',
    '      Get started — it\'s free',
    '    </a>',
    '  </section>',
    '',
    '  <!-- FEATURES -->',
    '  <section class="features">',
    '    <div class="card"><div class="icon">🚀</div><h3>Fast</h3><p>Deploy in seconds.</p></div>',
    '    <div class="card"><div class="icon">🔒</div><h3>Secure</h3><p>Your data is safe.</p></div>',
    '    <div class="card"><div class="icon">💡</div><h3>Simple</h3><p>No experience needed.</p></div>',
    '  </section>',
    '',
    '  <!-- FOOTER -->',
    '  <footer><p>© 2025 MyApp. Built on Replit.</p></footer>',
    '',
    '</body>',
    '</html>',
],'HTML — index.html');

addPage();
pageHeader(4, 'Landing Page — CSS', 'style.css: complete styles for your home page', '#D97706');

codeBlock([
    '/* ── Reset ─────────────────────────── */',
    '* { margin: 0; padding: 0; box-sizing: border-box; }',
    'body  { font-family: Arial, sans-serif; color: #1e293b; }',
    'a     { text-decoration: none; }',
    '',
    '/* ── Buttons ───────────────────────── */',
    '.btn-primary {',
    '  background: #3b82f6; color: white; padding: 10px 22px;',
    '  border-radius: 8px; font-weight: bold; border: none; cursor: pointer;',
    '}',
    '.btn-outline {',
    '  border: 2px solid #3b82f6; color: #3b82f6;',
    '  padding: 8px 20px; border-radius: 8px; font-weight: bold;',
    '}',
    '.btn-lg { padding: 16px 36px; font-size: 1.1rem; }',
    '',
    '/* ── Navbar ────────────────────────── */',
    '.navbar {',
    '  display: flex; align-items: center;',
    '  justify-content: space-between;',
    '  padding: 18px 60px;',
    '  border-bottom: 1px solid #e2e8f0;',
    '  position: sticky; top: 0; background: white; z-index: 100;',
    '}',
    '.nav-logo  { font-size: 1.4rem; font-weight: 900; color: #3b82f6; }',
    '.nav-links { display: flex; gap: 32px; list-style: none; }',
    '.nav-links a { color: #475569; }',
    '.nav-links a:hover { color: #3b82f6; }',
    '.nav-btns  { display: flex; gap: 12px; align-items: center; }',
    '',
    '/* ── Hero ──────────────────────────── */',
    '.hero {',
    '  text-align: center;',
    '  padding: 100px 20px 80px;',
    '  background: linear-gradient(135deg, #eff6ff 0%, #f8fafc 100%);',
    '}',
    '.hero h1 { font-size: 3rem; font-weight: 900; color: #0f172a; }',
    '.hl       { color: #3b82f6; }',
    '.hero p   { font-size: 1.2rem; color: #64748b; margin: 20px 0 36px; }',
    '',
    '/* ── Features ──────────────────────── */',
    '.features {',
    '  display: flex; gap: 24px; justify-content: center;',
    '  padding: 80px 60px; flex-wrap: wrap;',
    '}',
    '.card {',
    '  background: #f8fafc; border: 1px solid #e2e8f0;',
    '  border-radius: 16px; padding: 36px 28px;',
    '  width: 220px; text-align: center;',
    '}',
    '.icon { font-size: 2.5rem; margin-bottom: 16px; }',
    '.card h3 { font-size: 1.2rem; margin-bottom: 8px; }',
    '.card p  { color: #64748b; font-size: 0.95rem; }',
    '',
    '/* ── Footer ────────────────────────── */',
    'footer {',
    '  text-align: center; padding: 40px;',
    '  background: #f1f5f9; color: #94a3b8; font-size: 0.9rem;',
    '}',
],'CSS — style.css');

addPage();
pageHeader(4, 'Signup + Login Pages', 'signup.html, login.html, auth.css, auth.js', '#D97706');

sectionBar('signup.html — Create Account Page');
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
    '  <div class="auth-wrap">',
    '    <div class="auth-card">',
    '      <div class="auth-logo">MyApp</div>',
    '      <h2>Create your account</h2>',
    '      <p class="auth-sub">Join thousands of builders today</p>',
    '',
    '      <form id="signupForm" class="auth-form">',
    '        <div class="fg">',
    '          <label for="name">Full name</label>',
    '          <input type="text" id="name" placeholder="Charlie Johnson" required />',
    '        </div>',
    '        <div class="fg">',
    '          <label for="email">Email address</label>',
    '          <input type="email" id="email" placeholder="charlie@example.com" required />',
    '        </div>',
    '        <div class="fg">',
    '          <label for="pwd">Password  (min 8 chars)</label>',
    '          <input type="password" id="pwd" placeholder="••••••••" required />',
    '        </div>',
    '        <button type="submit" class="btn-primary btn-full">',
    '          Create account',
    '        </button>',
    '      </form>',
    '',
    '      <p class="auth-foot">',
    '        Already have an account? <a href="login.html">Log in</a>',
    '      </p>',
    '    </div>',
    '  </div>',
    '  <script src="auth.js"></script>',
    '</body>',
    '</html>',
],'HTML — signup.html');

sectionBar('login.html — Log In Page');
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
    '  <div class="auth-wrap">',
    '    <div class="auth-card">',
    '      <div class="auth-logo">MyApp</div>',
    '      <h2>Welcome back</h2>',
    '      <p class="auth-sub">Log in to your account</p>',
    '',
    '      <form id="loginForm" class="auth-form">',
    '        <div class="fg">',
    '          <label for="email">Email address</label>',
    '          <input type="email" id="email" placeholder="charlie@example.com" required />',
    '        </div>',
    '        <div class="fg">',
    '          <label for="pwd">Password</label>',
    '          <input type="password" id="pwd" placeholder="••••••••" required />',
    '        </div>',
    '        <div class="form-row">',
    '          <label><input type="checkbox" /> Remember me</label>',
    '          <a href="#">Forgot password?</a>',
    '        </div>',
    '        <button type="submit" class="btn-primary btn-full">Log in</button>',
    '      </form>',
    '',
    "      <p class=\"auth-foot\">No account? <a href=\"signup.html\">Sign up free</a></p>",
    '    </div>',
    '  </div>',
    '  <script src="auth.js"></script>',
    '</body>',
    '</html>',
],'HTML — login.html');

addPage();
pageHeader(4, 'auth.css + auth.js', 'Styles and JavaScript for your signup/login forms', '#D97706');

sectionBar('auth.css — Styles for both auth pages');
codeBlock([
    '.auth-wrap {',
    '  min-height: 100vh;',
    '  background: linear-gradient(135deg, #eff6ff 0%, #f0fdf4 100%);',
    '  display: flex; align-items: center; justify-content: center;',
    '  padding: 40px 20px;',
    '}',
    '.auth-card {',
    '  background: white; border-radius: 20px;',
    '  padding: 48px 44px; width: 100%; max-width: 420px;',
    '  box-shadow: 0 20px 60px rgba(0,0,0,0.08);',
    '  text-align: center;',
    '}',
    '.auth-logo { font-size: 1.6rem; font-weight: 900; color: #3b82f6; margin-bottom: 24px; }',
    '.auth-card h2 { font-size: 1.6rem; font-weight: 800; margin-bottom: 8px; }',
    '.auth-sub  { color: #64748b; margin-bottom: 32px; font-size: 0.95rem; }',
    '.auth-form { display: flex; flex-direction: column; gap: 18px; text-align: left; }',
    '.fg label  { display: block; font-size: 0.875rem; font-weight: 600; color: #374151; margin-bottom: 6px; }',
    '.fg input  {',
    '  width: 100%; padding: 12px 16px;',
    '  border: 1.5px solid #d1d5db; border-radius: 10px;',
    '  font-size: 0.95rem; outline: none;',
    '}',
    '.fg input:focus { border-color: #3b82f6; }',
    '.form-row { display: flex; justify-content: space-between; font-size: 0.875rem; color: #64748b; }',
    '.form-row a { color: #3b82f6; }',
    '.btn-full  { width: 100%; padding: 14px; font-size: 1rem; }',
    '.auth-foot { margin-top: 24px; font-size: 0.9rem; color: #64748b; }',
    '.auth-foot a { color: #3b82f6; font-weight: 600; }',
],'CSS — auth.css');

sectionBar('auth.js — Form validation and submit logic');
codeBlock([
    "const signupForm = document.getElementById('signupForm');",
    "const loginForm  = document.getElementById('loginForm');",
    '',
    '// ── Signup ──────────────────────────────────',
    'if (signupForm) {',
    "  signupForm.addEventListener('submit', function (e) {",
    '    e.preventDefault();  // stop page refresh',
    '',
    "    const name  = document.getElementById('name').value;",
    "    const email = document.getElementById('email').value;",
    "    const pwd   = document.getElementById('pwd').value;",
    '',
    '    if (pwd.length < 8) {',
    "      alert('Password must be at least 8 characters.');",
    '      return;',
    '    }',
    '',
    "    // In a real app: send to server. For now, show success.",
    "    alert('Account created! Welcome, ' + name + '!');",
    "    window.location.href = 'login.html';",
    '  });',
    '}',
    '',
    '// ── Login ───────────────────────────────────',
    'if (loginForm) {',
    "  loginForm.addEventListener('submit', function (e) {",
    '    e.preventDefault();',
    '',
    "    const email = document.getElementById('email').value;",
    '',
    "    // In a real app: verify against database.",
    "    alert('Logged in as ' + email + '!');",
    "    window.location.href = 'index.html';",
    '  });',
    '}',
],'JavaScript — auth.js');

tip('📁', 'Your 6 files are ready. Click ▶ Run. In the Preview, you should see your landing page. Click "Log in" and "Sign up free" in the navbar — they should navigate to the other pages.', LG, GR);

// ─────────────────────────────────────────────────────────────────────────────
// CH 5 — REACT
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(5, 'React — Build a Modern Web App', 'Components, state, and your first React project', B);

sectionBar('What is React and when should you use it?');
para('React is a JavaScript library for building interfaces. Instead of one giant HTML file, you split your app into small reusable pieces called "components". When your app has many pages, React keeps things organised. Big companies like Facebook, Airbnb, and Netflix all use React.');

need(110);
const rcY = Y();
box(L, rcY, CW/2-8, 100, LR, null, 8);
box(L, rcY, CW/2-8, 24, RD, null, 8);
doc.save().font('Helvetica-Bold').fontSize(10).fillColor(WH).text('❌  Plain HTML — gets messy', L+8, rcY+8).restore();
doc.save().font('Helvetica').fontSize(9.5).fillColor(MID)
   .text('• Copy navbar on every page\n• Fix a bug in 50 places\n• Hard to manage 10+ pages', L+12, rcY+32, {lineGap:4}).restore();

const rc2X = L+CW/2+8;
box(rc2X, rcY, CW/2-8, 100, LG, null, 8);
box(rc2X, rcY, CW/2-8, 24, GR, null, 8);
doc.save().font('Helvetica-Bold').fontSize(10).fillColor(WH).text('✅  React — stays organised', rc2X+8, rcY+8).restore();
doc.save().font('Helvetica').fontSize(9.5).fillColor(MID)
   .text('• <Navbar /> used everywhere\n• Fix once — updates everywhere\n• Scales to 100+ pages easily', rc2X+12, rcY+32, {lineGap:4}).restore();
advY(108);

sectionBar('Create a React project on Replit');
numStep(1,'Click "+ Create Repl" on your dashboard','Go to replit.com, click the create button.');
numStep(2,'Type "React" in the search box','Select the "React" or "React + Vite" template.');
numStep(3,'Name it and click Create','Example: "my-react-app". Wait 5–10 seconds for Replit to set it up.');
numStep(4,'Click ▶ Run','Replit installs all dependencies automatically. After ~30 seconds, a default React page appears in the Preview.');

sectionBar('File structure of a React project');
codeBlock([
    'my-react-app/',
    '├── src/',
    '│   ├── main.jsx         ← Entry point — DO NOT delete or rename',
    '│   ├── App.jsx          ← Your main component — START HERE',
    '│   ├── App.css          ← Styles for App',
    '│   └── components/      ← Create your own components here',
    '│       ├── Navbar.jsx',
    '│       └── Footer.jsx',
    '├── public/',
    '│   └── index.html       ← Base HTML — leave it as-is',
    '├── package.json         ← Project config',
    '└── vite.config.js       ← Build settings — leave as-is',
],'Project Structure');

sectionBar('App.jsx — Your first complete React component');
para('Open src/App.jsx. Delete everything. Type this:');

codeBlock([
    "import { useState } from 'react';",
    "import './App.css';",
    '',
    'function App() {',
    '',
    '  // useState creates a variable React watches.',
    '  // When it changes, React automatically re-draws the screen.',
    '  const [count, setCount] = useState(0);',
    "  const [name,  setName]  = useState('');",
    '',
    '  return (',
    '    <div className="container">',
    '      <h1>My React App</h1>',
    '',
    '      {/* Counter */}',
    '      <div className="card">',
    '        <p>Count: <strong>{count}</strong></p>',
    '        <button onClick={() => setCount(count + 1)}>+ Add 1</button>',
    '        <button onClick={() => setCount(0)}>Reset</button>',
    '      </div>',
    '',
    '      {/* Name input */}',
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
],'React JSX — App.jsx');

addPage();
pageHeader(5, 'React — 5 Rules You Must Know', 'Break these and your app will crash or behave wrongly', B);

sectionBar('Rule 1 — Component names MUST start with a CAPITAL letter');
need(80);
const r1Y = Y();
box(L, r1Y, CW/2-8, 60, LR, null, 6);
box(L+CW/2+8, r1Y, CW/2-8, 60, LG, null, 6);
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(RD).text('❌ WRONG', L+8, r1Y+6).restore();
doc.save().font('Courier').fontSize(9).fillColor(RD).text('function navbar() {\n  return <nav>...</nav>;\n}', L+8, r1Y+22, {lineGap:3}).restore();
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(GR).text('✅ CORRECT', L+CW/2+16, r1Y+6).restore();
doc.save().font('Courier').fontSize(9).fillColor(GR).text('function Navbar() {\n  return <nav>...</nav>;\n}', L+CW/2+16, r1Y+22, {lineGap:3}).restore();
advY(68);

sectionBar('Rule 2 — Return ONE parent element (wrap in <div> or <> </>)');
need(80);
const r2Y = Y();
box(L, r2Y, CW/2-8, 72, LR, null, 6);
box(L+CW/2+8, r2Y, CW/2-8, 72, LG, null, 6);
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(RD).text('❌ WRONG — two roots', L+8, r2Y+6).restore();
doc.save().font('Courier').fontSize(8.5).fillColor(RD).text('return (\n  <h1>Title</h1>\n  <p>Text</p>  // CRASH!\n);', L+8, r2Y+22, {lineGap:3}).restore();
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(GR).text('✅ CORRECT — wrap them', L+CW/2+16, r2Y+6).restore();
doc.save().font('Courier').fontSize(8.5).fillColor(GR).text('return (\n  <div>\n    <h1>Title</h1>\n    <p>Text</p>\n  </div>\n);', L+CW/2+16, r2Y+22, {lineGap:3}).restore();
advY(80);

sectionBar('Rule 3 — Use {curly braces} to put JavaScript values in JSX');
codeBlock([
    "const userName = 'Charlie';",
    'const score    = 42;',
    '',
    'return (',
    '  <div>',
    '    <h1>Hello, {userName}!</h1>      {/* shows: Hello, Charlie! */}',
    '    <p>Your score is {score}</p>     {/* shows: Your score is 42 */}',
    '    <p>Double: {score * 2}</p>       {/* shows: Double: 84 */}',
    '  </div>',
    ');',
],'JSX');

sectionBar('Rule 4 — NEVER modify state directly; use the setter function');
need(80);
const r4Y = Y();
box(L, r4Y, CW/2-8, 64, LR, null, 6);
box(L+CW/2+8, r4Y, CW/2-8, 64, LG, null, 6);
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(RD).text('❌ WRONG', L+8, r4Y+6).restore();
doc.save().font('Courier').fontSize(8.5).fillColor(RD).text('// Page does NOT update!\ncount = count + 1;\ncount++;', L+8, r4Y+22, {lineGap:3}).restore();
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(GR).text('✅ CORRECT', L+CW/2+16, r4Y+6).restore();
doc.save().font('Courier').fontSize(8.5).fillColor(GR).text('// Page re-renders instantly\nsetCount(count + 1);', L+CW/2+16, r4Y+22, {lineGap:3}).restore();
advY(72);

sectionBar('Rule 5 — Events use camelCase: onClick, onChange, onSubmit');
need(80);
const r5Y = Y();
box(L, r5Y, CW/2-8, 48, LR, null, 6);
box(L+CW/2+8, r5Y, CW/2-8, 48, LG, null, 6);
doc.save().font('Courier').fontSize(8.5).fillColor(RD).text('// ❌ WRONG\n<button onclick="fn()">Click</button>', L+8, r5Y+10, {lineGap:3}).restore();
doc.save().font('Courier').fontSize(8.5).fillColor(GR).text('// ✅ CORRECT\n<button onClick={fn}>Click</button>', L+CW/2+16, r5Y+10, {lineGap:3}).restore();
advY(56);

// ─────────────────────────────────────────────────────────────────────────────
// CH 6 — SECRETS
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(6, 'Secrets & Environment Variables', 'Keep passwords and API keys safe — never in your code', RD);

sectionBar('Why this is critical');
tip('⛔', 'NEVER do this: const apiKey = "sk-abc123realkey123"; — if your project is on GitHub or shared, ANYONE can steal it. API keys cost real money.', LR, RD);

para('The right way is to store sensitive values in Replit Secrets. They are encrypted and kept outside your code files.');

sectionBar('How to add a Secret — with annotated diagram');

need(310);
const spY = Y();
const spW = CW*0.66, spX = L+(CW-spW)/2;
// Panel
box(spX, spY, spW, 280, '#F8FAFC', '#E2E8F0', 8);
// Header
box(spX, spY, spW, 40, B, null, 8);
doc.save().font('Helvetica-Bold').fontSize(13).fillColor(WH).text('🔒  Secrets', spX+14, spY+12).restore();

// Existing secret row
const eY = spY+52;
box(spX+12, eY, spW-24, 40, LG, '#D1FAE5', 6);
doc.save().font('Courier-Bold').fontSize(10).fillColor(GR).text('MY_API_KEY', spX+20, eY+8).restore();
doc.save().font('Courier').fontSize(8.5).fillColor('#6B7280').text('Value: ••••••••••••', spX+20, eY+24).restore();

// New secret form label
doc.save().font('Helvetica-Bold').fontSize(9).fillColor(MID).text('ADD A NEW SECRET', spX+12, eY+56).restore();
// Key field
box(spX+12, eY+70, spW-24, 28, WH, '#D1D5DB', 5);
doc.save().font('Helvetica').fontSize(9).fillColor('#9CA3AF').text('Key  (e.g. MY_API_KEY)', spX+18, eY+79).restore();
// Value field
box(spX+12, eY+106, spW-24, 28, WH, '#D1D5DB', 5);
doc.save().font('Helvetica').fontSize(9).fillColor('#9CA3AF').text('Value  (e.g. sk-abc123...)', spX+18, eY+115).restore();
// Add button
box(spX+12, eY+142, spW-24, 30, B, null, 6);
doc.save().font('Helvetica-Bold').fontSize(10).fillColor(WH).text('+ Add Secret', spX+12, eY+151, {width:spW-24, align:'center'}).restore();

// Annotations with arrows
const labX = spX+spW+6;
// Step 1
doc.save().roundedRect(spX+8, spY+2, spW-16, 38, 5).strokeColor(GR).lineWidth(2).stroke().restore();
calloutBox(labX, spY+8, 'Open Secrets panel', GR);
arrow(labX, spY+16, spX+spW, spY+20, GR, 2);

// Step 2
doc.save().roundedRect(spX+8, eY+66, spW-16, 36, 5).strokeColor(B).lineWidth(2).stroke().restore();
calloutBox(labX, eY+72, '① Type the KEY name', B);
arrow(labX, eY+80, spX+spW, eY+82, B, 2);

// Step 3
doc.save().roundedRect(spX+8, eY+102, spW-16, 36, 5).strokeColor(YL).lineWidth(2).stroke().restore();
calloutBox(labX, eY+112, '② Paste the VALUE', YL, DK);
arrow(labX, eY+120, spX+spW, eY+118, YL, 2);

// Step 4
doc.save().roundedRect(spX+8, eY+138, spW-16, 36, 5).strokeColor(RD).lineWidth(2).stroke().restore();
calloutBox(labX, eY+148, '③ Click Add Secret', RD);
arrow(labX, eY+156, spX+spW, eY+156, RD, 2);

advY(296);

sectionBar('How to find the Secrets panel — in the left sidebar');
para('Look at the LEFT ICON BAR in the editor. Find the padlock icon 🔒. It may be labelled "Secrets". Click it to open the panel shown above.');

sectionBar('Read your Secret in code');
h2('JavaScript / Node.js:');
codeBlock([
    '// Reads the secret named MY_API_KEY from Replit Secrets',
    'const apiKey = process.env.MY_API_KEY;',
    '',
    "if (!apiKey) throw new Error('Missing MY_API_KEY secret!');",
    '',
    "fetch('https://api.openai.com/v1/...', {",
    '  headers: { Authorization: `Bearer ${apiKey}` }',
    '})',
],'JavaScript');

h2('Python:');
codeBlock([
    'import os',
    '',
    "api_key = os.environ.get('MY_API_KEY')",
    "if not api_key: raise ValueError('Missing MY_API_KEY secret!')",
    '',
    "print('API key loaded:', api_key[:6] + '...')  # safe preview",
],'Python');

// ─────────────────────────────────────────────────────────────────────────────
// CH 7 — DEPLOY
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(7, 'Deploy Your App Live', 'Give your app a real URL anyone can visit — 24/7', GR);

sectionBar('What deploying means');
para('Right now your app runs INSIDE Replit and stops when you close your browser. Deploying publishes it to a permanent server with a real URL. After deploying, the URL works even when your computer is off.');

sectionBar('Deploy with Replit — click-by-click with diagram');

need(330);
const dpY = Y();
const dpW = CW*0.74, dpX = L+(CW-dpW)/2;
browserBar(dpX, dpY, dpW, 'replit.com/@you/my-first-app');
box(dpX, dpY+28, dpW, 290, '#0D1117', null);
// Toolbar
box(dpX, dpY+28, dpW, 34, '#161B22', null);
doc.save().font('Helvetica').fontSize(8.5).fillColor('#58A6FF').text('my-first-app', dpX+10, dpY+41).restore();
box(dpX+dpW-120, dpY+35, 56, 20, '#238636', null, 4);
doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(WH).text('▶  Run', dpX+dpW-115, dpY+40).restore();
box(dpX+dpW-180, dpY+35, 54, 20, B, null, 4);
doc.save().font('Helvetica-Bold').fontSize(8.5).fillColor(WH).text('⬆ Deploy', dpX+dpW-175, dpY+40).restore();

// Editor area left
box(dpX, dpY+62, dpW*0.42, 256, '#0D1117', null);
doc.save().font('Courier').fontSize(7).fillColor('#3FB950').text('~/app $ npm run start', dpX+8, dpY+70).restore();
doc.save().font('Courier').fontSize(7).fillColor('#8B949E').text('Server listening on port 3000', dpX+8, dpY+83).restore();

// Deploy panel right
const dpPX = dpX+dpW*0.42, dpPW = dpW-dpW*0.42;
box(dpPX, dpY+62, dpPW, 256, '#161B22', null);
doc.save().font('Helvetica-Bold').fontSize(11).fillColor('#F0F6FC').text('Deploy', dpPX+12, dpY+74).restore();
doc.save().font('Helvetica').fontSize(8.5).fillColor('#8B949E').text('Publish your app live', dpPX+12, dpY+89).restore();

// Type cards
const dc1X = dpPX+10, dc1Y = dpY+106, dcW = (dpPW-26)/2;
box(dc1X, dc1Y, dcW, 52, '#21262D', B, 5);
doc.save().font('Helvetica-Bold').fontSize(9).fillColor('#58A6FF').text('Autoscale', dc1X+6, dc1Y+7).restore();
doc.save().font('Helvetica').fontSize(7.5).fillColor('#8B949E').text('Auto-scales.\nBest for web apps.', dc1X+6, dc1Y+22, {lineGap:2}).restore();
box(dc1X+dcW+6, dc1Y, dcW, 52, '#21262D', '#30363D', 5);
doc.save().font('Helvetica-Bold').fontSize(9).fillColor('#8B949E').text('Static', dc1X+dcW+12, dc1Y+7).restore();
doc.save().font('Helvetica').fontSize(7.5).fillColor('#8B949E').text('HTML/CSS/JS only,\nno backend.', dc1X+dcW+12, dc1Y+22, {lineGap:2}).restore();

// Run command
const rcy = dc1Y+62;
doc.save().font('Helvetica').fontSize(7.5).fillColor('#8B949E').text('RUN COMMAND', dpPX+10, rcy).restore();
box(dpPX+10, rcy+12, dpPW-20, 22, '#21262D', '#30363D', 4);
doc.save().font('Courier').fontSize(8.5).fillColor('#3FB950').text('npm run start', dpPX+16, rcy+18).restore();

// Deploy button
box(dpPX+10, rcy+42, dpPW-20, 28, B, null, 5);
doc.save().font('Helvetica-Bold').fontSize(9.5).fillColor(WH).text('Deploy →', dpPX+10, rcy+50, {width:dpPW-20, align:'center'}).restore();

// Live confirmation
const lcY = rcy+80;
box(dpPX+10, lcY, dpPW-20, 32, '#0D1117', GR, 5);
doc.circle(dpPX+22, lcY+10, 5).fill(GR);
doc.save().font('Helvetica-Bold').fontSize(8).fillColor(GR).text('DEPLOYED ✓', dpPX+30, lcY+6).restore();
doc.save().font('Courier').fontSize(7).fillColor('#58A6FF').text('https://my-app.you.repl.co', dpPX+16, lcY+19).restore();

// Annotations
doc.save().roundedRect(dpX+dpW-184, dpY+31, 62, 26, 4).strokeColor(RD).lineWidth(2.5).stroke().restore();
arrow(dpX+dpW*0.42-30, dpY+95, dpX+dpW-160, dpY+44, RD, 2);
calloutBox(dpX+dpW*0.42-100, dpY+82, '① Click Deploy', RD);

doc.save().roundedRect(dc1X-2, dc1Y-2, dcW+4, 56, 5).strokeColor(YL).lineWidth(2).stroke().restore();
arrow(dpPX-10, dc1Y+20, dc1X-2, dc1Y+26, YL, 1.5);
calloutBox(dpPX-90, dc1Y+14, '② Autoscale', YL, DK);

doc.save().roundedRect(dpPX+6, rcy+38, dpPW-12, 36, 5).strokeColor(GR).lineWidth(2).stroke().restore();
arrow(dpPX-10, rcy+54, dpPX+6, rcy+54, GR, 1.5);
calloutBox(dpPX-80, rcy+48, '③ Click Deploy!', GR);

advY(330);

numStep(1,'Click the ⬆ Deploy button in the toolbar','The blue button at the top — highlighted with the red box above.');
numStep(2,'Select "Autoscale"','For web apps with a backend (Node.js, Python). Select "Static" for HTML/CSS/JS only sites.');
numStep(3,'Set the run command','The command that starts your server. Node.js: npm run start  |  Python: python main.py');
numStep(4,'Click the blue Deploy button','Wait 1–3 minutes. When the green "DEPLOYED" message appears, you are live.');
numStep(5,'Share your URL','Copy the repl.co URL and share it. Anyone in the world can now visit your app.');

// ─────────────────────────────────────────────────────────────────────────────
// CH 8 — SHORTCUTS
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(8, 'Keyboard Shortcuts Cheat Sheet', 'Memorise these and you will code twice as fast', '#7C3AED');

sectionBar('Editor shortcuts — use every day');
const sc = [
    ['Ctrl + S','SAVE the file','Use after every few lines. Never forget this.'],
    ['Ctrl + Z','UNDO last change','Deleted something by mistake? Press immediately.'],
    ['Ctrl + Y','REDO (un-undo)','Undid too much? Redo brings it back.'],
    ['Ctrl + A','SELECT ALL text','Select everything in the current file.'],
    ['Ctrl + C','COPY selection','Select text first with mouse, then copy.'],
    ['Ctrl + X','CUT selection','Like copy but removes the original.'],
    ['Ctrl + V','PASTE','Paste at cursor position.'],
    ['Ctrl + F','FIND in file','Opens search box — type what you need.'],
    ['Ctrl + H','FIND + REPLACE','Change every occurrence of a word at once.'],
    ['Ctrl + /','COMMENT LINE','Disables or re-enables the selected line(s).'],
    ['Ctrl + D','Select next match','Highlight word → Ctrl+D selects the next one.'],
    ['Ctrl + Enter','RUN project','Same as clicking the ▶ Run button.'],
    ['Tab','INDENT right','Moves selected code right (adds spaces).'],
    ['Shift + Tab','INDENT left','Moves selected code left (removes spaces).'],
    ['Alt + ↑ / ↓','MOVE LINE','Moves current line up or down.'],
    ['Ctrl + Shift + P','COMMAND PALETTE','Search for any editor command by name.'],
];
sc.forEach((s, i) => {
    need(26);
    const sy = Y();
    doc.rect(L, sy, CW, 23).fill(i%2===0 ? '#F8FAFC' : WH);
    box(L+2, sy+3, 134, 17, DK, null, 3);
    doc.save().font('Courier-Bold').fontSize(8.5).fillColor('#86EFAC').text(s[0], L+6, sy+6, {width:128}).restore();
    doc.save().font('Helvetica-Bold').fontSize(9.5).fillColor(B).text(s[1], L+142, sy+6, {width:120}).restore();
    doc.save().font('Helvetica').fontSize(8.5).fillColor(MID).text(s[2], L+266, sy+6, {width:CW-270}).restore();
    advY(23);
});

advY(8);
sectionBar('Shell commands — must know');
const shellCmds = [
    ['node --version','Check Node.js version'],
    ['npm install','Install all packages from package.json'],
    ['npm install express','Install a specific package'],
    ['npm run dev','Start development server (hot-reload)'],
    ['npm run build','Build the app for deployment'],
    ['npm run start','Run the production server'],
    ['ls','List all files and folders here'],
    ['cd src','Enter the folder called "src"'],
    ['cd ..','Go back up one folder level'],
    ['mkdir components','Create a new folder called "components"'],
    ['touch Button.jsx','Create a new empty file'],
    ['clear','Clear the terminal screen'],
];
shellCmds.forEach(([c, d]) => {
    need(30);
    const cy = Y();
    box(L, cy, 174, 24, SH, null, 4);
    doc.rect(L, cy, 4, 24).fill(B);
    doc.save().font('Courier-Bold').fontSize(9).fillColor('#F0883E').text('$', L+8, cy+7).restore();
    doc.save().font('Courier').fontSize(9).fillColor('#3FB950').text(c, L+20, cy+7, {width:152}).restore();
    doc.save().font('Helvetica').fontSize(9.5).fillColor(MID).text(d, L+180, cy+7, {width:CW-184}).restore();
    advY(28);
});

// ─────────────────────────────────────────────────────────────────────────────
// CH 9 — ERRORS
// ─────────────────────────────────────────────────────────────────────────────
addPage();
pageHeader(9, 'Common Errors & How to Fix Them', 'Read the error — it tells you exactly what is wrong', RD);

sectionBar('How to read an error message');
para('When something breaks, click the Console tab in the right panel. You will see red text. ALWAYS read it carefully:');

need(90);
const emY = Y();
box(L, emY, CW, 80, SH, null, 6);
doc.rect(L, emY, 4, 80).fill(RD);
doc.save().font('Courier-Bold').fontSize(10).fillColor('#F85149')
   .text('ReferenceError: myVariable is not defined', L+12, emY+10).restore();
doc.save().font('Courier').fontSize(9).fillColor('#8B949E')
   .text('    at script.js:14:5', L+12, emY+28).restore();
doc.save().font('Courier').fontSize(8.5).fillColor('#6E7681')
   .text('    at HTMLButtonElement.<anonymous> (index.html:12)', L+12, emY+43).restore();

arrow(L+CW-50, emY+14, L+CW*0.77, emY+14, RD, 1.5);
calloutBox(L+CW-48, emY+8, 'Error type + message', RD);
arrow(L+CW-50, emY+32, L+CW*0.56, emY+32, YL, 1.5);
calloutBox(L+CW-48, emY+26, 'Filename + line 14 ← go here', YL, DK);
advY(88);

tip('💡', 'In the Console, CLICK on the filename (e.g. "script.js:14") — Replit will jump your cursor to exactly line 14 in the code editor so you can fix it immediately.', LB, B);

sectionBar('The most common errors and how to fix them');

const errs = [
    {
        name:'ReferenceError: X is not defined',
        why: 'You used a variable before declaring it, or misspelled the name.',
        bad: ['console.log(myNmae);  // typo — "Nmae" not "Name"'],
        fix: ["const myName = 'Charlie';", 'console.log(myName);  // correct spelling'],
    },
    {
        name:'SyntaxError: Unexpected token',
        why: 'Missing bracket, parenthesis, or comma. Look at the line number the error shows.',
        bad: ['function greet( {  // ← missing ) before {', '  return "hi";', '}'],
        fix: ['function greet() {', '  return "hi";', '}'],
    },
    {
        name:"TypeError: Cannot read properties of undefined (reading 'name')",
        why: "You used .name on a variable that is empty (undefined). Check it has a value first.",
        bad: ['console.log(user.name);  // crashes if user is undefined'],
        fix: ['if (user && user.name) {', '  console.log(user.name);  // safe', '}'],
    },
    {
        name:"Cannot find module 'express'",
        why: "You imported a package but forgot to install it. Open the Shell and run npm install.",
        bad: ["const e = require('express');  // ← crashes, not installed"],
        fix: ['// In Shell tab, run:', '// $ npm install express', '// Then your require() will work.'],
    },
    {
        name:'Each child in a list needs a "key" prop (React only)',
        why: 'When you use .map() in React, every item needs a unique key attribute.',
        bad: ['{items.map(item => <li>{item.name}</li>)}'],
        fix: ['{items.map(item => <li key={item.id}>{item.name}</li>)}'],
    },
];

errs.forEach(err => {
    const maxLines = Math.max(err.bad.length, err.fix.length);
    const codeH = maxLines * 13 + 12;
    need(codeH + 68);
    const ey = Y();
    box(L, ey, CW, 26, LR, null, 5);
    doc.rect(L, ey, 4, 26).fill(RD);
    doc.save().font('Courier-Bold').fontSize(9.5).fillColor(RD).text(err.name, L+10, ey+8, {width:CW-14}).restore();
    advY(30);
    doc.save().font('Helvetica').fontSize(9.5).fillColor(MID).text('Why: '+err.why, L+4, Y(), {width:CW-8, lineGap:2}).restore();
    advY(doc.heightOfString('Why: '+err.why, {fontSize:9.5,font:'Helvetica',width:CW-8,lineGap:2})+6);
    const cy = Y();
    // Bad
    box(L, cy, CW/2-6, codeH, SH, null, 4);
    doc.save().font('Helvetica-Bold').fontSize(7.5).fillColor(RD).text('❌ WRONG', L+6, cy+3).restore();
    err.bad.forEach((line, i) => {
        doc.save().font('Courier').fontSize(8).fillColor('#F85149').text(line, L+6, cy+14+i*13, {width:CW/2-14}).restore();
    });
    // Fix
    box(L+CW/2+6, cy, CW/2-6, codeH, SH, null, 4);
    doc.save().font('Helvetica-Bold').fontSize(7.5).fillColor(GR).text('✅ FIX', L+CW/2+12, cy+3).restore();
    err.fix.forEach((line, i) => {
        doc.save().font('Courier').fontSize(8).fillColor('#3FB950').text(line, L+CW/2+12, cy+14+i*13, {width:CW/2-18}).restore();
    });
    advY(codeH + 10);
});

sectionBar('Quick checklist when something breaks');
bullets([
    'Preview is blank → click the Console tab and read the red error message.',
    'Code does not update after editing → press Ctrl + S to save, then click ▶ Run again.',
    'Packages seem missing → open the Shell tab and run: npm install',
    '"command not found: node" → your project is Python-based; use python instead.',
    'Changes not saving → check you are editing the right file (look at the tab title).',
    'Error on "line 14" → click that filename in the Console to jump to that line in the editor.',
]);

// ─────────────────────────────────────────────────────────────────────────────
// BACK / CLOSING PAGE
// ─────────────────────────────────────────────────────────────────────────────
addPage();
// top band
doc.rect(0, 0, PW, 8).fill(B);
// hero text
doc.save().font('Helvetica-Bold').fontSize(11).fillColor(B)
   .text('YOU ARE READY TO BUILD', 0, 160, {width:PW, align:'center', characterSpacing:2}).restore();
doc.save().font('Helvetica-Bold').fontSize(32).fillColor(DK)
   .text('Now go build something! 🚀', 0, 186, {width:PW, align:'center'}).restore();
doc.save().font('Helvetica').fontSize(12).fillColor(MID)
   .text('Every great developer started exactly where you are right now.\nYou have the tools. You have the code. Just start typing.', 0, 236, {width:PW, align:'center', lineGap:5}).restore();

// divider
doc.rect(L, 286, CW, 1).fill('#E2E8F0');

// checklist box
box(L, 300, CW, 310, LB, '#BFDBFE', 12);
doc.save().font('Helvetica-Bold').fontSize(12).fillColor(B).text('What you now know how to do:', L+20, 316).restore();
const sumItems = [
    '✅  Create a Replit account and your first project',
    '✅  Navigate the editor: files, code, preview, shell',
    '✅  Write HTML, CSS, and JavaScript from scratch',
    '✅  Build a landing page with navbar, hero, and features',
    '✅  Build a signup page and login page with working forms',
    '✅  Install packages with npm install',
    '✅  Build a React app with components and useState',
    '✅  Keep API keys safe using Replit Secrets',
    '✅  Deploy your app live for anyone to visit',
    '✅  Read error messages and fix them',
];
sumItems.forEach((item, i) => {
    doc.save().font('Helvetica').fontSize(11).fillColor(i<5?DK:B).text(item, L+20, 340+i*26).restore();
});

doc.save().font('Helvetica').fontSize(8.5).fillColor('#94A3B8')
   .text('replit.com  ·  Complete Visual Beginner\'s Guide', 0, PH-26, {width:PW, align:'center'}).restore();

// ─────────────────────────────────────────────────────────────────────────────
doc.end();
doc.on('end', () => {
    const s = fs.statSync(OUT);
    console.log('✅ PDF done: ' + OUT + '  (' + (s.size/1024).toFixed(0) + ' KB)');
});
