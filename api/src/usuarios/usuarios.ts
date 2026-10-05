/**
 * Cadastro de usuários (só o ADMIN chega aqui; a API confere o perfil antes).
 * Nome e e-mail ficam cifrados; o e-mail também vira um HMAC para busca e unicidade.
 */
import { PerfilUsuario, Prisma, PrismaClient, Usuario } from '@prisma/client';
import { TEMPOS } from '../config.js';
import { emailConvite, EnviarEmail } from '../email/email.js';
import { ErroNaoEncontrado, ErroRegra } from '../erros.js';
import { Contexto } from '../ordens/ordens.js';
import { Cripto, normalizarEmail, sha256, tokenAleatorio } from '../seguranca/cripto.js';
import { hashSenha, validarPoliticaSenha } from '../seguranca/senha.js';

export interface UsuarioPublico {
  id: string;
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  ativo: boolean;
  mfaAtivo: boolean;
  bloqueadoAte: Date | null;
  deveTrocarSenha: boolean;
  /** false = ainda não aceitou o convite enviado por e-mail (não consegue entrar) */
  conviteAceito: boolean;
  conviteExpiraEm: Date | null;
  criadoEm: Date;
}

/** O que pode sair da API sobre um usuário. Senha, segredo MFA e hashes nunca saem. */
export function usuarioPublico(u: Usuario, cripto: Cripto): UsuarioPublico {
  return {
    id: u.id,
    nome: cripto.decifrar(u.nomeCifrado),
    email: cripto.decifrar(u.emailCifrado),
    perfil: u.perfil,
    ativo: u.ativo,
    mfaAtivo: u.mfaAtivo,
    bloqueadoAte: u.bloqueadoAte && u.bloqueadoAte > new Date() ? u.bloqueadoAte : null,
    deveTrocarSenha: u.deveTrocarSenha,
    conviteAceito: u.conviteAceitoEm !== null,
    conviteExpiraEm: u.conviteAceitoEm ? null : u.conviteExpiraEm,
    criadoEm: u.criadoEm,
  };
}

async function auditar(tx: Prisma.TransactionClient, ctx: Contexto, acao: string, entidadeId: string, antes?: object, depois?: object) {
  await tx.logAuditoria.create({
    data: {
      usuarioId: ctx.usuarioId ?? null, ip: ctx.ip ?? null, acao, entidade: 'usuarios', entidadeId,
      valoresAntes: antes ?? Prisma.JsonNull, valoresDepois: depois ?? Prisma.JsonNull,
    },
  });
}

async function buscar(tx: Prisma.TransactionClient, id: string) {
  const u = await tx.usuario.findUnique({ where: { id } });
  if (!u || u.excluidoEm) throw new ErroNaoEncontrado('Usuário não encontrado');
  return u;
}

/** Recusa qualquer mudança que deixe o sistema sem nenhum ADMIN ativo. */
async function garantirOutroAdmin(tx: Prisma.TransactionClient, idAlvo: string) {
  const outros = await tx.usuario.count({
    where: { perfil: 'ADMIN', ativo: true, excluidoEm: null, id: { not: idAlvo } },
  });
  if (outros === 0) throw new ErroRegra('É preciso manter pelo menos um ADMIN ativo. Crie ou ative outro ADMIN antes.');
}

async function revogarSessoes(tx: Prisma.TransactionClient, usuarioId: string, excetoSessaoId?: string) {
  await tx.sessao.updateMany({
    where: { usuarioId, revogadoEm: null, id: excetoSessaoId ? { not: excetoSessaoId } : undefined },
    data: { revogadoEm: new Date() },
  });
}

export interface NovoUsuario {
  nome: string;
  email: string;
  perfil: PerfilUsuario;
  senha: string;
}

