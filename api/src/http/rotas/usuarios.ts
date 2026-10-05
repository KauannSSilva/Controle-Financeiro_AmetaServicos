import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  criarUsuario, definirSenhaProvisoria, desbloquearUsuario, editarUsuario, enviarConvite, excluirUsuario, listarUsuarios,
  obterUsuario, reenviarConvite, resetarMfa, usuarioPublico,
} from '../../usuarios/usuarios.js';
import { ContextoRotas, contexto, SO_ADMIN } from '../comum.js';

const tags = ['Usuários (só ADMIN)'];
const id = z.object({ id: z.uuid('ID inválido') });
const perfil = z.enum(['ADMIN', 'OPERADOR', 'VISUALIZADOR']);
const nome = z.string().trim().min(2, 'Informe o nome').max(120);
const config = { acesso: SO_ADMIN };

export async function rotasUsuarios(app: FastifyInstance, { prisma, cripto, config: cfg, enviarEmail }: ContextoRotas) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  const urlSite = cfg.URL_SITE ?? cfg.ORIGEM_FRONT;

  r.get('/', { config, schema: { tags, summary: 'Listar usuários' } }, async () =>
    (await listarUsuarios(prisma)).map((u) => usuarioPublico(u, cripto)));

  r.get('/:id', { config, schema: { tags, summary: 'Ver um usuário', params: id } }, async (req) =>
    usuarioPublico(await obterUsuario(prisma, req.params.id), cripto));

  r.post('/', {
    config,
    schema: {
      tags, summary: 'Criar usuário',
      description: 'Envia um convite por e-mail com o nome, o e-mail e a senha provisória. O usuário só entra depois de aceitar '
        + 'o convite; no primeiro acesso troca a senha e cadastra o autenticador. Se o e-mail não sair, conviteEnviado = false.',
      body: z.object({ nome, email: z.email('E-mail inválido').max(254), perfil, senhaProvisoria: z.string().max(128) }),
    },
  }, async (req, reply) => {
    const { senhaProvisoria, ...dados } = req.body;
    const u = await criarUsuario(prisma, cripto, { ...dados, senha: senhaProvisoria }, contexto(req), { exigirConvite: true });
    const conviteEnviado = await enviarConvite(prisma, cripto, enviarEmail, urlSite, u.id, senhaProvisoria, contexto(req));
    if (!conviteEnviado) req.log.warn({ usuario: u.id }, 'convite não enviado');
    const atual = await obterUsuario(prisma, u.id);
    return reply.code(201).send({ ...usuarioPublico(atual, cripto), conviteEnviado });
  });

  r.patch('/:id', {
    config,
    schema: {
      tags, summary: 'Editar nome, perfil ou bloquear (ativo = false)',
      params: id,
      body: z.object({ nome: nome.optional(), perfil: perfil.optional(), ativo: z.boolean().optional() }).strict(),
    },
  }, async (req) => usuarioPublico(await editarUsuario(prisma, cripto, req.params.id, req.body, contexto(req)), cripto));

  r.delete('/:id', { config, schema: { tags, summary: 'Excluir usuário (o histórico continua)', params: id } }, async (req) => {
    await excluirUsuario(prisma, req.params.id, contexto(req));
    return { ok: true };
  });

  r.post('/:id/resetar-mfa', {
    config, schema: { tags, summary: 'Resetar o MFA (ex.: trocou de celular)', params: id },
  }, async (req) => {
    await resetarMfa(prisma, req.params.id, contexto(req));
    return { ok: true };
  });

  r.post('/:id/desbloquear', {
    config, schema: { tags, summary: 'Tirar o bloqueio por tentativas erradas', params: id },
  }, async (req) => {
    await desbloquearUsuario(prisma, req.params.id, contexto(req));
    return { ok: true };
  });

  r.post('/:id/senha-provisoria', {
    config,
    schema: {
      tags, summary: 'Definir uma senha provisória (esqueceu a senha)',
      params: id, body: z.object({ senhaProvisoria: z.string().max(128) }),
    },
  }, async (req) => {
    await definirSenhaProvisoria(prisma, cripto, req.params.id, req.body.senhaProvisoria, contexto(req));
    return { ok: true };
  });

  r.post('/:id/reenviar-convite', {
    config,
    schema: {
      tags, summary: 'Reenviar o convite com uma nova senha provisória',
      description: 'Só para quem ainda não aceitou. O link e a senha do convite anterior deixam de valer.',
      params: id, body: z.object({ senhaProvisoria: z.string().max(128) }),
    },
  }, async (req) => {
    const conviteEnviado = await reenviarConvite(prisma, cripto, enviarEmail, urlSite, req.params.id, req.body.senhaProvisoria, contexto(req));
    return { ok: true, conviteEnviado };
  });
}
