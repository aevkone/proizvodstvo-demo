// Сборка статической демо-версии для GitHub Pages: node demo/build.mjs → dist/
import { build } from 'esbuild';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'dist');
const shim = (f) => join(root, 'demo', 'shims', f);

// node-модули и серверные пакеты → браузерные заглушки
const MAP = {
  'node:sqlite': shim('sqlite.js'),
  express: shim('express.js'),
  'cookie-parser': shim('misc.js'),
  nodemailer: shim('misc.js'),
};
const NODE = /^(node:)?(crypto|fs|path|url|os)$/;

const shimPlugin = {
  name: 'demo-shims',
  setup(b) {
    b.onResolve({ filter: /.*/ }, (args) => {
      if (MAP[args.path]) return { path: MAP[args.path] };
      if (NODE.test(args.path)) return { path: shim('node.js') };
      return undefined;
    });
  },
};

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, 'public'), out, { recursive: true });
cpSync(join(root, 'node_modules', 'sql.js', 'dist', 'sql-wasm.wasm'), join(out, 'sql-wasm.wasm'));

await build({
  entryPoints: [join(root, 'demo', 'backend.js')],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2022',
  minify: true,
  outfile: join(out, 'demo-backend.js'),
  plugins: [shimPlugin],
  banner: { js: 'globalThis.process ??= { env: {}, argv: [] };' },
  logLevel: 'warning',
});

// cookie-parser в app.js импортируется как default и вызывается: cookieParser()
// nodemailer — как default с createTransport. Обе заглушки это поддерживают.

const html = readFileSync(join(out, 'index.html'), 'utf8').replace(
  '<script type="module" src="app.js"></script>',
  `<script type="module">
    import { boot } from './demo-backend.js';
    window.__demo = await boot();
    await import('./app.js');
  </script>`,
);
if (!html.includes('demo-backend.js')) throw new Error('index.html: не найден тег app.js');
writeFileSync(join(out, 'index.html'), html);
writeFileSync(join(out, '.nojekyll'), '');
console.log('Демо собрано в', out);
