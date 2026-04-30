/**
 * Gulp Build Configuration for LLM Agentic Chat Plugin
 * =====================================================
 *
 * Compiles two React UMD bundles via Vite:
 *   - js/ext/agentic-chat.umd.js   (frontend chat surface, used by agenticChat style)
 *   - js/ext/agentic-admin.umd.js  (admin module page sh_module_llm_agentic_chat)
 *
 * Both bundles share React/ReactDOM and are emitted alongside their CSS files
 * (css/ext/agentic-chat.css, css/ext/agentic-admin.css).
 *
 * Tasks:
 *   gulp react-install  -> npm install in ../react
 *   gulp react-build    -> npm run build (chat + admin + CSS move)
 *   gulp react-watch    -> vite build --watch (chat bundle)
 *   gulp clean          -> remove built artefacts
 *   gulp                -> alias for react-build
 */

const gulp = require('gulp');
const { exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const paths = {
  react: {
    src: path.join(__dirname, '../react'),
    jsOut: path.join(__dirname, '../js/ext'),
    cssOut: path.join(__dirname, '../css/ext'),
  },
};

function runNpm(cmd, cb) {
  exec(cmd, { cwd: paths.react.src, maxBuffer: 1024 * 1024 * 64 }, function (err, stdout, stderr) {
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);
    if (err) {
      console.error('Command failed:', cmd, err);
    }
    cb(err);
  });
}

gulp.task('react-install', function (cb) {
  console.log('Installing React dependencies...');
  runNpm('npm install', cb);
});

gulp.task('react-build', function (cb) {
  console.log('Building React bundles (chat + admin)...');
  runNpm('npm run build', cb);
});

gulp.task('react-watch', function (cb) {
  console.log('Watching chat bundle (Ctrl-C to stop)...');
  runNpm('npm run watch', cb);
});

gulp.task('clean', function (cb) {
  const targets = [
    path.join(paths.react.jsOut, 'agentic-chat.umd.js'),
    path.join(paths.react.jsOut, 'agentic-admin.umd.js'),
    path.join(paths.react.cssOut, 'agentic-chat.css'),
    path.join(paths.react.cssOut, 'agentic-admin.css'),
  ];
  targets.forEach(function (file) {
    if (fs.existsSync(file)) {
      fs.unlinkSync(file);
      console.log('Removed', file);
    }
  });
  cb();
});

// Placeholder tasks to keep parity with the LLM plugin's CLI surface.
gulp.task('css', function (cb) { console.log('No legacy CSS to build.'); cb(); });
gulp.task('js', function (cb) { console.log('No legacy JS to build.'); cb(); });
gulp.task('watch', gulp.series('react-watch'));

gulp.task('build', gulp.series('react-build'));
gulp.task('default', gulp.series('build'));

gulp.task('help', function (cb) {
  console.log([
    'sh-shp-llm_agentic_chat gulp tasks',
    '----------------------------------',
    '  gulp react-install   install React dependencies',
    '  gulp react-build     build chat + admin bundles',
    '  gulp react-watch     vite watch mode (chat bundle)',
    '  gulp clean           remove built js/css artefacts',
    '  gulp                 alias for react-build',
    '',
    'Outputs:',
    '  js/ext/agentic-chat.umd.js,  css/ext/agentic-chat.css',
    '  js/ext/agentic-admin.umd.js, css/ext/agentic-admin.css',
  ].join('\n'));
  cb();
});
