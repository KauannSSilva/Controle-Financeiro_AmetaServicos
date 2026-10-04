/** Sobe a API: npm run api (na raiz do projeto). */
import { lerConfig } from './config.js';
import { criarPrisma } from './db.js';
import { criarApp } from './http/app.js';
import { PREFIXO } from './http/comum.js';

const config = lerConfig();
const prisma = criarPrisma();
const app = await criarApp({ prisma, config, logger: true });

const fechar = async () => {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
};
process.on('SIGINT', fechar);
process.on('SIGTERM', fechar);

// Só aceita conexões do próprio computador; na AWS (Fase 5) o contêiner escuta atrás do balanceador
await app.listen({ host: config.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1', port: config.API_PORTA });
if (config.NODE_ENV !== 'production') {
  console.log(`\nAPI no ar. Abra no navegador: http://localhost:${config.API_PORTA}${PREFIXO}/docs\n`);
}
