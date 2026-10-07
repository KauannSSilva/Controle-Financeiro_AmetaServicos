/** Sobe a API: npm run api (na raiz do projeto). */
import { lerConfig } from './config.js';
import { criarPrisma, trocarHost } from './db.js';
import { criarApp } from './http/app.js';
import { PREFIXO } from './http/comum.js';

const config = lerConfig();
// A API usa o papel de menor privilégio; o dono do banco fica só para migrações e scripts
if (!config.DATABASE_URL_APP) {
  if (config.NODE_ENV === 'production') throw new Error('Defina DATABASE_URL_APP (papel ameta_app) para subir a API em produção.');
  console.warn('\nAVISO: DATABASE_URL_APP não está no .env. Rode npm run api:chaves e depois npm run db:migrate.\n'
    + 'Por enquanto a API usa o dono do banco, e as regras de acesso do banco (RLS) não valem para ela.\n');
}
const prisma = criarPrisma(trocarHost(config.DATABASE_URL_APP ?? process.env.DATABASE_URL));
const app = await criarApp({ prisma, config, logger: true });

const fechar = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', fechar);
process.on('SIGTERM', fechar);

// Só aceita conexões do próprio computador; na AWS o contêiner escuta atrás do balanceador
await app.listen({ host: config.API_HOST ?? (config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'), port: config.API_PORTA });
if (config.NODE_ENV !== 'production') {
  console.log(`\nAPI no ar. Abra no navegador: http://localhost:${config.API_PORTA}${PREFIXO}/docs\n`);
}
