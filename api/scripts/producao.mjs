/**
 * Tarefas avulsas na AWS (imagem "migracao", tarefa ECS "ameta-nfse-tarefas"), sempre com o usuário dono do banco:
 *
 *   node scripts/producao.mjs                         migrações + papel ameta_app (antes de cada versão nova)
 *   node scripts/producao.mjs admin --nome N --email E  primeiro ADMIN; senha em SENHA_ADMIN, provisória
 *   node scripts/producao.mjs importar                importa a planilha de PLANILHA_URL (link temporário do S3)
 *                                                     ou de PLANILHA_ARQUIVO (opção Lightsail: arquivo no servidor)
 *
 * O RDS guarda a senha do dono no Secrets Manager (e troca de tempos em tempos), então a URL do banco
 * é montada aqui a partir de DB_HOST, DB_NOME, DB_USUARIO e DB_SENHA, com TLS obrigatório.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';

const { DB_HOST, DB_NOME = 'ameta', DB_USUARIO, DB_SENHA } = process.env;
if (!process.env.DATABASE_URL) {
  if (!DB_HOST || !DB_USUARIO || !DB_SENHA) {
    console.error('Defina DATABASE_URL, ou DB_HOST, DB_USUARIO e DB_SENHA.');
    process.exit(1);
  }
  const url = new URL(`postgresql://${DB_HOST}:5432/${encodeURIComponent(DB_NOME)}`);
  url.username = encodeURIComponent(DB_USUARIO);
  url.password = encodeURIComponent(DB_SENHA);
  url.search = 'schema=public&sslmode=require';
  process.env.DATABASE_URL = url.toString();
}

function rodar(cmd, args) {
  const r = spawnSync(cmd, args, { stdio: 'inherit', env: process.env });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

const [tarefa = 'migrar', ...resto] = process.argv.slice(2);
if (tarefa === 'migrar') {
  rodar('npx', ['prisma', 'migrate', 'deploy']);
  rodar('node', ['dist/scripts/configurar-banco.js']);
} else if (tarefa === 'admin') {
  rodar('node', ['dist/scripts/criar-admin.js', ...resto, '--provisoria']);
} else if (tarefa === 'importar') {
  let arquivo = '/tmp/planilha.xlsx';
  if (process.env.PLANILHA_URL) {
    const r = await fetch(process.env.PLANILHA_URL);
    if (!r.ok) {
      console.error(`Não deu para baixar a planilha: HTTP ${r.status}`);
      process.exit(1);
    }
    await writeFile(arquivo, Buffer.from(await r.arrayBuffer()));
  } else if (process.env.PLANILHA_ARQUIVO && existsSync(process.env.PLANILHA_ARQUIVO)) {
    arquivo = process.env.PLANILHA_ARQUIVO;
  } else {
    console.error('Defina PLANILHA_URL (aws s3 presign ... --expires-in 900) ou coloque a planilha em PLANILHA_ARQUIVO.');
    process.exit(1);
  }
  rodar('node', ['dist/scripts/importar-planilha.js', '--file', arquivo, '--saida', '/tmp/importacao', ...resto]);
} else {
  console.error(`Tarefa desconhecida: ${tarefa}`);
  process.exit(1);
}