export async function criarUsuario(
  prisma: PrismaClient, cripto: Cripto, dados: NovoUsuario, ctx: Contexto = {},
  opcoes: { deveTrocarSenha?: boolean; exigirConvite?: boolean } = {},
) {
  const email = normalizarEmail(dados.email);
  validarPoliticaSenha(dados.senha, { email, nome: dados.nome });
  const senhaHash = await hashSenha(dados.senha);
  return prisma.$transaction(async (tx) => {
    const emailHash = cripto.hashEmail(email);
    if (await tx.usuario.findUnique({ where: { emailHash } })) throw new ErroRegra('Já existe um usuário com este e-mail');
    const u = await tx.usuario.create({
      data: {
        nomeCifrado: cripto.cifrar(dados.nome.trim()),
        emailCifrado: cripto.cifrar(email),
        emailHash,
        senhaHash,
        perfil: dados.perfil,
        deveTrocarSenha: opcoes.deveTrocarSenha ?? true,
        // Sem convite (ex.: o primeiro ADMIN, criado no terminal) a conta já nasce aceita
        conviteAceitoEm: opcoes.exigirConvite ? null : new Date(),
      },
    });
    await auditar(tx, ctx, 'USUARIO_CRIADO', u.id, undefined, { perfil: u.perfil });
    return u;
  });
}

export async function listarUsuarios(prisma: PrismaClient) {
  return prisma.usuario.findMany({ where: { excluidoEm: null }, orderBy: { criadoEm: 'asc' } });
}

export async function obterUsuario(prisma: PrismaClient, id: string) {
  return buscar(prisma, id);
}

export interface EdicaoUsuario {
  nome?: string;
  perfil?: PerfilUsuario;
  /** false = bloqueado pelo ADMIN (não entra mais e perde as sessões abertas) */
  ativo?: boolean;
}

export async function editarUsuario(prisma: PrismaClient, cripto: Cripto, id: string, dados: EdicaoUsuario, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    const antes = await buscar(tx, id);
    const perdeAdmin = antes.perfil === 'ADMIN' && antes.ativo && ((dados.perfil && dados.perfil !== 'ADMIN') || dados.ativo === false);
    if (perdeAdmin) await garantirOutroAdmin(tx, id);
    const depois = await tx.usuario.update({
      where: { id },
      data: {
        nomeCifrado: dados.nome ? cripto.cifrar(dados.nome.trim()) : undefined,
        perfil: dados.perfil,
        ativo: dados.ativo,
      },
    });
    if (dados.ativo === false) await revogarSessoes(tx, id);
    // Nome é dado pessoal: a auditoria registra só que mudou
    await auditar(
      tx, ctx, 'USUARIO_EDITADO', id,
      { perfil: antes.perfil, ativo: antes.ativo },
      { perfil: depois.perfil, ativo: depois.ativo, ...(dados.nome ? { nome: '(alterado)' } : {}) },
    );
    return depois;
  });
}

/** Exclusão pelo ADMIN: some das listas e não entra mais; histórico e auditoria continuam apontando para ele. */
export async function excluirUsuario(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  if (id === ctx.usuarioId) throw new ErroRegra('Você não pode excluir o seu próprio usuário');
  return prisma.$transaction(async (tx) => {
    const u = await buscar(tx, id);
    if (u.perfil === 'ADMIN' && u.ativo) await garantirOutroAdmin(tx, id);
    await tx.usuario.update({ where: { id }, data: { excluidoEm: new Date(), ativo: false } });
    await revogarSessoes(tx, id);
    await auditar(tx, ctx, 'USUARIO_EXCLUIDO', id, { perfil: u.perfil, ativo: u.ativo });
  });
}

/** Apaga o MFA: no próximo login o usuário cadastra o autenticador de novo. */
export async function resetarMfa(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    await buscar(tx, id);
    await tx.usuario.update({ where: { id }, data: { mfaSecretCifrado: null, mfaAtivo: false, mfaUltimoPasso: null } });
    await tx.codigoRecuperacaoMfa.deleteMany({ where: { usuarioId: id } });
    await revogarSessoes(tx, id);
    await auditar(tx, ctx, 'MFA_RESETADO', id);
  });
}

/** Tira o bloqueio por tentativas erradas. */
export async function desbloquearUsuario(prisma: PrismaClient, id: string, ctx: Contexto = {}) {
  return prisma.$transaction(async (tx) => {
    await buscar(tx, id);
    await tx.usuario.update({ where: { id }, data: { tentativasFalhas: 0, bloqueadoAte: null } });
    await auditar(tx, ctx, 'USUARIO_DESBLOQUEADO', id);
  });
}

