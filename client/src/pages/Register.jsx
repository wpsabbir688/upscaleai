import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { UserPlus, AlertTriangle } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await register(email.trim(), password);
      navigate('/studio');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-16 sm:px-6">
      <h1 className="font-display text-3xl font-extrabold text-white">Create your account</h1>
      <p className="mt-1 text-slate-400">Every new account starts with 10 free credits. No payment is taken — paid plans are not live yet.</p>
      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      <form onSubmit={submit} className="mt-6 space-y-4 rounded-3xl border border-white/10 bg-white/[0.03] p-6">
        <label className="block">
          <span className="text-sm text-slate-300">Email</span>
          <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-white outline-none focus:border-[#2563eb]"
            placeholder="you@example.com" autoComplete="email" />
        </label>
        <label className="block">
          <span className="text-sm text-slate-300">Password (at least 8 characters)</span>
          <input type="password" required minLength={8} value={password} onChange={(e) => setPassword(e.target.value)}
            className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 text-white outline-none focus:border-[#2563eb]"
            placeholder="At least 8 characters" autoComplete="new-password" />
        </label>
        <button type="submit" disabled={busy}
          className="inline-flex w-full items-center justify-center gap-2 rounded-full bg-[#2563eb] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
          <UserPlus size={16} /> {busy ? 'Creating…' : 'Create account'}
        </button>
        <p className="text-center text-sm text-slate-400">
          Already have an account? <Link to="/login" className="text-[#42d9f5] hover:underline">Log in</Link>
        </p>
      </form>
    </div>
  );
}
