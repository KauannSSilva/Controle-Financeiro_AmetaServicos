/**
 * Cria o primeiro ADMIN. Os demais usuários são criados pelo ADMIN na API.
 * Uso: npm run seed:admin -- --email voce@ameta.com.br
 * O nome e a senha são pedidos no terminal (a senha não aparece na tela).
 * Para trocar a senha de um ADMIN que já existe: acrescente --redefinir-senha.
 */
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
import { parseArgs } from 'node:util';
import { lerConfig } from '../src/config.js';
import { criarPrisma } from '../src/db.js';
import { ErroRegra } from '../src/erros.js';
import { Cripto } from '../src/seguranca/cripto.js';
import { hashSenha, validarPoliticaSenha } from '../src/seguranca/senha.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';

const { values } = parseArgs({
  options: { email: { type: 'string' }, nome: { type: 'string' }, 'redefinir-senha': { type: 'boolean' } },
});
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

/**
 * Lê a senha sem mostrar na tela. Usa o readline do Node (o mesmo da pergunta do nome), que trata
 * acentos e o Enter do Windows; só a escrita na tela é desligada. Sem terminal, lê a variável SENHA_ADMIN.
 */
async function perguntarSenha(pergunta: string): Promise<string> {
  if (process.env.SENHA_ADMIN) return process.env.SENHA_ADMIN;
  if (!process.stdin.isTTY) throw new Error('Rode este comando num terminal para digitar a senha.');
  let mudo = false;
  // Saída intermediária: repassa para a tela só enquanto não está mudo
  const saida = new Writable({
    write(pedaco, _cod, pronto) {
      if (!mudo) process.stdout.write(pedaco);
      pronto();
    },
  });
  Object.assign(saida, { columns: process.stdout.columns, isTTY: true });
  const rl = createInterface({ input: process.stdin, output: saida, terminal: true });
  try {
    const resposta = rl.question(pergunta);
    mudo = true; // a pergunta já foi escrita; daqui em diante nada do que for digitado aparece
    return await resposta;
  } finally {
    mudo = false;
    process.stdout.write('\n');
    rl.close();
  }
}

const config = lerConfig();
const prisma = criarPrisma();
const cripto = new Cripto(config.CHAVE_CRIPTOGRAFIA, config.CHAVE_HMAC);

async function lerSenhaNova() {
  console.log('A senha precisa ter pelo menos 12 caracteres. Dica: use uma frase sem acentos, ex.: "notas da ameta em dia 2026".');
  console.log('Enquanto você digita, nada aparece na tela. Digite e aperte Enter.');
  const senha = await perguntarSenha('Senha: ');
  const confirmacao = await perguntarSenha('Repita a senha: ');
  if (senha !== confirmacao) throw new ErroRegra('As senhas não são iguais');
  console.log(`Senha recebida com ${[...senha].length} caracteres.`);
  return senha;
}

try {
  if (values['redefinir-senha']) {
    // Esqueceu a senha do ADMIN (ou ela não entrou): troca direto no banco e tira o bloqueio
    const u = await prisma.usuario.findUnique({ where: { emailHash: cripto.hashEmail(values.email) } });
    if (!u || u.excluidoEm || u.perfil !== 'ADMIN') throw new ErroRegra('Não existe ADMIN com este e-mail');
    const senha = await lerSenhaNova();
    validarPoliticaSenha(senha, { email: values.email });
    await prisma.$transaction([
      prisma.usuario.update({
        where: { id: u.id },
        data: { senhaHash: await hashSenha(senha), deveTrocarSenha: false, tentativasFalhas: 0, bloqueadoAte: null, ativo: true },
      }),
      prisma.sessao.updateMany({ where: { usuarioId: u.id, revogadoEm: null }, data: { revogadoEm: new Date() } }),
      prisma.logAuditoria.create({ data: { usuarioId: u.id, acao: 'SENHA_REDEFINIDA_CLI', entidade: 'usuarios', entidadeId: u.id } }),
    ]);
    console.log(`Senha do ADMIN ${values.email} redefinida. Se a API estiver aberta, feche (Ctrl+C) e rode npm run api de novo.`);
  } else {
    const admins = await prisma.usuario.count({ where: { perfil: 'ADMIN', ativo: true, excluidoEm: null } });
    if (admins > 0) {
      throw new ErroRegra('Já existe um ADMIN ativo. Para trocar a senha dele, rode de novo com --redefinir-senha no final.');
    }
    const nome = values.nome?.trim() || (await perguntar('Seu nome: '));
    if (nome.length < 2) throw new ErroRegra('Informe o nome');
    const senha = await lerSenhaNova();
    await criarUsuario(prisma, cripto, { nome, email: values.email, perfil: 'ADMIN', senha }, {}, { deveTrocarSenha: false });
    console.log(`ADMIN ${values.email} criado. No primeiro login a API pede para cadastrar o autenticador (MFA).`);
  }
} catch (e) {
  if (e instanceof ErroRegra) {
    console.error(`Não foi possível: ${e.message}`);
    process.exitCode = 1;
  } else {
    throw e;
  }
} finally {
  await prisma.$disconnect();
}
