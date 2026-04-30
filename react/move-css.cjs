/**
 * Post-build helper: move generated CSS bundles from js/ext/ to css/ext/.
 * Vite emits assets next to the JS entry by default; SelfHelp expects
 * stylesheets under css/ext/ so the StyleView's get_css_includes() picks
 * them up.
 */
const fs = require('fs');
const path = require('path');

const targets = [
  { src: 'agentic-chat.css', dst: 'agentic-chat.css' },
  { src: 'agentic-admin.css', dst: 'agentic-admin.css' },
];

const jsDir = path.join(__dirname, '..', 'js', 'ext');
const cssDir = path.join(__dirname, '..', 'css', 'ext');

if (!fs.existsSync(cssDir)) {
  fs.mkdirSync(cssDir, { recursive: true });
}

let moved = 0;
for (const t of targets) {
  const srcPath = path.join(jsDir, t.src);
  const dstPath = path.join(cssDir, t.dst);
  if (fs.existsSync(srcPath)) {
    fs.renameSync(srcPath, dstPath);
    console.log('Moved', t.src, '->', dstPath);
    moved++;
  }
}

if (moved === 0) {
  console.log('No CSS files to move.');
}
