const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, '..', 'Replit-Beginners-Guide.pdf');
const doc = new PDFDocument({
    size: 'A4', margin: 50,
    info: { Title: "Build Your App on Replit — Beginner's Guide", Author: 'Guide' }
});
doc.pipe(fs.createWriteStream(OUT));

const W = doc.page.width - 100;
const BLUE  = '#3B82F6';
const DARK  = '#1E293B';
const GRAY  = '#64748B';
const RED   = '#EF4444';
const YELL  = '#F59E0B';

// ─── helpers ──────────────────────────────────────────────────────────────────
function topBanner(title, sub) {
    doc.rect(0, 0, doc.page.width, 88).fill(BLUE);
    doc.fillColor('white').fontSize(20).font('Helvetica-Bold').text(title, 50, 22, { width: W });
    doc.fontSize(10).font('Helvetica').text(sub, 50, 54, { width: W });
    doc.fillColor(DARK);
    doc.y = 108;
}

function sectionBar(t) {
    doc.moveDown(0.4);
    const y = doc.y;
    doc.rect(50, y, W, 26).fill(BLUE);
    doc.fillColor('white').fontSize(12).font('Helvetica-Bold')
       .text(t, 58, y + 7, { width: W - 16 });
    doc.fillColor(DARK);
    doc.moveDown(0.7);
}

function h2(t) {
    doc.moveDown(0.4);
    doc.fontSize(11).font('Helvetica-Bold').fillColor(DARK).text(t);
    doc.moveDown(0.2);
}

function para(t) {
    doc.fontSize(10).font('Helvetica').fillColor('#334155').text(t, { lineGap: 3 });
    doc.moveDown(0.3);
}

function bullets(items) {
    items.forEach(item => {
        const bx = 62, by = doc.y;
        doc.circle(bx - 8, by + 5, 3).fill(BLUE);
        doc.fillColor('#334155').fontSize(10).font('Helvetica')
           .text(item, bx, by, { width: W - 22, lineGap: 2 });
        doc.moveDown(0.18);
    });
    doc.moveDown(0.25);
}

function step(num, title, body) {
    doc.moveDown(0.3);
    const sy = doc.y;
    doc.rect(50, sy, 26, 26).fill(BLUE);
    doc.fillColor('white').fontSize(12).font('Helvetica-Bold')
       .text(String(num), 50, sy + 6, { width: 26, align: 'center' });
    doc.fillColor(DARK).fontSize(11).font('Helvetica-Bold')
       .text(title, 84, sy + 7, { width: W - 36 });
    doc.moveDown(0.35);
    doc.fontSize(10).font('Helvetica').fillColor('#334155')
       .text(body, 84, doc.y, { width: W - 36, lineGap: 3 });
    doc.moveDown(0.4);
}

function cmdBlock(label, command) {
    if (label) {
        doc.moveDown(0.15);
        doc.fontSize(8.5).font('Helvetica-Bold').fillColor(GRAY).text(label.toUpperCase());
    }
    doc.rect(50, doc.y, W, 21).fill('#0F172A');
    doc.fillColor('#86EFAC').fontSize(9).font('Courier')
       .text('$ ' + command, 60, doc.y - 16, { width: W - 20 });
    doc.fillColor(DARK);
    doc.moveDown(0.5);
}

function tip(icon, text, color) {
    color = color || YELL;
    doc.moveDown(0.2);
    const ty = doc.y;
    const lines = doc.heightOfString(icon + '  ' + text, { width: W - 22, fontSize: 9.5 });
    const boxH = Math.max(28, lines + 16);
    doc.rect(50, ty, W, boxH).fill(color + '15');
    doc.rect(50, ty, 4, boxH).fill(color);
    doc.fontSize(9.5).font('Helvetica').fillColor('#334155')
       .text(icon + '  ' + text, 62, ty + 8, { width: W - 22, lineGap: 2 });
    doc.fillColor(DARK);
    doc.moveDown(0.55);
}

