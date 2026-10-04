import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { urlBancoTeste } from './ambiente.js';

/** Cria o banco de teste (se ainda não existir) e aplica as migrações pendentes. */
export default function prepararBanco() {
  const url = urlBancoTeste();
  if (!new URL(url).pathname.endsWith('_teste')) {
    throw new Error('Por segurança, o nome do banco de teste precisa terminar em _teste.');
  }
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    cwd: path.resolve(import.meta.dirname, '..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
    shell: process.platform === 'win32', // no Windows o npx é npx.cmd
  });
}
