/**
 * Gera as chaves da API e grava no .env (só as que ainda não existem).
 * Uso: npm run api:chaves
 */
import { randomBytes } from 'node:crypto';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

const arquivo = path.resolve(import.meta.dirname, '../../.env');
if (!existsSync(arquivo)) {
  console.error('Arquivo .env não encontrado. Copie .env.example para .env primeiro.');
  process.exit(1);
}
const atual = readFileSync(arquivo, 'utf8');
const nomes = ['JWT_SEGREDO', 'CHAVE_CRIPTOGRAFIA', 'CHAVE_HMAC'];
const faltando = nomes.filter((n) => !new RegExp(`^${n}=.+`, 'm').test(atual));
if (faltando.length === 0) {
  console.log('As chaves já existem no .env. Nada foi alterado.');
} else {
  const linhas = faltando.map((n) => `${n}=${randomBytes(32).toString('base64')}`);
  appendFileSync(arquivo, `${atual.endsWith('\n') ? '' : '\n'}\n# Chaves da API (geradas por npm run api:chaves). Não compartilhe.\n${linhas.join('\n')}\n`);
  console.log(`Chaves adicionadas ao .env: ${faltando.join(', ')}`);
}
console.log('Atenção: depois de criar usuários, não troque CHAVE_CRIPTOGRAFIA nem CHAVE_HMAC, senão os dados cifrados ficam ilegíveis.');
