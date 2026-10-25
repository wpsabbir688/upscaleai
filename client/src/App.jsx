import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { Coins, Zap, Menu, X } from 'lucide-react';
import { Component, useState } from 'react';

// Safety net only: the root causes (bad payloads, corrupt auth state) are
// fixed in api.js/Studio.jsx. If a route still throws during render, the
// whole app must not go blank — show this fallback instead.
class RouteErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="mx-auto max-w-3xl px-4 py-20 text-center">
          <h1 className="font-display text-3xl font-extrabold text-white">Something went wrong</h1>
          <p className="mt-2 text-slate-400">
            The page hit an unexpected error. Reloading usually fixes it.
          </p>
          <div className="mt-6 flex justify-center gap-3">
            <button type="button" onClick={() => window.location.reload()}
              className="inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-5 py-2.5 text-sm font-semibold text-white hover:bg-[#1d4ed8]">
              Reload page
            </button>
            <Link to="/" className="inline-flex min-h-11 items-center rounded-full border border-white/15 px-5 py-2.5 text-sm font-semibold text-slate-200 hover:bg-white/10">
              Go home
            </Link>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
import { AuthProvider, useAuth } from './lib/AuthContext.jsx';
import Home from './pages/Home.jsx';
import Studio from './pages/Studio.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import Profile from './pages/Profile.jsx';
import Admin from './pages/Admin.jsx';
import Payment from './pages/Payment.jsx';

function Nav() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const doLogout = async () => {
    await logout();
    setOpen(false);
    navigate('/');
  };
  // Mobile link: full-width rows, 44px+ tall, menu closes on navigation.
  const mlink = 'flex min-h-11 items-center rounded-xl px-3 text-slate-200 hover:bg-white/10 hover:text-white';
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1020]/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex min-w-0 items-center gap-2" onClick={() => setOpen(false)}>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#2563eb] text-white">
            <Zap size={20} />
          </span>
          <span className="font-display truncate text-lg font-extrabold text-white">UpscaleAI</span>
          <span className="hidden shrink-0 text-xs text-slate-500 sm:block">Enhance Beyond Limits</span>
        </Link>
        {/* Desktop nav: hidden below lg, where the hamburger takes over.
            At md (768px) the full link row wrapped onto two lines and cut
            the logo, so the hamburger breakpoint moved up to lg. */}
        <nav className="hidden items-center gap-1 text-sm sm:gap-3 lg:flex">
          <Link to="/studio" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">AI Upscaler</Link>
          <a href="/#features" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Features</a>
          <a href="/#pricing" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Pricing</a>
          <a href="/#faq" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">FAQ</a>
          {user ? (
            <>
              <Link to="/payment" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Add credits</Link>
              <Link to="/profile" className="inline-flex items-center gap-1 rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">
                <Coins size={14} /> {user.credits} credits
              </Link>
              <Link to="/profile" className="hidden max-w-[140px] truncate rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white lg:block">{user.email}</Link>
              {user.role === 'admin' && (
                <Link to="/admin" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Admin</Link>
              )}
              <button type="button" onClick={doLogout}
                className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Sign in</Link>
              <Link to="/register" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Register</Link>
            </>
          )}
          <Link to="/studio" className="inline-flex min-h-11 items-center rounded-full bg-[#2563eb] px-4 py-2 font-semibold text-white hover:bg-[#1d4ed8]">
            Upscale Image
          </Link>
        </nav>
        {/* Mobile: hamburger only (plus the primary CTA, which fits alone). */}
        <div className="flex shrink-0 items-center gap-2 lg:hidden">
          <Link to="/studio" onClick={() => setOpen(false)}
            className="hidden min-h-11 items-center rounded-full bg-[#2563eb] px-4 py-2 text-sm font-semibold text-white hover:bg-[#1d4ed8] min-[380px]:inline-flex">
            Upscale Image
          </Link>
          <button type="button" data-testid="mobile-menu-button" aria-label={open ? 'Close menu' : 'Open menu'}
            aria-expanded={open} onClick={() => setOpen((o) => !o)}
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/15 text-white hover:bg-white/10">
            {open ? <X size={22} /> : <Menu size={22} />}
          </button>
        </div>
      </div>
      {open && (
        <nav data-testid="mobile-menu" className="border-t border-white/10 px-4 py-2 text-sm lg:hidden">
          {user && (
            <p data-testid="mobile-menu-credits" className="flex min-h-11 items-center gap-1.5 px-3 font-semibold text-white">
              <Coins size={15} className="text-[#42d9f5]" /> {user.credits} credits
              <span className="ml-1 max-w-[180px] truncate font-normal text-slate-400">{user.email}</span>
            </p>
          )}
          <Link to="/studio" className={mlink} onClick={() => setOpen(false)}>AI Upscaler</Link>
          <a href="/#features" className={mlink} onClick={() => setOpen(false)}>Features</a>
          <a href="/#pricing" className={mlink} onClick={() => setOpen(false)}>Pricing</a>
          <a href="/#faq" className={mlink} onClick={() => setOpen(false)}>FAQ</a>
          {user ? (
            <>
              <Link to="/payment" className={mlink} onClick={() => setOpen(false)}>Add credits</Link>
              <Link to="/profile" className={mlink} onClick={() => setOpen(false)}>Profile</Link>
              {user.role === 'admin' && (
                <Link to="/admin" className={mlink} onClick={() => setOpen(false)}>Admin</Link>
              )}
              <button type="button" onClick={doLogout} className={`${mlink} w-full text-left`}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login" className={mlink} onClick={() => setOpen(false)}>Sign in</Link>
              <Link to="/register" className={mlink} onClick={() => setOpen(false)}>Register</Link>
            </>
          )}
        </nav>
      )}
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/10">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div>
            <p className="font-display font-extrabold text-white">UpscaleAI</p>
            <p className="mt-1 max-w-sm text-sm text-slate-500">
              AI image enhancement with the Real-ESRGAN x4plus model. AI-generated detail is
              approximate, not a guaranteed recovery of original detail.
            </p>
          </div>
          <nav className="flex gap-6 text-sm">
            <Link to="/studio" className="text-slate-400 hover:text-white">AI Upscaler</Link>
            <a href="/#features" className="text-slate-400 hover:text-white">Features</a>
            <a href="/#pricing" className="text-slate-400 hover:text-white">Pricing</a>
            <a href="/#faq" className="text-slate-400 hover:text-white">FAQ</a>
          </nav>
        </div>
        <p className="mt-6 text-xs text-slate-600">
          Accounts, server-side credits, and admin are live. Credits can be added with manual bKash/Nagad payments — an admin verifies each payment by hand; there is no automated gateway. Uploaded files are deleted automatically after 24 hours.
        </p>
      </div>
    </footer>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <div className="flex min-h-dvh flex-col">
        <Nav />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/studio" element={<RouteErrorBoundary><Studio /></RouteErrorBoundary>} />
            <Route path="/login" element={<Login />} />
            <Route path="/register" element={<Register />} />
            <Route path="/profile" element={<Profile />} />
            <Route path="/payment" element={<Payment />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="*" element={
              <div className="mx-auto max-w-7xl px-4 py-20 text-center">
                <h1 className="font-display text-3xl font-extrabold text-white">Page not found</h1>
                <Link to="/" className="mt-4 inline-block text-[#42d9f5] hover:underline">Go home</Link>
              </div>
            } />
          </Routes>
        </main>
        <Footer />
      </div>
    </AuthProvider>
  );
}
