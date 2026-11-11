// Copia as migrations (arquivos SQL) para dist/ depois da compilação: o tsc só emite os
// arquivos TypeScript, e o servidor compilado procura as migrations ao lado de
// dist/persistence/db.js (ver src/persistence/db.ts).
import { cpSync, rmSync } from 'node:fs';
import path from 'node:path';

const serverRoot = path.join(import.meta.dirname, '..');
const source = path.join(serverRoot, 'src', 'persistence', 'migrations');
const target = path.join(serverRoot, 'dist', 'persistence', 'migrations');

rmSync(target, { recursive: true, force: true });
cpSync(source, target, { recursive: true });