/** O ADMIN define uma senha provisória; o usuário troca no próximo acesso. */
export async function definirSenhaProvisoria(prisma: PrismaClient, cripto: Cripto, id: string, senha: string, ctx: Contexto = {}) {
  const u = await buscar(prisma, id);
  validarPoliticaSenha(senha, { email: cripto.decifrar(u.emailCifrado) });
  const senhaHash = await hashSenha(senha);
  return prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id }, data: { senhaHash, deveTrocarSenha: true, tentativasFalhas: 0, bloqueadoAte: null } });
    await revogarSessoes(tx, id);
    await auditar(tx, ctx, 'SENHA_REDEFINIDA_ADMIN', id);
  });
}

export { revogarSessoes };

// ---------- Convite por e-mail ----------

/**
 * Gera um link novo (o anterior deixa de valer) e manda o convite com o nome, o e-mail e a senha provisória.
 * Devolve false se o e-mail não saiu; o usuário continua criado e o ADMIN pode reenviar.
 */
export async function enviarConvite(
  prisma: PrismaClient, cripto: Cripto, enviar: EnviarEmail, urlSite: string,
  id: string, senhaProvisoria: string, ctx: Contexto = {},
): Promise<boolean> {
  const u = await buscar(prisma, id);
  if (u.conviteAceitoEm) throw new ErroRegra('Este usuário já aceitou o convite');
  const token = tokenAleatorio(32);
  const expiraEm = new Date(Date.now() + TEMPOS.conviteMs);
  await prisma.usuario.update({ where: { id }, data: { conviteTokenHash: sha256(token), conviteExpiraEm: expiraEm } });
  const nome = cripto.decifrar(u.nomeCifrado);
  const email = cripto.decifrar(u.emailCifrado);
  // O token vai depois do # para não aparecer em logs de servidor nem no Referer
  const link = `${urlSite.replace(/\/+$/, '')}/convite#${token}`;
  let enviado = true;
  try {
    await enviar({ para: email, ...emailConvite({ nome, email, senhaProvisoria, link, expiraEm }) });
  } catch {
    enviado = false;
  }
  await prisma.$transaction((tx) => auditar(tx, ctx, enviado ? 'CONVITE_ENVIADO' : 'CONVITE_NAO_ENVIADO', id, undefined, { expiraEm }));
  return enviado;
}

/** Reenvio pelo ADMIN: nova senha provisória e novo link (o convite anterior para de valer). */
export async function reenviarConvite(
  prisma: PrismaClient, cripto: Cripto, enviar: EnviarEmail, urlSite: string,
  id: string, senhaProvisoria: string, ctx: Contexto = {},
) {
  const u = await buscar(prisma, id);
  if (u.conviteAceitoEm) throw new ErroRegra('Este usuário já aceitou o convite');
  await definirSenhaProvisoria(prisma, cripto, id, senhaProvisoria, ctx);
  return enviarConvite(prisma, cripto, enviar, urlSite, id, senhaProvisoria, ctx);
}

/** A pessoa clicou no link do e-mail: confirma que o e-mail é dela e libera o login. Devolve o e-mail. */
export async function aceitarConvite(prisma: PrismaClient, cripto: Cripto, token: string, ip?: string | null) {
  const u = await prisma.usuario.findUnique({ where: { conviteTokenHash: sha256(token) } });
  if (!u || u.excluidoEm || u.conviteAceitoEm || !u.conviteExpiraEm || u.conviteExpiraEm < new Date()) {
    throw new ErroRegra('Convite expirado ou já usado. Peça ao administrador para reenviar.');
  }
  await prisma.$transaction(async (tx) => {
    await tx.usuario.update({ where: { id: u.id }, data: { conviteAceitoEm: new Date(), conviteTokenHash: null, conviteExpiraEm: null } });
    await auditar(tx, { usuarioId: u.id, ip }, 'CONVITE_ACEITO', u.id);
  });
  return cripto.decifrar(u.emailCifrado);
}
