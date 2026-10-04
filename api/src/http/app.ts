/**
 * API REST (/api/v1) em Fastify. Toda rota declara quem pode acessá-la (config.acesso);
 * rota sem essa declaração impede a API de subir (negar por padrão).
 */
import { randomUUID } from 'node:crypto';
import { PrismaClient } from '@prisma/client';
import cookie from '@fastify/cookie';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import Fastify from 'fastify';
import {
  hasZodFastifySchemaValidationErrors, jsonSchemaTransform, serializerCompiler, validatorCompiler, ZodTypeProvider,
} from 'fastify-type-provider-zod';
import { Autenticacao } from '../auth/auth.js';
import { Config } from '../config.js';
import { ErroConflito, ErroHttp, ErroNaoEncontrado, ErroRegra } from '../erros.js';
import { Cripto, iguaisSeguro } from '../seguranca/cripto.js';
import { CABECALHO_CSRF, COOKIES, PREFIXO } from './comum.js';
import { rotasAuditoria } from './rotas/auditoria.js';
import { rotasAuth } from './rotas/auth.js';
import { rotasOrdens } from './rotas/ordens.js';
import { rotasUsuarios } from './rotas/usuarios.js';

export interface Dependencias {
  prisma: PrismaClient;
  config: Config;
  logger?: boolean | object;
}