function codeBox(lines, color) {
    color = color || '#86EFAC';
    const h = lines.length * 14 + 12;
    doc.rect(50, doc.y, W, h).fill('#0F172A');
    doc.fillColor(color).fontSize(9).font('Courier')
       .text(lines.join('\n'), 62, doc.y - h + 8, { lineGap: 2 });
    doc.fillColor(DARK);
    doc.moveDown(0.5);
}

function newPage(title, sub) {
    doc.addPage();
    topBanner(title, sub);
}

// ─── COVER ────────────────────────────────────────────────────────────────────
doc.rect(0, 0, doc.page.width, doc.page.height).fill(BLUE);
doc.fillColor('white').fontSize(30).font('Helvetica-Bold')
   .text('Build Your App on Replit', 50, 160, { width: W, align: 'center' });
doc.fontSize(15).font('Helvetica')
   .text("A Complete Beginner's Guide", 50, 205, { width: W, align: 'center' });
doc.fillColor('#BFDBFE').fontSize(11)
   .text('Manual coding  ·  No AI needed  ·  Step-by-step', 50, 248, { width: W, align: 'center' });

const tocItems = [
    '1.  Getting started & creating your account',
    '2.  The Replit interface — every panel explained',
    '3.  Writing your first code (HTML → CSS → JavaScript)',
    '4.  Installing packages with npm and pip',
    '5.  Building a React app from scratch',
    '6.  Environment variables & keeping secrets safe',
    '7.  Deploying your app live on the internet',
    '8.  Keyboard shortcuts & pro tips',
    '9.  Common errors and how to fix them',
    '10. Full project build checklist',
];
doc.fillColor('white').fontSize(10).font('Helvetica-Bold').text('What you will learn:', 110, 300);
tocItems.forEach((item, i) => {
    doc.fillColor(i % 2 === 0 ? 'white' : '#BFDBFE').fontSize(10).font('Helvetica')
       .text(item, 110, doc.y + 5);
});
doc.fillColor('#93C5FD').fontSize(9).text('Made for developers who code manually from scratch', 50, 720, { width: W, align: 'center' });

// ─── CH 1: GETTING STARTED ────────────────────────────────────────────────────
newPage('Chapter 1: Getting Started', 'Create your free account and launch your first project');

sectionBar('1.1  Create Your Replit Account');
step(1, 'Go to replit.com', 'Open any browser and navigate to https://replit.com');
step(2, 'Click "Sign up"', 'Choose Google, GitHub, or sign up with your email address and a password.');
step(3, 'Confirm your email', 'Check your inbox and click the confirmation link Replit sends you.');
step(4, 'Choose the free plan', 'Click "Start for free" — the free plan is enough to build and deploy real apps.');

sectionBar('1.2  Create Your First Project');
step(1, 'Click the blue "+ Create Repl" button', 'Found on the left sidebar or the dashboard home screen.');
step(2, 'Pick a template', 'Search for the language you want:\n• "HTML, CSS, JS" → basic website\n• "Node.js" → backend / server\n• "React" → modern web app\n• "Python" → scripts, data, backend');
step(3, 'Name your project', 'Type a short name in the "Title" box, e.g. "my-first-app". No spaces — use hyphens.');
step(4, 'Click "Create Repl"', 'Replit sets up your project in a few seconds and opens the code editor.');

tip('💡', 'A "Repl" is just what Replit calls a project. One Repl = one application or script.');

sectionBar('1.3  The Dashboard Overview');
bullets([
    'Home  —  recent projects and a quick-create button',
    'My Repls  —  the full list of everything you have built',
    'Explore  —  browse public projects from other developers',
    'Teams  —  for collaborating with others (skip this for now)',
    'Account avatar (top right)  —  settings, billing, profile',
]);

// ─── CH 2: THE EDITOR ────────────────────────────────────────────────────────
newPage('Chapter 2: The Editor — Every Panel Explained', 'Know exactly what you are looking at');

sectionBar('2.1  The Three Main Panels');
h2('Left Panel — File Explorer');
para('All your project files and folders live here. It works like Windows Explorer or Mac Finder for your code.');
bullets([
    'Click a file  →  opens it in the editor',
    'Right-click a file  →  rename, delete, move, duplicate',
    'Click the + icon  →  create a new file or a new folder',
]);

