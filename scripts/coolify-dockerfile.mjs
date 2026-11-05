// Genera un Dockerfile autosuficiente (con las fuentes adentro) para Coolify,
// que construye la app sin depender de un repositorio.
// Uso: node scripts/coolify-dockerfile.mjs salida/Dockerfile
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const out = process.argv[2];
if (!out) throw new Error('falta la ruta de salida');

const bundle = execFileSync('tar', ['-czf', '-', 'go.mod', 'go.sum', 'main.go', 'index.html'], { maxBuffer: 1 << 26 }).toString('base64');
const base = readFileSync('Dockerfile', 'utf8');
const dockerfile = base.replace(
  /COPY go\.mod go\.sum \.\/\nRUN go mod download\nCOPY main\.go index\.html \.\/\n/,
  `RUN echo '${bundle}' | base64 -d | tar xz && go mod download\n`
);
if (dockerfile === base) throw new Error('no se encontró el bloque COPY en el Dockerfile');

// Coolify lo guarda en base64 y lo escribe con un solo comando de shell (límite de Linux: 128 KB por argumento)
const encoded = Buffer.from(dockerfile).length * 4 / 3;
if (encoded > 120000) throw new Error(`Dockerfile demasiado grande: ${Math.round(encoded / 1024)} KB en base64`);

writeFileSync(out, dockerfile);
console.log(`${out}: ${Math.round(dockerfile.length / 1024)} KB, ${Math.round(encoded / 1024)} KB en base64`);