export async function criarApp({ prisma, config, logger = false }: Dependencias) {
  const producao = config.NODE_ENV === 'production';
  const app = Fastify({
    logger: logger === true
      ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization', `req.headers["${CABECALHO_CSRF}"]`] }
      : logger,
    genReqId: () => randomUUID(),
    bodyLimit: 100 * 1024,
    trustProxy: false, // na AWS (Fase 5) passa a confiar só no balanceador
  }).withTypeProvider<ZodTypeProvider>();

  const cripto = new Cripto(config.CHAVE_CRIPTOGRAFIA, config.CHAVE_HMAC);
  const auth = new Autenticacao(prisma, cripto, config);

  app.setValidatorCompiler(validatorCompiler);
  app.setSerializerCompiler(serializerCompiler);

  // ---------- Negar por padrão: toda rota precisa declarar o acesso ----------
  const inventario: { metodo: string; url: string; acesso: unknown }[] = [];
  app.decorate('inventarioRotas', inventario);
  app.addHook('onRoute', (rota) => {
    if (rota.url.startsWith(`${PREFIXO}/docs`)) return; // páginas do Swagger (só fora de produção)
    if (rota.method === 'OPTIONS' && rota.url === '*') return; // pré-voo do CORS
    if (!rota.config?.acesso) throw new Error(`Rota ${rota.method} ${rota.url} sem config.acesso`);
    for (const m of [rota.method].flat()) if (m !== 'HEAD') inventario.push({ metodo: m, url: rota.url, acesso: rota.config.acesso });
  });

  await app.register(cookie);
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"], // o Swagger usa estilos inline
        imgSrc: producao ? ["'self'", 'data:'] : ["'self'", 'data:', 'blob:'], // blob: mostra o QR Code no Swagger
        frameAncestors: ["'none'"],
        formAction: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        // Em http://localhost não há HTTPS para onde subir; em produção fica ligado
        upgradeInsecureRequests: producao ? [] : null,
      },
    },
    hsts: { maxAge: 31536000, includeSubDomains: true },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
  });
  await app.register(cors, {
    origin: [config.ORIGEM_FRONT],
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CABECALHO_CSRF],
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: '1 minute',
    errorResponseBuilder: () => ({ statusCode: 429, erro: 'Muitas requisições. Aguarde um pouco.' }),
  });

  if (!producao) {
    await app.register(swagger, {
      openapi: {
        info: {
          title: 'API Controle de NFS-e — Ameta Serviços',
          version: '1',
          description: 'Ambiente local. Faça login em **auth/login**, depois o passo do MFA, e as outras rotas passam a funcionar.',
        },
        servers: [{ url: '/' }],
      },
      transform: jsonSchemaTransform,
    });
    await app.register(swaggerUi, {
      routePrefix: `${PREFIXO}/docs`,
      uiConfig: {
        docExpansion: 'list',
        deepLinking: false,
        persistAuthorization: false,
        // Envia o token CSRF (lido do cookie) nas requisições feitas pela própria página
        // (roda no navegador; a função é copiada para a página do Swagger)
        requestInterceptor: ((req: { headers: Record<string, string> }) => {
          const m = (globalThis as unknown as { document: { cookie: string } }).document.cookie.match(/(?:^|; )ameta_csrf=([^;]+)/);
          if (m) req.headers['x-csrf-token'] = decodeURIComponent(m[1]);
          return req;
        }) as never,
      },
      staticCSP: false,
    });
  }

  // ---------- Bloqueios gerais ----------
  app.addHook('onRequest', async (req, reply) => {
    // Sem truques para trocar o método HTTP (APIs alternativas)
    if (req.headers['x-http-method-override'] || req.headers['x-http-method'] || req.headers['x-method-override']) {
      return reply.code(400).send({ erro: 'Cabeçalho não permitido' });
    }
  });

  // ---------- Autenticação, perfil e CSRF ----------
  app.addHook('onRequest', async (req, reply) => {
    const acesso = req.routeOptions.config?.acesso;
    if (!acesso) return; // 404 e páginas do Swagger
    const mutacao = !['GET', 'HEAD', 'OPTIONS'].includes(req.method);
    const ehLogin = acesso === 'publico';
    if (mutacao && !ehLogin) {
      const cookieCsrf = req.cookies[COOKIES.csrf];
      const cabecalho = req.headers[CABECALHO_CSRF];
      if (!cookieCsrf || typeof cabecalho !== 'string' || !iguaisSeguro(cookieCsrf, cabecalho)) {
        // Sem sessão a resposta é 401, para não revelar detalhes de CSRF a quem nem entrou
        const status = req.cookies[COOKIES.acesso] || req.cookies[COOKIES.preMfa] || req.cookies[COOKIES.refresh] ? 403 : 401;
        return reply.code(status).send({ erro: status === 401 ? 'Faça login para continuar' : 'Token CSRF ausente ou inválido. Recarregue a página.' });
      }
    }
    if (acesso === 'publico' || acesso === 'pre-mfa' || acesso === 'refresh') return; // validados na própria rota
    const logado = await auth.validarAcesso(req.cookies[COOKIES.acesso]);
    req.logado = logado;
    if (acesso === 'sessao') return;
    if (logado.usuario.deveTrocarSenha) {
      return reply.code(403).send({ erro: 'Troque a sua senha provisória antes de continuar', codigo: 'TROCAR_SENHA' });
    }
    if (!acesso.includes(logado.usuario.perfil)) {
      return reply.code(403).send({ erro: 'Seu perfil não tem permissão para esta ação' });
    }
  });

  // ---------- Erros: mensagem genérica + ID de correlação, sem stack trace ----------
  app.setErrorHandler((erro, req, reply) => {
    if (hasZodFastifySchemaValidationErrors(erro)) {
      return reply.code(400).send({
        erro: 'Dados inválidos',
        detalhes: erro.validation.map((v) => ({
          campo: String(v.instancePath ?? '').replace(/^\//, '').replace(/\//g, '.') || String(v.params?.issue ?? ''),
          mensagem: v.message,
        })),
      });
    }
    if (erro instanceof ErroHttp) return reply.code(erro.status).send({ erro: erro.message });
    if (erro instanceof ErroNaoEncontrado) return reply.code(404).send({ erro: erro.message });
    if (erro instanceof ErroConflito) return reply.code(409).send({ erro: erro.message });
    if (erro instanceof ErroRegra) return reply.code(422).send({ erro: erro.message });
    const status = (erro as { statusCode?: number }).statusCode;
    if (status === 429) return reply.code(429).send({ erro: 'Muitas requisições. Aguarde um pouco.' });
    if (status && status >= 400 && status < 500) {
      return reply.code(status).send({ erro: status === 415 ? 'Envie os dados em JSON' : 'Requisição inválida' });
    }
    req.log.error({ err: erro, correlacao: req.id }, 'erro interno');
    return reply.code(500).send({ erro: 'Erro interno. Informe este código ao suporte.', correlacao: req.id });
  });
  app.setNotFoundHandler((_req, reply) => reply.code(404).send({ erro: 'Não encontrado' }));

  // ---------- Rotas ----------
  app.get('/api/v1/saude', { config: { acesso: 'publico' }, schema: { hide: true } }, async () => ({ status: 'ok' }));

  const ctx = { prisma, cripto, auth, config };
  await app.register(async (r) => rotasAuth(r, ctx), { prefix: `${PREFIXO}/auth` });
  await app.register(async (r) => rotasOrdens(r, ctx), { prefix: PREFIXO });
  await app.register(async (r) => rotasUsuarios(r, ctx), { prefix: `${PREFIXO}/usuarios` });
  await app.register(async (r) => rotasAuditoria(r, ctx), { prefix: `${PREFIXO}/auditoria` });

  return app;
}

export type App = Awaited<ReturnType<typeof criarApp>>;