h2('Middle Panel — Code Editor');
para('This is where you type your code. Keywords are coloured automatically — that is called syntax highlighting.');
bullets([
    'Click in the editor and start typing',
    'Ctrl + S  (Cmd + S on Mac)  →  saves the file',
    'Ctrl + Z  →  undo last change',
    'Ctrl + /  →  comment or uncomment a line',
    'Tab  →  indent a line; Shift + Tab  →  un-indent',
]);

h2('Right Panel — Output / Console / Shell');
para('This panel has multiple tabs:');
bullets([
    'Output / Preview  →  shows your running app (the live website or printed text)',
    'Console  →  shows messages your code prints; red text = error messages',
    'Shell  →  a real Linux terminal where you type commands directly',
]);

sectionBar('2.2  The Top Toolbar Buttons');
const buttons = [
    ['▶ Run', 'Start your app — same as pressing Ctrl + Enter'],
    ['Stop ■', 'Stop the running app'],
    ['Fork', 'Make a copy of someone else\'s public project'],
    ['Share', 'Get a sharable link or invite a collaborator'],
    ['Deploy', 'Publish your app live so anyone can access it'],
];
buttons.forEach((b, i) => {
    const y = doc.y;
    if (i % 2 === 0) doc.rect(50, y - 2, W, 18).fill('#F8FAFC');
    doc.roundedRect(50, y, 80, 16, 3).fill(BLUE);
    doc.fillColor('white').fontSize(8.5).font('Helvetica-Bold').text(b[0], 50, y + 4, { width: 80, align: 'center' });
    doc.fillColor('#334155').fontSize(9.5).font('Helvetica').text('← ' + b[1], 138, y + 4, { width: W - 92 });
    doc.fillColor(DARK);
    doc.moveDown(0.35);
});

doc.moveDown(0.3);
sectionBar('2.3  Essential Shell Commands');
para('The Shell tab is a real Linux terminal. These are the only commands you need to know at first:');
cmdBlock('Check your Node.js version', 'node --version');
cmdBlock('List files in the current folder', 'ls');
cmdBlock('Go into a folder called "src"', 'cd src');
cmdBlock('Go back up one level', 'cd ..');
cmdBlock('Show the current folder path', 'pwd');
cmdBlock('Create a new empty file', 'touch myfile.txt');
cmdBlock('Create a new folder', 'mkdir myfolder');

// ─── CH 3: WRITING CODE ───────────────────────────────────────────────────────
newPage('Chapter 3: Writing Code Manually', 'Your first HTML page, then CSS and JavaScript');

sectionBar('3.1  A Complete HTML Page');
para('If you chose an "HTML, CSS, JS" template, open index.html. Clear everything and type this manually — do not paste it, typing it builds the skill:');
codeBox([
    '<!DOCTYPE html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <title>My First App</title>',
    '    <link rel="stylesheet" href="style.css" />',
    '  </head>',
    '  <body>',
    '    <h1>Hello, World!</h1>',
    '    <p>I built this myself.</p>',
    '    <script src="script.js"></script>',
    '  </body>',
    '</html>',
]);
para('Press Ctrl + S to save. Click ▶ Run. You should see "Hello, World!" in the Preview panel.');

sectionBar('3.2  Adding CSS');
para('Create a new file called "style.css" (click the + icon). Type:');
codeBox([
    'body {',
    '  font-family: Arial, sans-serif;',
    '  background: #1e293b;',
    '  color: white;',
    '  text-align: center;',
    '  padding: 50px;',
    '}',
    'h1 { color: #3b82f6; font-size: 2rem; }',
], '#93C5FD');
para('Save and click Run again. The page should now be dark with a blue heading.');

sectionBar('3.3  Adding JavaScript');
para('Create a new file called "script.js". Type:');
codeBox([
    "document.querySelector('h1')",
    "  .addEventListener('click', function () {",
    "    alert('You clicked it!');",
    "  });",
], '#FDE68A');
para('Save and run. Click the heading in the Preview — a popup should appear.');

