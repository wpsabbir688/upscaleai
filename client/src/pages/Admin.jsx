import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Shield } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import {
  adminOverview, adminUsers, adminJobs, adminHealth, adminAudit,
  adminSuspend, adminUnsuspend, adminSetPlan, adminAdjustCredits,
} from '../lib/api.js';

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

export default function Admin() {
  const { user, loading } = useAuth();
  const [overview, setOverview] = useState(null);
  const [health, setHealth] = useState(null);
  const [users, setUsers] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [audit, setAudit] = useState([]);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const [adjust, setAdjust] = useState({}); // userId -> { delta, reason }

  const refresh = useCallback(async () => {
    try {
      const [o, h, u, j, a] = await Promise.all([
        adminOverview(), adminHealth(), adminUsers(), adminJobs(), adminAudit(),
      ]);
      setOverview(o); setHealth(h); setUsers(u); setJobs(j); setAudit(a);
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { if (user?.role === 'admin') refresh(); }, [user, refresh]);

  if (loading) return <div className="mx-auto max-w-7xl px-4 py-16 text-slate-400">Loading…</div>;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-slate-400">Log in as an admin to see this dashboard.</p>
        <Link to="/login" className="mt-4 inline-block rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white">Log in</Link>
      </div>
    );
  }
  if (user.role !== 'admin') {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-slate-400">Admin access required. This page is only for administrators.</p>
        <Link to="/studio" className="mt-4 inline-block rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white">Back to studio</Link>
      </div>
    );
  }

  const act = async (fn, label) => {
    setNotice(null);
    try {
      await fn();
      setNotice({ kind: 'ok', text: label });
      await refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    }
  };

  const doAdjust = async (id) => {
    const form = adjust[id] || {};
    const delta = Number(form.delta);
    if (!Number.isInteger(delta) || delta === 0) {
      setNotice({ kind: 'error', text: 'Enter a non-zero whole number of credits.' });
      return;
    }
    await act(() => adminAdjustCredits(id, delta, form.reason || ''), `Adjusted credits by ${delta}.`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <h1 className="font-display flex items-center gap-2 text-3xl font-extrabold text-white">
        <Shield size={26} /> Admin dashboard
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        Every sensitive action below is written to the audit log. Plan changes are labels only until verified payments exist.
      </p>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{error}</span>
        </div>
      )}
      {notice && (
        <div className={`mt-4 rounded-2xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
          {notice.text}
        </div>
      )}

      {overview && (
        <section className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {[
            ['Users', `${overview.users.total} total · ${overview.users.active} active · ${overview.users.suspended} suspended`],
            ['Jobs done / failed', `${overview.jobs.done || 0} / ${overview.jobs.failed || 0}`],
            ['Credits spent / refunded', `${overview.credits.spentOnJobs} / ${overview.credits.refunded}`],
            ['Credits outstanding', `${overview.credits.outstanding}`],
          ].map(([label, value]) => (
            <div key={label} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <p className="text-xs text-slate-500">{label}</p>
              <p className="mt-1 text-lg font-bold text-white">{value}</p>
            </div>
          ))}
        </section>
      )}

      {health && (
        <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
          <h2 className="font-display text-lg font-bold text-white">Worker health</h2>
          <dl className="mt-2 grid gap-2 text-sm sm:grid-cols-2">
            <div className="flex justify-between"><dt className="text-slate-400">Queue depth</dt><dd className="text-white">{health.queueDepth}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Running job</dt><dd className="text-white">{health.runningJobId ? health.runningJobId.slice(0, 8) : 'idle'}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Last completed</dt><dd className="text-white">{fmt(health.lastCompletedAt)}</dd></div>
            <div className="flex justify-between"><dt className="text-slate-400">Last error</dt><dd className="max-w-xs truncate text-white" title={health.lastError || ''}>{health.lastError || 'none'}</dd></div>
          </dl>
        </section>
      )}

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display text-lg font-bold text-white">Users</h2>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead>
              <tr className="text-slate-500">
                <th className="py-2 pr-4 font-medium">Email</th>
                <th className="py-2 pr-4 font-medium">Role</th>
                <th className="py-2 pr-4 font-medium">Status</th>
                <th className="py-2 pr-4 font-medium">Plan</th>
                <th className="py-2 pr-4 font-medium">Credits</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-white/5">
                  <td className="py-2 pr-4 text-white">{u.email}</td>
                  <td className="py-2 pr-4 text-slate-300">{u.role}</td>
                  <td className="py-2 pr-4 text-slate-300">{u.status}</td>
                  <td className="py-2 pr-4">
                    <select value={u.plan} onChange={(e) => act(() => adminSetPlan(u.id, e.target.value), `Plan set to ${e.target.value}.`)}
                      className="rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-white">
                      {['free', 'pro', 'premium'].map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  </td>
                  <td className="py-2 pr-4 text-white">{u.credits}</td>
                  <td className="py-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {u.status === 'active'
                        ? <button type="button" onClick={() => act(() => adminSuspend(u.id), 'User suspended.')} className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">Suspend</button>
                        : <button type="button" onClick={() => act(() => adminUnsuspend(u.id), 'User unsuspended.')} className="rounded-full border border-white/15 px-3 py-1 text-xs text-slate-200 hover:bg-white/10">Unsuspend</button>}
                      <input type="number" placeholder="±credits" aria-label={`Credit adjustment for ${u.email}`}
                        value={adjust[u.id]?.delta ?? ''}
                        onChange={(e) => setAdjust((a) => ({ ...a, [u.id]: { ...a[u.id], delta: e.target.value } }))}
                        className="w-24 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-white" />
                      <input type="text" placeholder="Reason" aria-label={`Reason for ${u.email}`}
                        value={adjust[u.id]?.reason ?? ''}
                        onChange={(e) => setAdjust((a) => ({ ...a, [u.id]: { ...a[u.id], reason: e.target.value } }))}
                        className="w-32 rounded-lg border border-white/15 bg-black/30 px-2 py-1 text-white" />
                      <button type="button" onClick={() => doAdjust(u.id)} className="rounded-full bg-[#2563eb] px-3 py-1 text-xs font-semibold text-white hover:bg-[#1d4ed8]">Apply</button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display text-lg font-bold text-white">Recent jobs</h2>
        {jobs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No jobs yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {jobs.slice(0, 50).map((j) => (
              <li key={j.id} className="flex flex-wrap justify-between gap-2 border-t border-white/5 py-1.5">
                <span className="text-slate-300">{j.originalName} · {j.inputW}×{j.inputH} → {j.scale}x · {j.userEmail || 'deleted user'}</span>
                <span className="text-slate-400">{j.status} · {fmt(j.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display text-lg font-bold text-white">Audit log</h2>
        {audit.length === 0 ? (
          <p className="mt-2 text-sm text-slate-500">No admin actions recorded yet.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm">
            {audit.slice(0, 100).map((a) => (
              <li key={a.id} className="flex flex-wrap justify-between gap-2 border-t border-white/5 py-1.5">
                <span className="text-slate-300">{a.action} · {a.actorEmail} → {a.targetEmail || '—'}</span>
                <span className="max-w-md truncate text-slate-500" title={a.detail || ''}>{a.detail || ''}</span>
                <span className="text-slate-500">{fmt(a.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
