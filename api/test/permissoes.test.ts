/**
 * Matriz de permissões da seção 5.2 da especificação, conferida rota a rota no servidor,
 * e o teste que percorre todas as rotas sem login esperando 401.
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { PerfilUsuario, PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/http/app.js';
import { inventarioMarkdown } from '../src/http/inventario.js';
import { inserirItem, removerItem } from '../src/ordens/ordens.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';
import { cripto, Navegador, novaApp, SENHA, usuarioLogado } from './api-util.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
let app: App;
beforeEach(async () => {
  await limparBanco(prisma);
  app = await novaApp(prisma);
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

describe('rotas sem login', () => {
  it('toda rota, menos login e health check, responde 401 sem token', async () => {
    const publicas = app.inventarioRotas.filter((r) => r.acesso === 'publico').map((r) => `${r.metodo} ${r.url}`);
    expect(publicas.sort()).toEqual(['GET /api/v1/auth/termos', 'GET /api/v1/saude', 'POST /api/v1/auth/convite/aceitar', 'POST /api/v1/auth/login']);
    const protegidas = app.inventarioRotas.filter((r) => r.acesso !== 'publico');
    expect(protegidas.length).toBeGreaterThan(25);
    const id = '00000000-0000-4000-8000-000000000000';
    for (const r of protegidas) {
      const url = r.url.replace(':id', id).replace(':numeroPo', '4533000001');
      const res = await app.inject({ method: r.metodo as 'GET', url, payload: r.metodo === 'GET' ? undefined : {} });
      expect(res.statusCode, `${r.metodo} ${url}`).toBe(401);
    }
  });

  it('arquivos escondidos e rotas inexistentes dão 404', async () => {
    for (const url of ['/.env', '/.env.local', '/.git/config', '/api/v1/.env', '/api/v2/itens', '/debug', '/api/v1/debug']) {
      expect((await app.inject({ url })).statusCode, url).toBe(404);
    }
  });

  it('a API expõe exatamente as rotas do inventário (docs/inventario-rotas.md)', async () => {
    const gravado = readFileSync(path.resolve(import.meta.dirname, '../../docs/inventario-rotas.md'), 'utf8');
    expect(inventarioMarkdown(app.inventarioRotas), 'Rota nova ou removida: rode npm run api:rotas e revise').toBe(gravado);
    // Nada fora de /api/v1 (nem versões antigas ou rotas de teste)
    for (const r of app.inventarioRotas) expect(r.url).toMatch(/^\/api\/v1\//);
  });

  it('métodos não usados numa rota dão 404', async () => {
    for (const metodo of ['PUT', 'PATCH', 'DELETE'] as const) {
      expect((await app.inject({ method: metodo, url: '/api/v1/saude' })).statusCode, metodo).toBe(404);
    }
    expect((await app.inject({ method: 'PUT', url: '/api/v1/itens' })).statusCode).toBe(404);
  });

  it('TRACE e troca de método por cabeçalho são recusados', async () => {
    expect((await app.inject({ method: 'TRACE' as 'GET', url: '/api/v1/saude' })).statusCode).toBe(404);
    const override = await app.inject({ method: 'POST', url: '/api/v1/auth/login', headers: { 'x-http-method-override': 'DELETE' }, payload: {} });
    expect(override.statusCode).toBe(400);
  });

  it('health check não expõe detalhes internos e respostas têm cabeçalhos de segurança', async () => {
    const res = await app.inject({ url: '/api/v1/saude' });
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-frame-options']).toBe('DENY');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['strict-transport-security']).toContain('includeSubDomains');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('CORS só libera o endereço do front', async () => {
    const bom = await app.inject({ method: 'OPTIONS', url: '/api/v1/itens', headers: { origin: 'http://localhost:5173', 'access-control-request-method': 'GET' } });
    expect(bom.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    const ruim = await app.inject({ method: 'OPTIONS', url: '/api/v1/itens', headers: { origin: 'https://site-malicioso.com', 'access-control-request-method': 'GET' } });
    expect(ruim.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('matriz de permissões (seção 5.2)', () => {
  const navs = {} as Record<PerfilUsuario, Navegador>;
  let itemId: string;
  let removidoId: string;
  let alvoId: string;
  let pendenteId: string;

  beforeEach(async () => {
    for (const p of ['ADMIN', 'OPERADOR', 'VISUALIZADOR'] as const) navs[p] = (await usuarioLogado(app, prisma, p)).nav;
  });

  async function prepararDados() {
    itemId = (await inserirItem(prisma, { numeroPo: '4533000001', item: '10', valorOriginal: 350 })).id;
    removidoId = (await inserirItem(prisma, { numeroPo: '4533000002', item: '10' })).id;
    await removerItem(prisma, removidoId);
    alvoId = (await criarUsuario(prisma, cripto(), { nome: 'Alvo', email: 'alvo@ameta.com.br', perfil: 'VISUALIZADOR', senha: SENHA })).id;
    pendenteId = (await criarUsuario(prisma, cripto(), { nome: 'Pendente', email: 'pendente@ameta.com.br', perfil: 'OPERADOR', senha: SENHA }, {}, { exigirConvite: true })).id;
  }

  const S = true, N = false;
  // [descrição, ADMIN, OPERADOR, VISUALIZADOR, requisição]
  const casos: [string, boolean, boolean, boolean, () => [Parameters<Navegador['req']>[0], string, unknown?]][] = [
    ['ver tela inicial', S, S, S, () => ['GET', 'inicio']],
    ['ver contadores', S, S, S, () => ['GET', 'contadores']],
    ['listar P.Os', S, S, S, () => ['GET', 'itens?status=AGUARDANDO_LIBERACAO']],
    ['ver detalhe da P.O', S, S, S, () => ['GET', 'ordens/4533000001']],
    ['adicionar P.O', S, S, N, () => ['POST', 'itens', { numeroPo: '4533000099', item: '20' }]],
    ['editar P.O', S, S, N, () => ['PATCH', `itens/${itemId}`, { projeto: 'PPI Claro' }]],
    ['mover P.O', S, S, N, () => ['POST', `itens/${itemId}/mover`, { para: 'EMITIR_NOTA' }]],
    ['remover P.O (soft delete)', S, S, N, () => ['DELETE', `itens/${itemId}`]],
    ['remover P.O inteira', S, S, N, () => ['DELETE', 'ordens/4533000001']],
    ['ver removidos', S, N, N, () => ['GET', 'itens/removidos']],
    ['restaurar', S, N, N, () => ['POST', `itens/${removidoId}/restaurar`]],
    ['exclusão definitiva', S, N, N, () => ['DELETE', `itens/${removidoId}/definitivo`]],
    ['ver usuários', S, N, N, () => ['GET', 'usuarios']],
    ['criar usuário', S, N, N, () => ['POST', 'usuarios', { nome: 'Novo', email: 'novo@ameta.com.br', perfil: 'OPERADOR', senhaProvisoria: 'provisoria da ameta 01' }]],
    ['editar usuário / alterar perfil', S, N, N, () => ['PATCH', `usuarios/${alvoId}`, { perfil: 'OPERADOR' }]],
    ['bloquear usuário', S, N, N, () => ['PATCH', `usuarios/${alvoId}`, { ativo: false }]],
    ['excluir usuário', S, N, N, () => ['DELETE', `usuarios/${alvoId}`]],
    ['resetar MFA', S, N, N, () => ['POST', `usuarios/${alvoId}/resetar-mfa`]],
    ['desbloquear usuário', S, N, N, () => ['POST', `usuarios/${alvoId}/desbloquear`]],
    ['senha provisória', S, N, N, () => ['POST', `usuarios/${alvoId}/senha-provisoria`, { senhaProvisoria: 'provisoria da ameta 02' }]],
    ['reenviar convite', S, N, N, () => ['POST', `usuarios/${pendenteId}/reenviar-convite`, { senhaProvisoria: 'provisoria da ameta 03' }]],
    ['ver auditoria', S, N, N, () => ['GET', 'auditoria']],
  ];

  for (const [descricao, ...esperado] of casos) {
    const req = esperado.pop() as (typeof casos)[number][4];
    it(descricao, async () => {
      for (const [i, perfil] of (['ADMIN', 'OPERADOR', 'VISUALIZADOR'] as const).entries()) {
        await limparDados();
        await prepararDados();
        const [metodo, url, corpo] = req();
        const res = await navs[perfil].req(metodo, url, corpo);
        if (esperado[i]) expect(res.statusCode, `${perfil}: ${res.body}`).toBeLessThan(300);
        else expect(res.statusCode, `${perfil}: ${res.body}`).toBe(403);
      }
    });
  }

  async function limparDados() {
    await prisma.$executeRawUnsafe('TRUNCATE historico_status, itens_po, ordens_compra CASCADE');
    await prisma.usuario.deleteMany({ where: { emailHash: { in: ['alvo@ameta.com.br', 'novo@ameta.com.br', 'pendente@ameta.com.br'].map((e) => cripto().hashEmail(e)) } } });
  }
});

describe('regras de ADMIN', () => {
  it('o único ADMIN ativo não pode tirar o próprio acesso, se bloquear nem se excluir', async () => {
    const { nav, usuario } = await usuarioLogado(app, prisma, 'ADMIN');
    expect((await nav.req('PATCH', `usuarios/${usuario.id}`, { perfil: 'OPERADOR' })).statusCode).toBe(422);
    expect((await nav.req('PATCH', `usuarios/${usuario.id}`, { ativo: false })).statusCode).toBe(422);
    expect((await nav.req('DELETE', `usuarios/${usuario.id}`)).statusCode).toBe(422);
    // Com um segundo ADMIN, pode deixar de ser ADMIN
    await usuarioLogado(app, prisma, 'ADMIN');
    expect((await nav.req('PATCH', `usuarios/${usuario.id}`, { perfil: 'OPERADOR' })).statusCode).toBe(200);
  });

  it('perfil alterado vale na hora, sem novo login', async () => {
    const { nav: admin } = await usuarioLogado(app, prisma, 'ADMIN');
    const { nav: op, usuario } = await usuarioLogado(app, prisma, 'OPERADOR');
    expect((await op.req('POST', 'itens', { numeroPo: '4533000001' })).statusCode).toBe(201);
    await admin.req('PATCH', `usuarios/${usuario.id}`, { perfil: 'VISUALIZADOR' });
    expect((await op.req('POST', 'itens', { numeroPo: '4533000002' })).statusCode).toBe(403);
  });

  it('bloquear derruba as sessões abertas do usuário', async () => {
    const { nav: admin } = await usuarioLogado(app, prisma, 'ADMIN');
    const { nav: op, usuario } = await usuarioLogado(app, prisma, 'OPERADOR');
    await admin.req('PATCH', `usuarios/${usuario.id}`, { ativo: false });
    expect((await op.req('GET', 'itens')).statusCode).toBe(401);
  });

  it('ações administrativas vão para a auditoria, sem dados pessoais', async () => {
    const { nav: admin, usuario: adm } = await usuarioLogado(app, prisma, 'ADMIN');
    const criado = await admin.req('POST', 'usuarios', { nome: 'Carla Souza', email: 'carla@ameta.com.br', perfil: 'OPERADOR', senhaProvisoria: 'provisoria da ameta 01' });
    await admin.req('PATCH', `usuarios/${criado.json().id}`, { nome: 'Carla S. Souza', perfil: 'VISUALIZADOR' });
    const log = (await admin.req('GET', 'auditoria?porPagina=200')).json();
    const acoes = log.registros.map((r: { acao: string }) => r.acao);
    expect(acoes).toEqual(expect.arrayContaining(['USUARIO_CRIADO', 'CONVITE_ENVIADO', 'USUARIO_EDITADO', 'LOGIN_SUCESSO', 'MFA_ATIVADO']));
    const editado = log.registros.find((r: { acao: string }) => r.acao === 'USUARIO_EDITADO');
    expect(editado).toMatchObject({ usuarioId: adm.id, usuarioNome: 'Pessoa ADMIN', alvo: 'Carla S. Souza', valoresDepois: { perfil: 'VISUALIZADOR', nome: '(alterado)' } });
    // P.O aparece pelo número, também depois de excluída de vez
    const item = (await admin.req('POST', 'itens', { numeroPo: '4533000077', item: '20' })).json();
    await admin.req('DELETE', `itens/${item.id}`);
    await admin.req('DELETE', `itens/${item.id}/definitivo`);
    const doItem = (await admin.req('GET', `auditoria?entidadeId=${item.id}`)).json().registros;
    expect(doItem.map((r: { acao: string; alvo: string }) => `${r.acao} ${r.alvo}`)).toEqual([
      'ITEM_EXCLUIDO_DEFINITIVO P.O 4533000077 · item 20', 'ITEM_REMOVIDO P.O 4533000077 · item 20', 'ITEM_CRIADO P.O 4533000077 · item 20',
    ]);
    const texto = JSON.stringify(await prisma.logAuditoria.findMany({ select: { valoresAntes: true, valoresDepois: true } }));
    expect(texto).not.toContain('Carla');
    expect(texto).not.toContain('carla@');
    expect(texto).not.toContain('provisoria');
  });
});