// ─── CH 4: PACKAGES ──────────────────────────────────────────────────────────
newPage('Chapter 4: Installing Packages', 'Add ready-made libraries to your project');

sectionBar('4.1  What Is a Package?');
para('A package is code someone else already wrote. Instead of building everything from scratch, you install a package and use it. For example, "express" makes building a web server easy; "axios" makes calling APIs easy.');

sectionBar('4.2  npm — Node.js Package Manager');
cmdBlock('Install a package', 'npm install express');
cmdBlock('Install a dev-only package', 'npm install --save-dev nodemon');
cmdBlock('Install multiple at once', 'npm install axios dotenv lodash');
cmdBlock('Remove a package', 'npm uninstall express');
cmdBlock('See all installed packages', 'npm list --depth=0');
tip('💡', 'After npm install, a folder called node_modules appears. Never edit files inside it — it is auto-generated.');

sectionBar('4.3  pip — Python Package Manager');
cmdBlock('Install a package', 'pip install flask');
cmdBlock('Install from a requirements file', 'pip install -r requirements.txt');
cmdBlock('See installed packages', 'pip list');

sectionBar('4.4  The package.json File (Node.js)');
para('This is your project\'s config file. It is created automatically and lists all packages and scripts.');
bullets([
    '"name"  —  the name of your project',
    '"scripts"  —  commands you run with npm run <name>',
    '"dependencies"  —  packages needed when the app runs',
    '"devDependencies"  —  packages only needed during development',
]);
cmdBlock('Run the "start" script', 'npm run start');
cmdBlock('Run the "dev" script (common for local development)', 'npm run dev');
cmdBlock('Run the "build" script (compiles/bundles the app)', 'npm run build');
tip('⚠️', 'Never delete package.json or package-lock.json. They track exactly what your project needs.', RED);

// ─── CH 5: REACT ─────────────────────────────────────────────────────────────
newPage('Chapter 5: Building a React App', 'The most popular way to build modern web interfaces');

sectionBar('5.1  What Is React?');
para('React is a JavaScript library for building user interfaces. Instead of one big HTML file, you build small reusable pieces called "components". Each component is a JavaScript function that returns HTML-like code called JSX.');

sectionBar('5.2  Start a React Project on Replit');
step(1, 'Click "+ Create Repl"', 'Go to your dashboard and click the create button.');
step(2, 'Search for "React"', 'Select the "React" or "React + Vite" template.');
step(3, 'Name your project', 'Example: "my-react-app". Then click Create.');
step(4, 'Click ▶ Run', 'Replit installs dependencies automatically and opens a default React page in the Preview.');

sectionBar('5.3  Folder Structure of a React App');
bullets([
    'src/  →  all your source code goes here',
    'src/main.jsx  →  the entry point — the starting file React reads first',
    'src/App.jsx  →  the main component — start building here',
    'public/  →  static files like favicon and the base index.html',
    'package.json  →  project config and dependencies',
    'vite.config.js  →  build tool config (leave it as-is for now)',
]);

sectionBar('5.4  Your First React Component');
para('Open src/App.jsx and replace ALL content with this:');
codeBox([
    "import { useState } from 'react';",
    '',
    'function App() {',
    '  const [count, setCount] = useState(0);',
    '',
    '  return (',
    '    <div style={{ textAlign: "center", padding: "50px" }}>',
    '      <h1>My React App</h1>',
    '      <p>Count: {count}</p>',
    '      <button onClick={() => setCount(count + 1)}>',
    '        Click me',
    '      </button>',
    '    </div>',
    '  );',
    '}',
    '',
    'export default App;',
]);
para('Save (Ctrl + S). The Preview auto-refreshes. Click the button — the count goes up.');

sectionBar('5.5  Key React Rules');
bullets([
    'Component names MUST start with a capital letter:  function MyButton() {}',
    'Return exactly ONE parent element — wrap multiple elements in <div> or <>',
    'Use {curly braces} to insert JS values in JSX:  <p>{myVariable}</p>',
    'useState() creates a variable React watches — when it changes, the screen updates',
    'Pass data into components with props:  <Button color="blue" label="Click" />',
]);

