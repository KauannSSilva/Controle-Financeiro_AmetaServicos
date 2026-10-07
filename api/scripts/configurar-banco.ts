/**
 * Depois das migrações: dá login e senha ao papel da API (ameta_app), usando o usuário e a senha
 * de DATABASE_URL_APP. Roda junto com npm run db:migrate. A senha nunca fica no Git, só no .env.
 */
import { PrismaClient } from '@prisma/client';
import { trocarHost } from '../src/db.js';

const urlApp = process.env.DATABASE_URL_APP;
if (!urlApp) {
  console.warn('DATABASE_URL_APP não está no .env: rode npm run api:chaves e depois npm run db:migrate de novo.');
  process.exit(0);
}
const { username, password } = new URL(urlApp);
const usuario = decodeURIComponent(username);
const senha = decodeURIComponent(password);
if (!/^[a-z_][a-z0-9_]{0,62}$/.test(usuario) || !senha) {
  console.error('DATABASE_URL_APP precisa de usuário (letras minúsculas, números e _) e senha.');
  process.exit(1);
}

const prisma = new PrismaClient({ datasources: { db: { url: trocarHost(process.env.DATABASE_URL) } } });
try {
  // format(%I, %L) monta o comando com nome e senha escapados pelo próprio PostgreSQL
  const comandos = await prisma.$queryRaw<{ sql: string }[]>`
    SELECT CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${usuario})
      THEN format('ALTER ROLE %I LOGIN PASSWORD %L', ${usuario}::text, ${senha}::text)
      ELSE format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS PASSWORD %L', ${usuario}::text, ${senha}::text)
    END AS sql
    UNION ALL
    SELECT format('GRANT ameta_app TO %I', ${usuario}::text) WHERE ${usuario} <> 'ameta_app'`;
  for (const { sql } of comandos) await prisma.$executeRawUnsafe(sql);
  // No banco gerenciado da AWS o dono não é superusuário e não pode repetir NOSUPERUSER/NOBYPASSRLS no ALTER;
  // então confere aqui que o papel da API não tem nenhum desses poderes.
  const [papel] = await prisma.$queryRaw<{ poderoso: boolean }[]>`
    SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb AS poderoso FROM pg_roles WHERE rolname = ${usuario}`;
  if (!papel || papel.poderoso) {
    console.error(`O papel ${usuario} tem privilégios demais (superusuário, BYPASSRLS, CREATEROLE ou CREATEDB). Corrija no banco antes de subir a API.`);
    process.exit(1);
  }
  console.log(`Papel da API pronto: ${usuario} (sem privilégio de dono; o RLS vale para ele).`);
} finally {
  await prisma.$disconnect();
}
