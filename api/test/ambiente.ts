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