// ─── CH 6: SECRETS ───────────────────────────────────────────────────────────
newPage('Chapter 6: Environment Variables & Secrets', 'Keep API keys and passwords safe');

sectionBar('6.1  Why You Need This');
para('An environment variable is a setting stored outside your code. Use them for sensitive values — API keys, database passwords, access tokens — things you must NEVER put directly in your code files.');
tip('⚠️', 'NEVER paste API keys or passwords into your code files. If your repo is public, anyone can steal them.', RED);

sectionBar('6.2  Adding Secrets in Replit');
step(1, 'Click the padlock icon 🔒', 'Find it in the left sidebar, labelled "Secrets".');
step(2, 'Click "+ New Secret"', 'A form with two fields appears: Key and Value.');
step(3, 'Enter the Key', 'This is the name you will use in your code, e.g.  MY_API_KEY');
step(4, 'Enter the Value', 'Paste your actual secret value here, e.g.  sk-abc123...');
step(5, 'Click "Add Secret"', 'Done. The secret is encrypted and available to your code as an environment variable.');

sectionBar('6.3  Using Secrets in Your Code');
h2('JavaScript / Node.js:');
codeBox([
    'const apiKey = process.env.MY_API_KEY;',
    "console.log('Key:', apiKey);",
]);
h2('Python:');
codeBox([
    'import os',
    "api_key = os.environ.get('MY_API_KEY')",
    "print('Key:', api_key)",
]);

sectionBar('6.4  The .env File');
para('Some projects use a ".env" file. Create it in your project root and add lines like:');
codeBox([
    'MY_API_KEY=sk-abc123yourkeyhere',
    'DATABASE_URL=postgresql://user:pass@host/db',
], '#FDE68A');
tip('💡', 'Add ".env" to a file called ".gitignore" so it is never pushed to GitHub.');
cmdBlock('Install dotenv (reads your .env file in Node.js)', 'npm install dotenv');
para('Then add this as the very first line of your main JS file:');
codeBox(["require('dotenv').config();"]);

// ─── CH 7: DEPLOYING ─────────────────────────────────────────────────────────
newPage('Chapter 7: Deploying Your App', 'Make your app live on the internet for anyone to visit');

sectionBar('7.1  What Does "Deploy" Mean?');
para('Right now your app only runs inside Replit — no one else can access it. Deploying publishes your app to a live server with a real public URL that works 24/7, even when you close your browser.');

sectionBar('7.2  Deploy with Replit (Easiest Way)');
step(1, 'Click the "Deploy" button', 'Find it in the top toolbar of the editor. A deployment panel opens.');
step(2, 'Choose a deployment type', '"Autoscale" is best for web apps — it scales automatically.\n"Static" is for HTML/CSS/JS sites with no backend server.');
step(3, 'Set your run command', 'This is the command that starts your app, e.g.  npm run start');
step(4, 'Click "Deploy"', 'Replit builds and publishes your app. This takes 1–3 minutes.');
step(5, 'Get your live URL', 'Replit gives you a URL like https://my-app.username.repl.co — share it with anyone.');
tip('💡', 'The free plan gives you a repl.co subdomain. Paid plans let you connect a custom domain (e.g. mysite.com).');

sectionBar('7.3  Saving Your Code to GitHub');
para('GitHub is a website that stores your code and tracks every change you make. This is called "version control". It is the industry standard — every professional developer uses it.');
step(1, 'Create a free GitHub account', 'Go to github.com and sign up.');
step(2, 'Create a new repository', 'Click the green "New" button. Name it the same as your project.');
step(3, 'Connect in Replit', 'In your Repl, click the Git icon (branch icon 🌿) in the left sidebar. Sign in to GitHub and link your repository.');
step(4, 'Commit your work', 'Type a short message describing what you did (e.g. "Add homepage"), then click "Commit & push".');
cmdBlock('Or do it in the Shell — add all files', 'git add .');
cmdBlock('Save a snapshot with a message', 'git commit -m "Add homepage"');
cmdBlock('Upload to GitHub', 'git push origin main');
tip('💡', 'Commit at least once per session. If you break something, you can always roll back to a previous save.');

