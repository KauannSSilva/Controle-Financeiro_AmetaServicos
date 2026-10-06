import { createHash, randomBytes } from 'node:crypto';
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
  const nome = url.pathname.replace(/^\//, '');
  url.pathname = nome.endsWith('_teste') ? nome : `${nome}_teste`;
  return url.toString();
}

/**
 * A API dos testes conecta como ameta_app_teste (membro de ameta_app, sem ser dono), para o RLS valer
 * como em produção. A senha é derivada da senha do dono do banco, que os testes já conhecem.
 */
export function urlAppTeste(): string {
  const url = new URL(urlBancoTeste());
  url.password = createHash('sha256').update(`ameta-app-teste:${decodeURIComponent(url.password)}`).digest('hex');
  url.username = 'ameta_app_teste';
  return url.toString();
}

process.env.DATABASE_URL = urlBancoTeste();

// Chaves só para os testes, quando o .env ainda não tem as da API
for (const nome of ['JWT_SEGREDO', 'CHAVE_CRIPTOGRAFIA', 'CHAVE_HMAC']) {
  process.env[nome] ||= randomBytes(32).toString('base64');
}
