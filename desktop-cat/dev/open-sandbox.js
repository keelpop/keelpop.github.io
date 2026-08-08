/*
 * dev/open-sandbox.js — open the browser sandbox.
 *
 * The sandbox uses plain classic scripts, so file:// works and no server is
 * needed. Run with `npm run sandbox`.
 */
'use strict';

const { spawn } = require('child_process');
const path = require('path');

const target = path.resolve(__dirname, 'sandbox.html');
const opener = process.platform === 'darwin' ? 'open'
  : process.platform === 'win32' ? 'explorer'
    : 'xdg-open';

console.log(`opening ${target}`);
const child = spawn(opener, [target], { detached: true, stdio: 'ignore' });
child.on('error', (err) => {
  console.error(`could not launch ${opener}: ${err.message}`);
  console.error(`open this file in a browser instead:\n  ${target}`);
});
child.unref();
