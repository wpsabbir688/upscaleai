import { Link, Route, Routes, useNavigate } from 'react-router-dom';
import { Coins, Zap } from 'lucide-react';
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
  const doLogout = async () => {
    await logout();
    navigate('/');
  };
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-[#0b1020]/85 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
        <Link to="/" className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#2563eb] text-white">
            <Zap size={20} />
          </span>
          <span className="font-display text-lg font-extrabold text-white">UpscaleAI</span>
          <span className="hidden text-xs text-slate-500 sm:block">Enhance Beyond Limits</span>
        </Link>
        <nav className="flex items-center gap-1 text-sm sm:gap-3">
          <Link to="/studio" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">AI Upscaler</Link>
          <a href="/#features" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white sm:block">Features</a>
          <a href="/#pricing" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white sm:block">Pricing</a>
          <a href="/#faq" className="hidden rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white sm:block">FAQ</a>
          {user ? (
            <>
              <Link to="/payment" className="rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white">Add credits</Link>
              <Link to="/profile" className="hidden items-center gap-1 rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white sm:inline-flex">
                <Coins size={14} /> {user.credits} credits
              </Link>
              <Link to="/profile" className="hidden max-w-[140px] truncate rounded-full px-3 py-1.5 text-slate-300 hover:bg-white/10 hover:text-white md:block">{user.email}</Link>
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
          <Link to="/studio" className="rounded-full bg-[#2563eb] px-4 py-2 font-semibold text-white hover:bg-[#1d4ed8]">
            Upscale Image
          </Link>
        </nav>
      </div>
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
      <div className="flex min-h-screen flex-col">
        <Nav />
        <main className="flex-1">
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/studio" element={<Studio />} />
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
