import logo from '../../../assets/logo/logo.png';
import { useAuth } from '../auth';
import { FormSenha } from '../componentes/FormSenha';
import { Botao } from '../componentes/ui';

export function TrocarSenhaObrigatoria() {
  const { atualizar, sair } = useAuth();
  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-marca-800 to-marca-900 p-4">
      <div className="w-full max-w-md rounded-xl bg-white p-8 shadow-2xl">
        <img src={logo} alt="Ameta Serviços" className="mx-auto h-20 w-auto" />
        <h1 className="mt-4 text-lg font-semibold text-slate-900">Crie a sua senha</h1>
        <p className="mb-4 text-sm text-slate-600">Você entrou com uma senha provisória. Troque por uma senha só sua para continuar.</p>
        <FormSenha aoConcluir={atualizar} />
        <Botao variante="fantasma" className="mt-2 w-full" onClick={sair}>Sair</Botao>
      </div>
    </main>
  );
}
