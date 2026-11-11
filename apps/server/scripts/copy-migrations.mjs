// Copia as migrations (arquivos SQL) para dist/ depois da compilação: o tsc só emite os
// arquivos TypeScript, e o servidor compilado procura as migrations ao lado de
// dist/persistence/db.js (ver src/persistence/db.ts).
//
// Usa a cópia assíncrona de propósito: no Node 24 para Windows, `fs.cpSync` falha com
// "Access is denied" quando o caminho do projeto tem acento (ex.: C:\Users\Usuário\...).
import { cp, rm } from 'node:fs/promises';
import path from 'node:path';

const serverRoot = path.join(import.meta.dirname, '..');
const source = path.join(serverRoot, 'src', 'persistence', 'migrations');
const target = path.join(serverRoot, 'dist', 'persistence', 'migrations');

await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true });
