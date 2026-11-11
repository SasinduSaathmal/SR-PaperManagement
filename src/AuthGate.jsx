import React, { useEffect, useState } from "react";
import PasswordAccess from "./PasswordAccess.jsx";
import { supabase } from "./lib/supabaseClient.js";
import ThemeToggle from "./ThemeToggle.jsx";
import { loadSharedDrafts } from "./sharedMarksApi.js";
import { fetchAccountProfile } from "./accountWorkspace.js";

export default function AuthGate({ children }) {
  return <PasswordAccess>{({ onPassword, onReset, notice }) =>
    <AccountGate onPassword={onPassword} onReset={onReset} notice={notice}>{children}</AccountGate>
  }</PasswordAccess>;
}

function AccountGate({ children, onPassword, onReset, notice }) {
  const [session, setSession] = useState(undefined);
  const [account, setAccount] = useState(null);
  const [retry, setRetry] = useState(0);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    // Keep this callback synchronous. The separate effect loads the profile.
    const { data } = supabase.auth.onAuthStateChange((event, currentSession) => {
      setSession(currentSession);
      if (!currentSession) setAccount(null);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  const accessToken = session?.access_token;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetchAccountProfile(supabase, userId, controller.signal)
      .then((profile) => {
        if (!cancelled) setAccount({ userId, profile, error: "" });
      })
      .catch((failure) => {
        if (!cancelled) setAccount({
          userId,
          profile: null,
          error: controller.signal.aborted
            ? "Loading your account timed out. Check your connection and retry."
            : failure.message,
        });
      })
      .finally(() => clearTimeout(timeout));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
      controller.abort();
    };
  }, [userId, accessToken, retry]);

  useEffect(() => {
    const refresh = () => setRetry((value) => value + 1);
    window.addEventListener("focus", refresh);
    window.addEventListener("physics:profile-changed", refresh);
    return () => {window.removeEventListener("focus", refresh);window.removeEventListener("physics:profile-changed", refresh);};
  }, []);

  async function handleLogin(event) {
    event.preventDefault();
    setError("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      if (error) throw error;
      setPassword("");
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleLogout() {
    const pending = userId ? loadSharedDrafts(userId) : { drafts: {} };
    if ((pending.error || Object.keys(pending.drafts).length) && !window.confirm(
      "Some marks have unsynced local drafts. They stay on this device for this account. Sign out anyway?",
    )) return;
    setError("");
    setBusy(true);
    try {
      const { error } = await supabase.auth.signOut({ scope: "local" });
      if (error) throw error;
    } catch (failure) {
      setError(failure.message);
    } finally {
      setBusy(false);
    }
  }

  if (session === undefined) return <div className="auth-page"><section className="auth-card"><div className="auth-theme-control"><ThemeToggle /></div><p>Checking your session...</p></section></div>;

  if (session) {
    const current = account?.userId === userId ? account : null;
    if (!current?.profile) return (
      <div className="auth-page">
        <section className="auth-card" aria-busy={!current}>
          <div className="auth-theme-control"><ThemeToggle /></div>
          <h1>Physics</h1>
          <p>Samitha Rathnayake</p>
          <h2>{current?.error ? "Account unavailable" : "Loading your account..."}</h2>
          {current?.error && <p className="field-error" role="alert">{current.error}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
          <button className="text-button" disabled={busy} onClick={onPassword}>Set/change password</button>
          {current?.error && (
            <button className="primary-button" onClick={() => {
              setAccount(null);
              setRetry((value) => value + 1);
            }}>Retry</button>
          )}
          <button className="text-button" onClick={handleLogout} disabled={busy}>Sign out</button>
        </section>
      </div>
    );
    return (
      <div key={userId}>
        <div className="auth-session-bar">
          <span>Signed in as {session.user.email}</span>
          <div className="auth-account-actions">
            <ThemeToggle />
            <button onClick={onPassword} disabled={busy}>Set/change password</button>
            <button onClick={handleLogout} disabled={busy}>{busy ? "Signing out..." : "Sign out"}</button>
          </div>
          {error && <p role="alert">{error}</p>}
          {notice && <p role="status">{notice}</p>}
        </div>
        {React.cloneElement(React.Children.only(children), { profile: current.profile })}
      </div>
    );
  }

  return (
    <div className="auth-page">
      <form className="auth-card" onSubmit={handleLogin}>
        <div className="auth-theme-control"><ThemeToggle /></div>
        <h1>Physics</h1>
        <p>Samitha Rathnayake</p>
        <h2>Sign in</h2>
        <label>Email
          <input type="email" autoComplete="username" value={email}
            onChange={(event) => setEmail(event.target.value)} required />
        </label>
        <label>Password
          <input type="password" autoComplete="current-password" value={password}
            onChange={(event) => setPassword(event.target.value)} required />
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button className="primary-button" type="submit" disabled={busy}>
          {busy ? "Signing in..." : "Sign in"}
        </button>
        <button className="text-button" type="button" disabled={busy} onClick={() => onReset(email)}>Set or reset password</button>
      </form>
    </div>
  );
}

