import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, Check, Copy } from 'lucide-react';
import { useAuth } from '../lib/AuthContext.jsx';
import { createPaymentClaim, getCapabilities, listMyPayments } from '../lib/api.js';

function fmt(ts) {
  return ts ? new Date(ts).toLocaleString() : '—';
}

function badge(status) {
  if (status === 'approved') return 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200';
  if (status === 'rejected') return 'border-red-500/40 bg-red-500/10 text-red-200';
  return 'border-amber-500/40 bg-amber-500/10 text-amber-200';
}

export default function Payment() {
  const { user, loading, refresh } = useAuth();
  const [caps, setCaps] = useState(null);
  const [claims, setClaims] = useState([]);
  const [method, setMethod] = useState('bkash');
  const [amount, setAmount] = useState('');
  const [txnId, setTxnId] = useState('');
  const [sender, setSender] = useState('');
  const [notice, setNotice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    getCapabilities().then(setCaps).catch(() => {});
    if (user) listMyPayments().then(setClaims).catch(() => {});
  }, [user]);

  if (loading) return <div className="mx-auto max-w-3xl px-4 py-16 text-slate-400">Loading…</div>;
  if (!user) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 text-center">
        <p className="text-slate-400">Log in to add credits with bKash or Nagad.</p>
        <Link to="/login" className="mt-4 inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white">Log in</Link>
      </div>
    );
  }

  const mp = caps?.manualPayments || {};
  const number = mp.number || '01944460344';
  const rate = mp.creditPerBdt ?? 1;
  const maxBdt = mp.maxClaimBdt || 100000;

  const doCopy = async () => {
    try {
      await navigator.clipboard.writeText(number);
    } catch {
      // Clipboard API unavailable (non-secure context): select fallback.
      const el = document.getElementById('pay-number');
      if (el) { const r = document.createRange(); r.selectNodeContents(el); window.getSelection()?.removeAllRanges(); window.getSelection()?.addRange(r); }
      setNotice({ kind: 'error', text: 'Copy failed — please select the number manually.' });
      return;
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const doSubmit = async (e) => {
    e.preventDefault();
    setNotice(null);
    const amt = Number(amount);
    if (!Number.isInteger(amt) || amt <= 0 || amt > maxBdt) {
      setNotice({ kind: 'error', text: `Amount must be a whole number between 1 and ${maxBdt} BDT.` });
      return;
    }
    if (!txnId.trim() || txnId.trim().length > 64) {
      setNotice({ kind: 'error', text: 'Transaction ID is required (max 64 characters).' });
      return;
    }
    if (!/^[0-9]{10,15}$/.test(sender.trim())) {
      setNotice({ kind: 'error', text: 'Sender mobile must be 10-15 digits (digits only).' });
      return;
    }
    setBusy(true);
    try {
      await createPaymentClaim(method, amt, txnId.trim(), sender.trim());
      setNotice({ kind: 'ok', text: 'Claim submitted. It stays Pending until an admin verifies your payment and approves it.' });
      setAmount(''); setTxnId(''); setSender('');
      setClaims(await listMyPayments());
      await refresh();
    } catch (err) {
      setNotice({ kind: 'error', text: err.message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="font-display flex items-center gap-2 text-3xl font-extrabold text-white">
        <Banknote size={26} /> Add credits
      </h1>
      <p className="mt-1 text-sm text-slate-400">
        Pay manually with bKash or Nagad, then submit the form below. Rate: <b className="text-white">1 BDT = {rate} credit{rate === 1 ? '' : 's'}</b>.
        There is no automatic payment check — an admin verifies each payment by hand before credits are added.
      </p>

      {notice && (
        <div className={`mt-4 flex items-start gap-2 rounded-2xl border px-4 py-3 text-sm ${notice.kind === 'error' ? 'border-red-500/40 bg-red-500/10 text-red-200' : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'}`}>
          <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{notice.text}</span>
        </div>
      )}

      <section className="mt-6 rounded-3xl border border-[#2563eb]/40 bg-[#2563eb]/10 p-5">
        <p className="text-sm text-slate-300">Step 1 — Send Money to this number first (bKash or Nagad app):</p>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <span id="pay-number" className="font-display text-2xl font-extrabold tracking-wide text-white">{number}</span>
          <button type="button" onClick={doCopy}
            className="inline-flex min-h-11 items-center gap-1 rounded-full border border-white/20 px-4 py-1.5 text-sm text-white hover:bg-white/10">
            {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy number</>}
          </button>
        </div>
        <p className="mt-2 text-sm text-slate-400">
          Step 2 — after sending, fill in the form below with the exact amount, transaction ID, and the mobile
          number you sent from. Keep the bKash/Nagad confirmation message until your credits appear.
        </p>
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display text-lg font-bold text-white">Submit payment claim</h2>
        <form onSubmit={doSubmit} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-slate-400">Payment method
              <select value={method} onChange={(e) => setMethod(e.target.value)}
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-[#2563eb]">
                <option value="bkash">bKash</option>
                <option value="nagad">Nagad</option>
              </select>
            </label>
            <label className="block text-sm text-slate-400">Amount (BDT)
              <input type="number" required min={1} max={maxBdt} step={1} value={amount}
                onChange={(e) => setAmount(e.target.value)} placeholder="e.g. 100"
                className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-[#2563eb]" />
            </label>
          </div>
          <label className="block text-sm text-slate-400">Transaction ID (from your bKash/Nagad confirmation)
            <input type="text" required maxLength={64} value={txnId} onChange={(e) => setTxnId(e.target.value)}
              placeholder="e.g. 9HX7K2M1P4"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-[#2563eb]" />
          </label>
          <label className="block text-sm text-slate-400">Sender mobile (the number you sent from)
            <input type="text" required inputMode="numeric" value={sender} onChange={(e) => setSender(e.target.value)}
              placeholder="e.g. 01XXXXXXXXX"
              className="mt-1 w-full rounded-xl border border-white/15 bg-black/30 px-3 py-2.5 min-h-11 text-white outline-none focus:border-[#2563eb]" />
          </label>
          <p className="text-sm text-slate-400">
            You will receive <b className="text-white">{amount && Number.isInteger(Number(amount)) && Number(amount) > 0 ? Number(amount) * rate : '—'} credits</b> once
            an admin approves this claim. Never share your bKash/Nagad password or PIN with anyone — we never ask for it.
          </p>
          <button type="submit" disabled={busy}
            className="inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8] disabled:opacity-50">
            {busy ? 'Submitting…' : 'Submit claim'}
          </button>
        </form>
      </section>

      <section className="mt-6 rounded-3xl border border-white/10 bg-white/[0.03] p-5">
        <h2 className="font-display text-lg font-bold text-white">My payment claims</h2>
        {claims.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No claims yet.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {claims.map((c) => (
              <li key={c.id} className="rounded-2xl border border-white/10 p-4 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold capitalize text-white">{c.method} · {c.amountBdt} BDT → {c.credits} credits</span>
                  <span className={`rounded-full border px-3 py-0.5 text-xs capitalize ${badge(c.status)}`}>{c.status}</span>
                </div>
                <p className="mt-1 text-slate-400">Txn: <span className="text-slate-200">{c.txnId}</span> · From: {c.senderMobile} · {fmt(c.createdAt)}</p>
                {c.status === 'rejected' && c.rejectReason && (
                  <p className="mt-1 text-red-200">Reason: {c.rejectReason}</p>
                )}
                {c.status === 'approved' && (
                  <p className="mt-1 text-emerald-200">Approved {fmt(c.decidedAt)} — credits added.</p>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
