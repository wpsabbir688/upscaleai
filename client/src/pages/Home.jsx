import { Link, useNavigate } from 'react-router-dom';
import {
  UploadCloud, SlidersHorizontal, Layers, Calculator, ShieldCheck,
  UserX, ArrowRight, Check, X, ChevronDown,
} from 'lucide-react';
import { useState } from 'react';
import UploadZone from '../components/UploadZone.jsx';
import CompareSlider from '../components/CompareSlider.jsx';
import { setPendingFile } from '../lib/transfer.js';

const FEATURES = [
  {
    icon: SlidersHorizontal, title: 'Real AI enhancement',
    text: 'Images are processed by the Real-ESRGAN x4plus super-resolution model — not a filter or a fake preview.',
  },
  {
    icon: Layers, title: 'Before / After slider',
    text: 'Drag the handle to compare original and enhanced at the same display size. Zoom, pan, reset, full screen.',
  },
  {
    icon: Calculator, title: 'Resolution calculator',
    text: 'See output dimensions and a CPU-benchmark-based time estimate before you start a job.',
  },
  {
    icon: ShieldCheck, title: 'Privacy-first files',
    text: 'Uploads live in private job folders and are deleted automatically after 24 hours. Nothing is posted to a public gallery.',
  },
  {
    icon: UserX, title: 'No account needed',
    text: 'v1 works without sign-in. Accounts, credits, and billing arrive in Stage 2 — nothing here pretends to bill you.',
  },
  {
    icon: UploadCloud, title: 'Batch + ZIP download',
    text: 'Upload up to 10 images at once, track each job, and download all completed results as one ZIP.',
  },
];

const FAQS = [
  {
    q: 'How long does enhancement take?',
    a: 'Processing runs on CPU, one job at a time. A 256px image at 4x takes roughly 40 seconds; a 512px image takes about 2 minutes. Larger images are processed in tiles and take longer. The studio shows an estimate before you start.',
  },
  {
    q: 'Does upscaling recover the true original detail?',
    a: 'No. The AI generates plausible detail based on patterns it learned; it cannot guarantee that the generated detail matches what was in the original scene. Treat results as enhanced, not restored ground truth.',
  },
  {
    q: 'Which scales are available?',
    a: '2x and 4x. 2x is derived from the native 4x model output (downsampled). 6x and above are disabled until staged upscaling is benchmarked on CPU.',
  },
  {
    q: 'What happens to my images?',
    a: 'They are stored in a private job folder on the server and deleted automatically after 24 hours. They are never published or shared.',
  },
  {
    q: 'Do I need an account or payment?',
    a: 'No. v1 has no accounts, credits, or payments. Those arrive in Stage 2, along with an admin dashboard.',
  },
  {
    q: 'Which formats and sizes are supported?',
    a: 'PNG, JPEG, and WebP, up to 10MB, with the longest side up to 1024px. Files are checked by content signature, not just extension.',
  },
];

