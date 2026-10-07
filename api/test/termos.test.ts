/** Termos de Uso e Política de Privacidade: aceite obrigatório, com versão e data gravadas. */
import { PrismaClient } from '@prisma/client';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { App } from '../src/http/app.js';
import { VERSAO_TERMOS } from '../src/termos/termos.js';
import { criarUsuario } from '../src/usuarios/usuarios.js';
import { cripto, Navegador, novaApp, SENHA } from './api-util.js';
import { limparBanco } from './util.js';

const prisma = new PrismaClient();
let app: App;
beforeEach(async () => {
  await limparBanco(prisma);
  app = await novaApp(prisma);
});
afterEach(() => app.close());
afterAll(() => prisma.$disconnect());

async function entrar() {
  const u = await criarUsuario(prisma, cripto(), { nome: 'Ana', email: 'ana@ameta.com.br', perfil: 'OPERADOR', senha: SENHA }, {}, { deveTrocarSenha: false });
  const nav = new Navegador(app);
  await nav.entrar('ana@ameta.com.br');
  return { nav, u };
}

describe('termos de uso e política de privacidade', () => {
  it('os textos são públicos e têm versão', async () => {
    const r = await new Navegador(app).req('GET', 'auth/termos');
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ versao: VERSAO_TERMOS });
    expect(r.json().termosDeUso.length).toBeGreaterThan(3);
    expect(JSON.stringify(r.json().politicaDePrivacidade)).toContain('LGPD');
  });

  it('sem aceite, nenhuma rota de dados funciona; o aceite grava versão, data e auditoria', async () => {
    const { nav, u } = await entrar();
    const antes = await nav.req('GET', 'contadores');
    expect(antes.statusCode).toBe(403);
    expect(antes.json().codigo).toBe('ACEITAR_TERMOS');
    expect((await nav.req('POST', 'auth/termos/aceitar', { versao: '0.9' })).statusCode).toBe(422);
    await nav.aceitarTermos();
    expect((await nav.req('GET', 'contadores')).statusCode).toBe(200);
    const gravado = await prisma.usuario.findUniqueOrThrow({ where: { id: u.id } });
    expect(gravado.termosVersaoAceita).toBe(VERSAO_TERMOS);
    expect(Date.now() - gravado.termosAceitosEm!.getTime()).toBeLessThan(60_000);
    const log = await prisma.logAuditoria.findFirstOrThrow({ where: { acao: 'TERMOS_ACEITOS' } });
    expect(log).toMatchObject({ usuarioId: u.id, valoresDepois: { versao: VERSAO_TERMOS } });
    expect(log.ip).toBeTruthy();
  });

  it('versão nova pede o aceite de novo', async () => {
    const { nav, u } = await entrar();
    await nav.aceitarTermos();
    // Simula que o usuário tinha aceitado uma versão anterior
    await prisma.usuario.update({ where: { id: u.id }, data: { termosVersaoAceita: '0.9' } });
    expect((await nav.req('GET', 'itens')).json().codigo).toBe('ACEITAR_TERMOS');
    await nav.aceitarTermos();
    expect((await nav.req('GET', 'itens')).statusCode).toBe(200);
  });

  it('sem login não dá para aceitar', async () => {
    expect((await new Navegador(app).req('POST', 'auth/termos/aceitar', { versao: VERSAO_TERMOS })).statusCode).toBe(401);
  });
});
