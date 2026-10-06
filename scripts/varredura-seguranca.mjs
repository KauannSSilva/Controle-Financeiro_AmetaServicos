/**
 * npm run security:scan — varredura de segurança do projeto:
 * 1. .env fora do Git (no disco e no histórico);
 * 2. segredos no código e em todo o histórico do Git (gitleaks, pelo Docker);
 * 3. dependências com vulnerabilidade conhecida (npm audit);
 * 4. build do site sem segredos.
 * Termina com erro se algo falhar.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import path from 'node:path';

const raiz = path.resolve(import.meta.dirname, '..');
const windows = process.platform === 'win32';
let falhas = 0;
const ok = (m) => console.log(`  OK    ${m}`);
const erro = (m) => { falhas++; console.log(`  FALHA ${m}`); };
const rodar = (cmd, args, opcoes = {}) => spawnSync(cmd, args, { cwd: raiz, encoding: 'utf8', shell: windows, ...opcoes });

console.log('\n1. Arquivos .env fora do Git');
const ignorado = rodar('git', ['check-ignore', '-q', '.env']);
ignorado.status === 0 ? ok('.env está no .gitignore') : erro('.env NÃO está no .gitignore');
const rastreados = rodar('git', ['ls-files']).stdout.split('\n').filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
rastreados.length === 0 ? ok('nenhum .env no repositório') : erro(`arquivos .env no repositório: ${rastreados.join(', ')}`);
const historico = rodar('git', ['log', '--all', '--name-only', '--format=']).stdout.split('\n')
  .filter((f) => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));
historico.length === 0 ? ok('nenhum .env em todo o histórico do Git') : erro(`.env já esteve no histórico: ${[...new Set(historico)].join(', ')}`);

console.log('\n2. Segredos no código e no histórico (gitleaks)');
const docker = process.env.GITLEAKS ? { status: 0 } : rodar('docker', ['version', '--format', '{{.Server.Version}}']);
if (docker.status !== 0) {
  erro('Docker não está rodando: abra o Docker Desktop e rode de novo');
} else {
  const r = process.env.GITLEAKS ? rodar(process.env.GITLEAKS, ['git', '.', '--redact', '--log-opts=--all'], { stdio: 'inherit' }) : rodar('docker', ['run', '--rm', '-e', 'GIT_CONFIG_COUNT=1', '-e', 'GIT_CONFIG_KEY_0=safe.directory', '-e', 'GIT_CONFIG_VALUE_0=*', '-v', `${raiz}:/repo`, 'zricethezav/gitleaks:v8.30.1', 'git', '/repo', '--redact', '--log-opts=--all'], { stdio: 'inherit' });
  r.status === 0 ? ok('gitleaks não encontrou segredos') : erro('gitleaks encontrou possíveis segredos (veja acima)');
}

console.log('\n3. Dependências (npm audit)');
const audit = rodar('npm', ['audit', '--audit-level=moderate'], { stdio: 'inherit' });
audit.status === 0 ? ok('nenhuma vulnerabilidade moderada ou maior') : erro('npm audit encontrou vulnerabilidades');

console.log('\n4. Build do site sem segredos');
try {
  execFileSync('npm', ['run', 'site:build'], { cwd: raiz, stdio: 'pipe', shell: windows });
  const env = existsSync(path.join(raiz, '.env')) ? readFileSync(path.join(raiz, '.env'), 'utf8') : '';
  const segredos = [...env.matchAll(/^([A-Z_]+)=["']?([^"'\n]{12,})/gm)].map((m) => m[2]);
  const pasta = path.join(raiz, 'web', 'dist', 'assets');
  const vazou = readdirSync(pasta).filter((f) => segredos.some((s) => readFileSync(path.join(pasta, f), 'utf8').includes(s)));
  vazou.length === 0 ? ok(`nenhum valor do .env dentro do site (${readdirSync(pasta).length} arquivos)`) : erro(`valores do .env dentro de: ${vazou.join(', ')}`);
} catch (e) {
  erro(`build do site falhou: ${e.message}`);
}

console.log(falhas ? `\n${falhas} problema(s) encontrado(s).\n` : '\nTudo certo.\n');
process.exit(falhas ? 1 : 0);
