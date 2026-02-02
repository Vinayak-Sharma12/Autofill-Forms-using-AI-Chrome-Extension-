/**
 * Writes minimal valid PNG icons so the extension loads.
 * Run: node make-icons.js
 * Replace icons with proper 16x16, 48x48, 128x128 PNGs for production.
 */
const fs = require('fs');
const path = require('path');

const dir = path.join(__dirname, 'icons');
if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

// Minimal 1x1 grey PNG (Chrome will scale)
const minimalPng = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

fs.writeFileSync(path.join(dir, 'icon16.png'), minimalPng);
fs.writeFileSync(path.join(dir, 'icon48.png'), minimalPng);
fs.writeFileSync(path.join(dir, 'icon128.png'), minimalPng);
console.log('Icons written to icons/');
