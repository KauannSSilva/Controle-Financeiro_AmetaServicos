import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Os testes usam um banco separado (DATABASE_URL_TESTE, ou o banco do .env com sufixo _teste),
 * que é esvaziado antes de cada teste. Nunca aponte DATABASE_URL_TESTE para o banco real.
 */
export function urlBancoTeste(): string {
  const env = path.resolve(import.meta.dirname, '../../.env');
  if (existsSync(env)) process.loadEnvFile(env);
  if (process.env.DATABASE_URL_TESTE) return process.env.DATABASE_URL_TESTE;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Defina DATABASE_URL (ou DATABASE_URL_TESTE) no .env para rodar os testes.');
  const url = new URL(base);
  url.pathname = `${url.pathname.replace(/^\//, '')}_teste`;
  return url.toString();
}

process.env.DATABASE_URL = urlBancoTeste();

// Chaves só para os testes, quando o .env ainda não tem as da API
for (const nome of ['JWT_SEGREDO', 'CHAVE_CRIPTOGRAFIA', 'CHAVE_HMAC']) {
  process.env[nome] ||= randomBytes(32).toString('base64');
}
