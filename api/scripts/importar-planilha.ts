/**
 * Importa a planilha de controle para o banco.
 *
 *   npm run import:planilha -- --file ./data/Controle_AMETA_12.xlsx [--aba AMETA-2025-NEW] [--saida ./data/importacao]
 *
 * Grava rejeitadas.csv e avisos.csv na pasta de saída (fica fora do Git, contém dados de clientes).
 */
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { criarPrisma } from '../src/db.js';
import { ABA_PRINCIPAL, gravarNoBanco, lerPlanilha } from '../src/importacao/importar.js';
import { validarCarga } from '../src/importacao/validar.js';

const { values } = parseArgs({
  options: {
    file: { type: 'string' },
    aba: { type: 'string', default: ABA_PRINCIPAL },
    saida: { type: 'string' },
  },
});

if (!values.file) {
  console.error('Uso: npm run import:planilha -- --file ./data/planilha.xlsx');
  process.exit(1);
}

// Caminhos relativos partem da pasta onde o comando foi chamado (npm guarda em INIT_CWD)
const base = process.env.INIT_CWD ?? process.cwd();
const arquivo = path.resolve(base, values.file);
const saida = path.resolve(base, values.saida ?? './data/importacao');

const brl = (n: number) => n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const csv = (linhas: (string | number)[][]) =>
  '﻿' + linhas.map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\r\n') + '\r\n';

const prisma = criarPrisma();
try {
  console.log(`Lendo ${arquivo} (aba ${values.aba})...`);
  const leitura = await lerPlanilha(arquivo, values.aba);
  const r = await gravarNoBanco(prisma, leitura);

  await mkdir(saida, { recursive: true });
  await writeFile(path.join(saida, 'rejeitadas.csv'), csv([['linha', 'motivo', 'dados'], ...r.rejeitadas.map((x) => [x.linha, x.motivo, x.dados])]));
  await writeFile(path.join(saida, 'avisos.csv'), csv([['linha', 'coluna', 'valor', 'motivo'], ...r.avisos.map((a) => [a.linha, a.coluna, a.valor, a.motivo])]));

  console.log('\n=== Importação ===');
  console.log(`Linhas lidas:        ${r.lidas}`);
  console.log(`Inseridas:           ${r.inseridas}`);
  console.log(`Atualizadas:         ${r.atualizadas}`);
  console.log(`Sem mudança:         ${r.semMudanca}`);
  console.log(`Rejeitadas:          ${r.rejeitadas.length}`);
  console.log(`P.Os novas:          ${r.posCriadas}`);
  console.log(`Avisos (importadas): ${r.avisos.length}`);

  console.log('\nLinhas por STATUS na planilha:');
  for (const [s, n] of Object.entries(r.porStatusPlanilha).sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(32)} ${n}`);

  if (r.rejeitadas.length) {
    console.log('\nRejeitadas:');
    for (const x of r.rejeitadas.slice(0, 20)) console.log(`  linha ${x.linha}: ${x.motivo}`);
    if (r.rejeitadas.length > 20) console.log(`  ... e mais ${r.rejeitadas.length - 20} (ver rejeitadas.csv)`);
  }

  const motivos = new Map<string, number>();
  for (const a of r.avisos) {
    const chave = a.motivo.replace(/\d{4}/, 'AAAA').replace(/\(\d+(\.\d+)?\)/, '(...)').replace(/status .*/, 'status não emitido');
    motivos.set(chave, (motivos.get(chave) ?? 0) + 1);
  }
  if (motivos.size) {
    console.log('\nAvisos por motivo (linhas importadas mesmo assim):');
    for (const [m, n] of [...motivos].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${m}`);
  }

  console.log('\n=== Validação da carga (banco x planilha) ===');
  const v = await validarCarga(prisma, r);
  for (const c of v.checagens) console.log(`  ${c.ok ? 'OK ' : 'ERRO'}  ${c.nome}: ${c.detalhe}`);
  console.log('\nNo banco, por status:');
  for (const s of v.porStatus) console.log(`  ${s.status.padEnd(22)} ${String(s.itens).padStart(5)} itens   ${brl(s.valorOriginal).padStart(16)} original   ${brl(s.valorFinal).padStart(16)} c/ multa`);
  console.log(`\nRelatórios em ${saida}`);
  if (!v.checagens.every((c) => c.ok)) process.exitCode = 2;
} finally {
  await prisma.$disconnect();
}
