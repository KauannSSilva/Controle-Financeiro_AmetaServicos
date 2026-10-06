/**
 * Inventário das rotas da API (contra "shadow" e "zombie" APIs): o arquivo docs/inventario-rotas.md
 * fica no Git, e um teste falha se a API expuser qualquer rota que não esteja nele (ou o contrário).
 * Para atualizar depois de criar ou remover uma rota: npm run api:rotas
 */
const ROTULO: Record<string, string> = {
  publico: 'Pública (sem login)',
  'pre-mfa': 'Depois da senha, antes do código MFA',
  refresh: 'Renovação da sessão (cookie de refresh)',
  sessao: 'Logado com MFA',
};

export function inventarioMarkdown(rotas: { metodo: string; url: string; acesso: unknown }[]): string {
  const linhas = [...rotas]
    .sort((a, b) => a.url.localeCompare(b.url) || a.metodo.localeCompare(b.metodo))
    .map((r) => {
      const acesso = Array.isArray(r.acesso) ? `Logado com MFA, perfil ${r.acesso.join(', ')}` : ROTULO[String(r.acesso)] ?? String(r.acesso);
      return `| ${r.metodo} | \`${r.url}\` | ${acesso} |`;
    });
  return [
    '# Inventário de rotas da API',
    '',
    'Gerado por `npm run api:rotas`. Um teste automático compara este arquivo com as rotas que a API realmente expõe:',
    'rota nova, removida ou com acesso diferente faz o teste falhar até o inventário ser atualizado e revisado.',
    '',
    'Fora destas, só existem as páginas do Swagger (`/api/v1/docs`), que não sobem em produção.',
    '',
    `Total: ${linhas.length} rotas, todas em \`/api/v1\`.`,
    '',
    '| Método | Rota | Quem acessa |',
    '|---|---|---|',
    ...linhas,
    '',
  ].join('\n');
}
