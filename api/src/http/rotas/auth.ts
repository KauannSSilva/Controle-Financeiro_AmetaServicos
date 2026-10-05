import { FastifyInstance } from 'fastify';
import { ZodTypeProvider } from 'fastify-type-provider-zod';
import QRCode from 'qrcode';
import { z } from 'zod';
import { tokenAleatorio } from '../../seguranca/cripto.js';
import { aceitarConvite, usuarioPublico } from '../../usuarios/usuarios.js';
import {
  ContextoRotas, COOKIES, gravarCookiesPreMfa, gravarCookiesSessao, limparCookies, origem,
} from '../comum.js';

const tags = ['Login e sessão'];
// Limite extra nas rotas de login e MFA, além do bloqueio por usuário
const limiteLogin = { max: 20, timeWindow: '1 minute' };

export async function rotasAuth(app: FastifyInstance, { auth, cripto, config, prisma }: ContextoRotas) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post('/convite/aceitar', {
    config: { acesso: 'publico', rateLimit: limiteLogin },
    schema: {
      tags, summary: 'Aceitar o convite recebido por e-mail',
      description: 'O token vem do link do e-mail. Depois disso a pessoa entra em auth/login com a senha provisória.',
      body: z.object({ token: z.string().trim().min(20).max(100) }),
    },
  }, async (req) => ({ email: await aceitarConvite(prisma, cripto, req.body.token, req.ip) }));

  r.post('/login', {
    config: { acesso: 'publico', rateLimit: limiteLogin },
    schema: {
      tags, summary: '1º passo: e-mail e senha',
      description: 'Se der certo, o próximo passo é mfa/configurar (primeiro acesso) ou mfa/verificar.',
      body: z.object({ email: z.string().trim().max(254), senha: z.string().max(128) })
        .meta({ example: { email: 'seu-email@ameta.com.br', senha: 'sua senha' } }),
    },
  }, async (req, reply) => {
    const { proximaEtapa, tokenPreMfa } = await auth.login(req.body.email, req.body.senha, origem(req));
    gravarCookiesPreMfa(reply, config, tokenPreMfa, tokenAleatorio());
    return { proximaEtapa };
  });

  r.post('/mfa/configurar', {
    config: { acesso: 'pre-mfa', rateLimit: limiteLogin },
    schema: {
      tags, summary: '2º passo (primeiro acesso): gerar o QR Code do autenticador',
      description: 'Escaneie o QR Code (ou abra mfa/qrcode.png, ou digite a chave) no Google Authenticator ou Microsoft Authenticator.',
    },
  }, async (req) => {
    const u = await auth.validarPreMfa(req.cookies[COOKIES.preMfa]);
    const { chave, uri } = await auth.configurarMfa(u);
    return { chave, uri, qrCode: await QRCode.toDataURL(uri, { width: 280, margin: 2 }) };
  });

  r.get('/mfa/qrcode.png', {
    config: { acesso: 'pre-mfa', rateLimit: limiteLogin },
    schema: { tags, summary: 'QR Code do autenticador em imagem' },
  }, async (req, reply) => {
    const u = await auth.validarPreMfa(req.cookies[COOKIES.preMfa]);
    reply.header('Cache-Control', 'no-store').type('image/png');
    return auth.qrCodeMfa(u);
  });

  r.post('/mfa/ativar', {
    config: { acesso: 'pre-mfa', rateLimit: limiteLogin },
    schema: {
      tags, summary: '3º passo (primeiro acesso): confirmar o código e receber os códigos de recuperação',
      description: 'Os 10 códigos de recuperação aparecem só esta vez. Guarde em lugar seguro.',
      body: z.object({ codigo: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 dígitos') }).meta({ example: { codigo: '123456' } }),
    },
  }, async (req, reply) => {
    const u = await auth.validarPreMfa(req.cookies[COOKIES.preMfa]);
    const { sessao, codigosRecuperacao } = await auth.ativarMfa(u, req.body.codigo, origem(req));
    gravarCookiesSessao(reply, config, sessao);
    reply.header('Cache-Control', 'no-store');
    return { usuario: usuarioPublico({ ...u, mfaAtivo: true }, cripto), codigosRecuperacao };
  });

  r.post('/mfa/verificar', {
    config: { acesso: 'pre-mfa', rateLimit: limiteLogin },
    schema: {
      tags, summary: '2º passo: código de 6 dígitos do autenticador (ou um código de recuperação)',
      body: z.object({
        codigo: z.string().trim().regex(/^\d{6}$/, 'O código tem 6 dígitos').optional(),
        codigoRecuperacao: z.string().trim().max(20).optional(),
      }).refine((b) => !!b.codigo !== !!b.codigoRecuperacao, 'Informe o código do autenticador ou um código de recuperação')
        .meta({ example: { codigo: '123456' } }),
    },
  }, async (req, reply) => {
    const u = await auth.validarPreMfa(req.cookies[COOKIES.preMfa]);
    const { sessao, codigosRecuperacaoRestantes } = await auth.verificarMfa(u, req.body, origem(req));
    gravarCookiesSessao(reply, config, sessao);
    return { usuario: usuarioPublico(u, cripto), codigosRecuperacaoRestantes };
  });

  r.post('/renovar', {
    config: { acesso: 'refresh', rateLimit: { max: 60, timeWindow: '1 minute' } },
    schema: { tags, summary: 'Renovar a sessão (troca o refresh token)' },
  }, async (req, reply) => {
    try {
      gravarCookiesSessao(reply, config, await auth.renovar(req.cookies[COOKIES.refresh]));
    } catch (e) {
      limparCookies(reply);
      throw e;
    }
    return { ok: true };
  });

  r.post('/sair', { config: { acesso: 'sessao' }, schema: { tags, summary: 'Sair (encerra a sessão)' } }, async (req, reply) => {
    await auth.sair(req.logado!.sessaoId, req.logado!.usuario.id, origem(req));
    limparCookies(reply);
    return { ok: true };
  });

  r.get('/eu', { config: { acesso: 'sessao' }, schema: { tags, summary: 'Usuário logado' } }, async (req) =>
    usuarioPublico(req.logado!.usuario, cripto));

  r.post('/trocar-senha', {
    config: { acesso: 'sessao', rateLimit: limiteLogin },
    schema: {
      tags, summary: 'Trocar a própria senha (obrigatório no primeiro acesso)',
      description: 'Mínimo de 12 caracteres. Senhas comuns são recusadas.',
      body: z.object({ senhaAtual: z.string().max(128), novaSenha: z.string().max(128) }),
    },
  }, async (req) => {
    await auth.trocarSenha(req.logado!.usuario, req.logado!.sessaoId, req.body.senhaAtual, req.body.novaSenha, origem(req));
    return { ok: true };
  });
}
