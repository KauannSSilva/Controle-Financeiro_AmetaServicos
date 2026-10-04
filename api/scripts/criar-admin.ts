/**
 * Cria o primeiro ADMIN. Os demais usuários são criados pelo ADMIN na API.
 * Uso: npm run seed:admin -- --email voce@ameta.com.br
 * O nome e a senha são pedidos no terminal (a senha não aparece na tela).
 */
import { createInterface } from 'node:readline/promises';
import { parseArgs } from 'node:util';
import { lerConfig } from '../src/config.js';
import { criarPrisma } from '../src/db.js';
import { ErroRegra } from '../src/erros.js';
import { Cripto } from '../src/seguranca/cripto.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';

const { values } = parseArgs({ options: { email: { type: 'string' }, nome: { type: 'string' } } });
if (!values.email) {
  console.error('Uso: npm run seed:admin -- --email voce@ameta.com.br');
  process.exit(1);
}

/** Pergunta um texto visível (o nome). */
async function perguntar(pergunta: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question(pergunta)).trim();
  } finally {
    rl.close();
  }
}

/** Lê a senha sem mostrar na tela. Sem terminal (ex.: testes), lê a variável SENHA_ADMIN. */
function perguntarSenha(pergunta: string): Promise<string> {
  if (process.env.SENHA_ADMIN) return Promise.resolve(process.env.SENHA_ADMIN);
  if (!process.stdin.isTTY) throw new Error('Rode este comando num terminal para digitar a senha.');
  return new Promise((resolve) => {
    process.stdout.write(pergunta);
    const entrada = process.stdin;
    entrada.setRawMode(true);
    entrada.resume();
    entrada.setEncoding('utf8');
    let senha = '';
    const aoDigitar = (tecla: string) => {
      for (const c of tecla) {
        if (c === '\r' || c === '\n') {
          entrada.setRawMode(false);
          entrada.pause();
          entrada.off('data', aoDigitar);
          process.stdout.write('\n');
          resolve(senha);
          return;
        }
        if (c === '\u0003') process.exit(130); // Ctrl+C
        if (c === '\u007f' || c === '\b') {
          if (senha.length) { senha = senha.slice(0, -1); process.stdout.write('\b \b'); }
        } else {
          senha += c;
          process.stdout.write('*');
        }
      }
    };
    entrada.on('data', aoDigitar);
  });
}

const config = lerConfig();
const prisma = criarPrisma();
try {
  const admins = await prisma.usuario.count({ where: { perfil: 'ADMIN', ativo: true, excluidoEm: null } });
  if (admins > 0) {
    console.error('Já existe um ADMIN ativo. Os outros usuários são criados por ele, na API.');
    process.exitCode = 1;
  } else {
    const nome = values.nome?.trim() || (await perguntar('Seu nome: '));
    if (nome.length < 2) throw new ErroRegra('Informe o nome');
    console.log('A senha precisa ter pelo menos 12 caracteres. Dica: use uma frase, ex.: "notas da ameta em dia 2026".');
    const senha = await perguntarSenha('Senha do ADMIN: ');
    const confirmacao = await perguntarSenha('Repita a senha: ');
    if (senha !== confirmacao) throw new ErroRegra('As senhas não são iguais');
    const cripto = new Cripto(config.CHAVE_CRIPTOGRAFIA, config.CHAVE_HMAC);
    await criarUsuario(prisma, cripto, { nome, email: values.email, perfil: 'ADMIN', senha }, {}, { deveTrocarSenha: false });
    console.log(`ADMIN ${values.email} criado. No primeiro login a API pede para cadastrar o autenticador (MFA).`);
  }
} catch (e) {
  if (e instanceof ErroRegra) {
    console.error(`Não foi possível criar: ${e.message}`);
    process.exitCode = 1;
  } else {
    throw e;
  }
} finally {
  await prisma.$disconnect();
}
