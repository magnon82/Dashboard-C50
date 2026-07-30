import { Suspense } from 'react';
import LoginForm from './LoginForm';

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="flex min-h-screen items-center justify-center bg-slate-100">
          <p className="text-slate-500">Cargando…</p>
        </main>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
