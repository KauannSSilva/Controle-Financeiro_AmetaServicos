/** Regrava docs/inventario-rotas.md com as rotas que a API expõe. Uso: npm run api:rotas */
import { randomBytes } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { PrismaClient } from '@prisma/client';
import { lerConfig } from '../src/config.js';
import { criarApp } from '../src/http/app.js';
import { inventarioMarkdown } from '../src/http/inventario.js';

// Só monta as rotas: não conecta no banco e não precisa das chaves reais
const chave = randomBytes(32).toString('base64');
const config = lerConfig({ ...process.env, NODE_ENV: 'test', JWT_SEGREDO: chave, CHAVE_CRIPTOGRAFIA: chave, CHAVE_HMAC: chave });
const app = await criarApp({ prisma: new PrismaClient({ datasources: { db: { url: 'postgresql://x@localhost/x' } } }), config });
await app.ready();
const arquivo = path.resolve(import.meta.dirname, '../../docs/inventario-rotas.md');
writeFileSync(arquivo, inventarioMarkdown(app.inventarioRotas));
console.log(`${app.inventarioRotas.length} rotas gravadas em docs/inventario-rotas.md`);
await app.close();