function FaqItem({ q, a }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03]">
      <button type="button" onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left">
        <span className="font-semibold text-white">{q}</span>
        <ChevronDown size={18} className={`shrink-0 text-slate-400 transition ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && <p className="px-5 pb-4 text-sm leading-relaxed text-slate-400">{a}</p>}
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const goStudio = (files) => {
    if (files && files[0]) setPendingFile(files[0]);
    navigate('/studio');
  };

  return (
    <div>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="hero-glow pointer-events-none absolute -top-40 left-1/2 h-[480px] w-[820px] -translate-x-1/2 rounded-full bg-[#2563eb]/25 blur-[120px]" />
        <div className="hero-glow pointer-events-none absolute -right-40 top-40 h-[320px] w-[320px] rounded-full bg-[#8b5cf6]/20 blur-[100px]" />
        <div className="relative mx-auto max-w-7xl px-4 pb-16 pt-14 sm:px-6 sm:pt-20">
          <div className="grid items-center gap-10 lg:grid-cols-2">
            <div>
              <span className="inline-flex items-center gap-2 rounded-full border border-[#42d9f5]/30 bg-[#42d9f5]/10 px-3 py-1 text-xs font-semibold text-[#42d9f5]">
                AI Powered · Real-ESRGAN x4plus
              </span>
              <h1 className="font-display mt-5 text-4xl font-extrabold leading-[1.05] text-white sm:text-6xl">
                Every Pixel.<br />Perfected by AI.
              </h1>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-slate-400">
                Transform low-resolution images into sharper, clearer, high-resolution visuals
                with AI-powered enhancement.
              </p>
              <div className="mt-6 flex flex-wrap gap-3">
                <Link to="/studio"
                  className="inline-flex items-center gap-2 rounded-full bg-[#2563eb] px-6 py-3 font-semibold text-white shadow-lg shadow-[#2563eb]/30 hover:bg-[#1d4ed8]">
                  Upscale Image <ArrowRight size={18} />
                </Link>
                <a href="#examples"
                  className="inline-flex items-center gap-2 rounded-full border border-white/20 px-6 py-3 font-semibold text-white hover:bg-white/10">
                  Explore Examples
                </a>
              </div>
              <p className="mt-4 text-xs text-slate-500">
                No account needed in v1 · 2x and 4x · PNG, JPEG, WebP · files deleted after 24 hours
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-white/[0.03] p-4 shadow-2xl backdrop-blur">
              <UploadZone onFiles={goStudio} />
              <p className="mt-3 text-center text-xs text-slate-500">
                Drop an image here and you land in the studio with it staged.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Examples: real model output, honestly labelled */}
      <section id="examples" className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">Before / After, for real</h2>
        <p className="mt-2 max-w-2xl text-slate-400">
          This sample was processed by the same Real-ESRGAN x4plus model the studio runs —
          an illustrative 256px image enhanced to 1024px. Drag the handle to compare.
        </p>
        <div className="mt-6 max-w-3xl">
          <CompareSlider
            originalUrl="/examples/sample256.png"
            enhancedUrl="/examples/sample1024.png"
            alt="Sample landscape"
          />
        </div>
      </section>

      {/* Features */}
      <section id="features" className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">Built around the result, not the decoration</h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <div key={f.title} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#2563eb]/20 text-[#42d9f5]">
                <f.icon size={22} />
              </span>
              <h3 className="font-display mt-3 font-bold text-white">{f.title}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{f.text}</p>
            </div>
          ))}
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">How it works</h2>
        <ol className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ['1', 'Upload', 'Drag, browse, or paste an image. It is validated by content signature, dimensions, and size.'],
            ['2', 'AI processes', 'The Real-ESRGAN model enhances it on CPU, in tiles for larger images. One job runs at a time.'],
            ['3', 'Compare & download', 'Check the result on the slider, then download the high-resolution PNG. Files expire after 24 hours.'],
          ].map(([n, t, d]) => (
            <li key={n} className="rounded-3xl border border-white/10 bg-white/[0.03] p-5">
              <span className="font-display text-3xl font-extrabold text-[#42d9f5]">{n}</span>
              <h3 className="font-display mt-2 font-bold text-white">{t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-slate-400">{d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Pricing teaser: explicitly example plans */}
      <section id="pricing" className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">Pricing</h2>
        <p className="mt-2 max-w-2xl text-slate-400">
          The plans below are examples only — pricing is not final and no payment is taken in v1.
          Everything in the studio is available without an account today.
        </p>
        <div className="mt-6 grid gap-4 md:grid-cols-3">
          {[
            ['Free', 'Example', ['2x and 4x enhancement', 'Standard queue', '24-hour file retention'], false],
            ['Pro', 'Example', ['Everything in Free', 'Batch processing + ZIP', 'Priority queue', 'Extended history'], true],
            ['Premium', 'Example', ['Everything in Pro', 'Highest usage limits', 'Advanced presets', 'Longest retention'], false],
          ].map(([name, badge, feats, highlight]) => (
            <div key={name}
              className={`rounded-3xl border p-6 ${highlight ? 'border-[#2563eb]/60 bg-[#2563eb]/10' : 'border-white/10 bg-white/[0.03]'}`}>
              <div className="flex items-center justify-between">
                <h3 className="font-display text-xl font-extrabold text-white">{name}</h3>
                <span className="rounded-full bg-white/10 px-2.5 py-0.5 text-xs font-semibold text-slate-300">{badge}</span>
              </div>
              <ul className="mt-4 space-y-2">
                {feats.map((f) => (
                  <li key={f} className="flex items-start gap-2 text-sm text-slate-300">
                    <Check size={16} className="mt-0.5 shrink-0 text-emerald-400" /> {f}
                  </li>
                ))}
                <li className="flex items-start gap-2 text-sm text-slate-500">
                  <X size={16} className="mt-0.5 shrink-0" /> Payments — arrives in Stage 2
                </li>
              </ul>
              <Link to="/studio"
                className="mt-5 block rounded-full bg-[#2563eb] py-2.5 text-center text-sm font-semibold text-white hover:bg-[#1d4ed8]">
                Start in the studio
              </Link>
            </div>
          ))}
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h2 className="font-display text-2xl font-extrabold text-white sm:text-3xl">Questions, answered honestly</h2>
        <div className="mt-6 space-y-3">
          {FAQS.map((f) => <FaqItem key={f.q} q={f.q} a={f.a} />)}
        </div>
      </section>
    </div>
  );
}
