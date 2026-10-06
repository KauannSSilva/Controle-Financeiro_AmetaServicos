import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { urlAppTeste, urlBancoTeste } from './ambiente.js';

/** Cria o banco de teste (se ainda não existir) e aplica as migrações pendentes. */
export default async function prepararBanco() {
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
  // Login de teste com as permissões do papel da API (ameta_app)
  const senha = decodeURIComponent(new URL(urlAppTeste()).password);
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const [{ existe }] = await prisma.$queryRaw<{ existe: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ameta_app_teste') AS existe`;
    const [{ sql }] = await prisma.$queryRaw<{ sql: string }[]>`
      SELECT format(${existe ? 'ALTER' : 'CREATE'} || ' ROLE ameta_app_teste LOGIN NOSUPERUSER NOBYPASSRLS PASSWORD %L', ${senha}::text) AS sql`;
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe('GRANT ameta_app TO ameta_app_teste');
  } finally {
    await prisma.$disconnect();
  }
}
