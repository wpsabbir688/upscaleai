import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlertTriangle, Coins, KeyRound, Trash2, User } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { getCredits, changePassword, deleteAccount } from '../lib/api.js';

function fmt(ts) {
  return new Date(ts).toLocaleString();
}

export default function Profile() {
  const { user, loading, logout, refresh } = useAuth();
  const navigate = useNavigate();
  const [creditInfo, setCreditInfo] = useState(null);
  const [notice, setNotice] = useState(null);
  const [currentPw, setCurrentPw] = useState('');
  const [newPw, setNewPw] = useState('');
  const [pwBusy, setPwBusy] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delArmed, setDelArmed] = useState(false);
  const [delBusy, setDelBusy] = useState(false);

  useEffect(() => {
    if (user) getCredits().then(setCreditInfo).catch(() => {});
  }, [user]);

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-16 text-slate-400">Loading…</div>;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-slate-400">Log in to see your profile.</p>
        <Link to="/login" className="mt-4 inline-block rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white">Log in</Link>
      </div>
    );
  }

  const doChangePassword = async (e) => {
    e.preventDefault();
    setNotice(null);
    setPwBusy(true);
    try {
      await changePassword(currentPw, newPw);
      setNotice({ kind: 'ok', text: 'Password changed. Other sessions were signed out.' });
      setCurrentPw('');
      setNewPw('');
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setPwBusy(false);
    }
  };

  const doDelete = async () => {
    setNotice(null);
    setDelBusy(true);
    try {
      await deleteAccount(delPw);
      await logout();
      navigate('/');
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
      setDelBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display flex items-center gap-2 text-3xl font-extrabold text-white">
        <User size={26} /> Profile
      </h1>

      {notice && (
        <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{notice.text}</span>
        </div>
      )}

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <dl className="space-y-1 text-sm">
          <div className="flex justify-between gap-4"><dt className="shrink-0 text-slate-400">Email</dt><dd className="min-w-0 break-all text-right text-white">{user.email}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Plan</dt><dd className="text-white capitalize">{user.plan}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Role</dt><dd className="text-white capitalize">{user.role}</dd></div>
          <div className="flex justify-between"><dt className="text-slate-400">Member since</dt><dd className="text-white">{fmt(user.createdAt)}</dd></div>
        </dl>
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
          <Coins size={18} /> Credits: {creditInfo ? creditInfo.balance : user.credits}
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          2x costs 1 credit, 4x costs 2 credits. Failed or cancelled jobs refund automatically.
        </p>
        <Link to="/payment" className="mt-3 inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8]">
          Add credits via bKash / Nagad
        </Link>
        {creditInfo && creditInfo.ledger.length > 0 && (
          <ul className="mt-4 space-y-1 text-sm">
            {creditInfo.ledger.map((x, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 border-t border-white/5 py-1.5">
                <span className="min-w-0 break-words text-slate-300">
                  {x.reason === 'signup' ? 'Signup grant' : x.reason === 'job' ? `Job ${x.jobId?.slice(0, 8)}` : x.reason === 'refund' ? `Refund for job ${x.jobId?.slice(0, 8)}` : 'Admin adjustment'}
                </span>
                <span className={x.delta >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                  {x.delta >= 0 ? `+${x.delta}` : x.delta}
                </span>
                <span className="text-slate-500">{fmt(x.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-white">
          <KeyRound size={18} /> Change password
        </h2>
        <form onSubmit={doChangePassword} className="mt-3 space-y-3">
          <input type="password" required value={currentPw} onChange={(e) => setCurrentPw(e.target.value)}
            placeholder="Current password" autoComplete="current-password"
            className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-[#2563eb]" />
          <input type="password" required minLength={8} value={newPw} onChange={(e) => setNewPw(e.target.value)}
            placeholder="New password (at least 8 characters)" autoComplete="new-password"
            className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-[#2563eb]" />
          <button type="submit" disabled={pwBusy}
            className="inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
            {pwBusy ? 'Changing…' : 'Change password'}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-3xl border border-red-500/30 bg-red-500/[0.05] p-5">
        <h2 className="font-display flex items-center gap-2 text-lg font-bold text-red-200">
          <Trash2 size={18} /> Delete account
        </h2>
        <p className="mt-1 text-sm text-slate-400">
          Permanently deletes your account, all jobs and files, credit history, and sessions. This cannot be undone.
        </p>
        {!delArmed ? (
          <button type="button" onClick={() => setDelArmed(true)}
            className="mt-3 inline-flex min-h-11 items-center rounded-full border border-red-500/50 px-5 py-2.5 text-sm font-semibold text-red-200 hover:bg-red-500/10">
            Delete my account…
          </button>
        ) : (
          <div className="mt-3 space-y-3">
            <input type="password" value={delPw} onChange={(e) => setDelPw(e.target.value)}
              placeholder="Enter your password to confirm" autoComplete="current-password"
              className="w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-red-500" />
            <div className="flex gap-2">
              <button type="button" onClick={doDelete} disabled={delBusy || !delPw}
                className="inline-flex min-h-11 items-center rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-red-500 disabled:opacity-50">
                {delBusy ? 'Deleting…' : 'Yes, delete everything'}
              </button>
              <button type="button" onClick={() => { setDelArmed(false); setDelPw(''); }}
                className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 py-2.5 text-sm text-slate-300 hover:bg-white/10">
                Cancel
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
