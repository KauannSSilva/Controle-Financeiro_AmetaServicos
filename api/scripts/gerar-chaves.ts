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
// Conexão da API com o papel de menor privilégio (ameta_app), no mesmo servidor e banco do DATABASE_URL
if (!/^DATABASE_URL_APP=.+/m.test(readFileSync(arquivo, 'utf8'))) {
  const base = readFileSync(arquivo, 'utf8').match(/^DATABASE_URL=["']?([^"'\n]+)/m)?.[1];
  if (!base) {
    console.error('DATABASE_URL não encontrada no .env: não deu para criar DATABASE_URL_APP.');
  } else {
    const url = new URL(base);
    url.username = 'ameta_app';
    url.password = randomBytes(24).toString('base64url');
    appendFileSync(arquivo, `\n# Conexão da API com o papel de menor privilégio (gerada por npm run api:chaves). Rode npm run db:migrate depois.\nDATABASE_URL_APP="${url.toString()}"\n`);
    console.log('DATABASE_URL_APP adicionada ao .env. Agora rode npm run db:migrate.');
  }
}
console.log('Atenção: depois de criar usuários, não troque CHAVE_CRIPTOGRAFIA nem CHAVE_HMAC, senão os dados cifrados ficam ilegíveis.');