// ─── CH 8: SHORTCUTS ─────────────────────────────────────────────────────────
newPage('Chapter 8: Keyboard Shortcuts & Pro Tips', 'Work faster without touching the mouse');

sectionBar('8.1  Must-Know Shortcuts in Replit');
const shortcuts = [
    ['Ctrl + S', 'Save the current file'],
    ['Ctrl + Z', 'Undo last change'],
    ['Ctrl + Y  /  Ctrl + Shift + Z', 'Redo'],
    ['Ctrl + C  /  Ctrl + X  /  Ctrl + V', 'Copy / Cut / Paste'],
    ['Ctrl + A', 'Select all text in the file'],
    ['Ctrl + F', 'Find text in the current file'],
    ['Ctrl + H', 'Find and replace text'],
    ['Ctrl + /', 'Comment or uncomment selected lines'],
    ['Ctrl + D', 'Select next occurrence of highlighted word'],
    ['Alt + ↑ / ↓', 'Move current line up or down'],
    ['Ctrl + Enter', 'Run the project (same as ▶ Run button)'],
    ['Ctrl + Shift + P', 'Open command palette — search any editor command'],
    ['Tab', 'Indent selected code right'],
    ['Shift + Tab', 'Un-indent selected code left'],
    ['Ctrl + G', 'Go to a specific line number'],
    ['Ctrl + L', 'Select the entire current line'],
];
shortcuts.forEach((s, i) => {
    const y = doc.y;
    doc.rect(50, y - 1, W, 17).fill(i % 2 === 0 ? '#F8FAFC' : 'white');
    doc.rect(50, y - 1, 175, 17).fill(BLUE + (i % 2 === 0 ? '18' : '10'));
    doc.fillColor(BLUE).fontSize(8.8).font('Courier').text(s[0], 56, y + 3, { width: 167 });
    doc.fillColor('#334155').fontSize(9).font('Helvetica').text(s[1], 232, y + 3, { width: W - 186 });
    doc.moveDown(0.05);
});

doc.moveDown(0.4);
sectionBar('8.2  Developer Pro Tips');
bullets([
    'Read error messages fully — they tell you the exact file and line number.',
    'Google the error message in quotes — millions of developers had the same problem.',
    'Use console.log() in JS or print() in Python to inspect what a variable contains.',
    'Save with Ctrl + S before clicking Run — the editor might have unsaved changes.',
    'If the Preview is blank, check the Console tab for red error messages first.',
    'Keep functions short — one function should do ONE thing. Over 30 lines? Break it up.',
    'Commit your code to GitHub at the end of every coding session.',
    'Comment your code: // what this does in JS, or # what this does in Python.',
    'If packages seem broken, restart the Shell: click the ⋮ menu → "Restart shell".',
    'Test on mobile: resize the preview panel narrow to check your layout.',
]);

// ─── CH 9: ERRORS ────────────────────────────────────────────────────────────
newPage('Chapter 9: Common Errors & How to Fix Them', 'Every developer hits these — here is how to solve them');

sectionBar('9.1  JavaScript / Node.js Errors');
h2('ReferenceError: myVariable is not defined');
para('You used a variable before declaring it, or you misspelled its name. Check the exact spelling.');
codeBox([
    "console.log(myNmae);           // ❌ typo",
    "const myName = 'Charlie';",
    'console.log(myName);           // ✅ correct',
]);

h2('SyntaxError: Unexpected token');
para('There is a structural typo — a missing bracket, parenthesis, or comma. Look at the line the error points to and check for missing  { }  ( )  [ ]  or  ,');

h2("TypeError: Cannot read properties of undefined (reading 'name')");
para('You tried to use .name on a variable that is undefined (empty). Check the variable has data first:');
codeBox(["if (user && user.name) { console.log(user.name); }  // ✅ safe"]);

