// Bundles src/ into one self-contained HTML file.
//   node build.mjs          -> dist/ascii-solar-system.html (open directly, no server needed)
// Requires Deno for bundling (deno bundle); everything else is plain Node.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

mkdirSync('dist', { recursive: true });
execFileSync('deno', ['bundle', '--quiet', '--platform', 'browser', 'src/main.js', '-o', 'dist/bundle.js'], { stdio: 'inherit' });
const js = readFileSync('dist/bundle.js', 'utf8').replace(/<\/script/gi, '<\\/script');
const shell = readFileSync('shell.html', 'utf8');
const page = `${shell}\n<script type="module">\n${js}\n</script>\n`;
writeFileSync('dist/artifact.html', page);
writeFileSync('dist/ascii-solar-system.html', `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n</head>\n<body>\n${page}</body>\n</html>\n`);
console.log(`dist/ascii-solar-system.html  ${(page.length / 1024).toFixed(0)} KB`);