h2("Error: Cannot find module 'express'");
para('You forgot to install the package. Go to the Shell and run:');
cmdBlock('', 'npm install express');

sectionBar('9.2  React Errors');
h2('Each child in a list should have a unique "key" prop');
para('When you use .map() to render a list, each item needs a key:');
codeBox(["{items.map(item => <li key={item.id}>{item.name}</li>)}"]);

h2('React Hook "useState" cannot be called conditionally');
para('Hooks must ALWAYS be called at the top of your component function, never inside an if-block or loop.');

h2('JSX element has no corresponding closing tag');
para('Every JSX element must be closed. Self-closing tags need a slash:  <br />  <img />');

sectionBar('9.3  General Quick Fixes');
bullets([
    'App not updating after code change  →  click ▶ Run again',
    '"command not found: node"  →  your project is Python-based, not Node.js',
    'Blank preview, no errors  →  check that your start command is correct in the Run config',
    '"Permission denied" in Shell  →  try adding sudo before the command',
    'node_modules folder missing  →  run  npm install  in the Shell',
    'Changes not saving  →  confirm you are in the right file tab (check the tab name)',
]);

// ─── CH 10: CHECKLIST ────────────────────────────────────────────────────────
newPage('Chapter 10: Full Project Build Checklist', 'Use this every time you start a new application');

sectionBar('Phase 1 — Plan (Before you touch code)');
para('Spending 15 minutes planning saves hours of rewriting.');
bullets([
    '☐  Write one sentence: "This app lets users ___"',
    '☐  List every page or screen the app needs',
    '☐  Sketch a rough layout on paper (boxes are fine)',
    '☐  List what data the app stores',
    '☐  Choose your stack: plain HTML? React? Node + React? Python?',
]);

sectionBar('Phase 2 — Setup');
bullets([
    '☐  Create a new Repl with the right template',
    '☐  Connect to a GitHub repo (git init and link in the sidebar)',
    '☐  Set up folder structure: src/, public/, components/',
    '☐  Install all required packages (npm install ...)',
    '☐  Add API keys and passwords to Secrets (padlock icon)',
]);

sectionBar('Phase 3 — Build');
bullets([
    '☐  Build the HTML structure first (index.html or App.jsx)',
    '☐  Add CSS to style the layout',
    '☐  Add JavaScript logic (buttons, forms, data)',
    '☐  Connect to any APIs or backend services',
    '☐  Test each feature as you finish it — do not wait until the end',
    '☐  Commit to GitHub at the end of each coding session',
]);

sectionBar('Phase 4 — Test & Fix');
bullets([
    '☐  Click every button and fill out every form in the Preview',
    '☐  Open the Console tab and fix every red error',
    '☐  Resize the Preview to a phone width and check the layout',
    '☐  Fix all errors before deploying',
]);

sectionBar('Phase 5 — Deploy');
bullets([
    '☐  Click the "Deploy" button in the top toolbar',
    '☐  Set the correct run and build commands',
    '☐  Wait for the green "Deployed" status message',
    '☐  Visit your live URL and test it end-to-end',
    '☐  Share the URL with a friend or family member to get feedback',
]);

tip('🏆', 'You have built and deployed your own app. Every great developer started exactly where you are. Keep building!', '#22C55E');

// ─── BACK COVER ───────────────────────────────────────────────────────────────
doc.addPage();
doc.rect(0, 0, doc.page.width, doc.page.height).fill(DARK);
doc.fillColor(BLUE).fontSize(30).font('Helvetica-Bold')
   .text("You've got this! 🚀", 50, 240, { width: W, align: 'center' });
doc.fillColor('white').fontSize(13).font('Helvetica').text(
    'Every great developer started exactly where you are right now.\nKeep building. Keep breaking things. Keep learning.',
    50, 300, { width: W, align: 'center', lineGap: 8 });
doc.fillColor('#94A3B8').fontSize(9)
   .text('replit.com  ·  Made for manual coders', 50, 720, { width: W, align: 'center' });

doc.end();
doc.on('end', () => console.log('Done: ' + OUT));
