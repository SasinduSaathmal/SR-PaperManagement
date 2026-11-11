import BrandMark from "./BrandMark.jsx";
import React, { useEffect, useRef, useState } from "react";
import { readAuthLanding, passwordError, passwordSetupKey, passwordRedirect, clearAuthLanding } from "./authRecovery.js";
import { supabase } from "./lib/supabaseClient.js";
import ThemeToggle from "./ThemeToggle.jsx";
import { loadSharedDrafts } from "./sharedMarksApi.js";

// Query hints survive SDK token consumption. The explicit password button
// handles invite sessions whose URL fragment has already been consumed.
const landing = typeof window === "undefined" ? { mode: null, error: "" } : readAuthLanding(window.location.href);
export default function PasswordAccess({ children }) {
  const [session, setSession] = useState(undefined), sessionRef = useRef(undefined);
  const [mode, setMode] = useState(landing.mode), [linkError, setLinkError] = useState(landing.error);
  const [showReset, setShowReset] = useState(false), [email, setEmail] = useState("");
  const [password, setPassword] = useState(""), [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false), [error, setError] = useState(""), [notice, setNotice] = useState("");
  useEffect(() => {
    let cancelled = false, seen = false;
    function accept(event, current) {
      if (cancelled) return;
      seen = true;
      const previous = sessionRef.current?.user.id;
      sessionRef.current = current; setSession(current);
      if (previous && previous !== current?.user.id) { setMode(null); setPassword(""); setConfirmation(""); setNotice(""); }
      if (event === "PASSWORD_RECOVERY" && current) { setMode("recovery"); setLinkError(""); setShowReset(false); setError(""); }
    }
    // Keep callbacks synchronous: awaiting another Auth call can deadlock it.
    const { data } = supabase.auth.onAuthStateChange(accept);
    supabase.auth.getSession().then(({ data, error }) => {
      if (cancelled || seen) return;
      if (error) setLinkError("Your sign-in link could not be verified. Request a new password link.");
      accept("INITIAL_SESSION", data?.session || null);
    }).catch(() => { if (!cancelled && !seen) { setSession(null); setLinkError("Could not verify your session. Refresh or request a new password link."); } });
    const timer = setTimeout(() => { if (!cancelled && !seen) { setSession(null); setLinkError("Session checking timed out. Refresh or request a new password link."); } }, 15000);
    return () => { cancelled = true; clearTimeout(timer); data.subscription.unsubscribe(); };
  }, []);
  const userId = session?.user.id;
  useEffect(() => {
    setPassword(""); setConfirmation("");
    if (!userId || linkError) return;
    try { const saved = sessionStorage.getItem(passwordSetupKey(userId)); if (["invite", "recovery"].includes(saved)) setMode(saved); } catch { /* Optional UI recovery. */ }
  }, [userId]);
  useEffect(() => {
    if (userId && !linkError && ["invite", "recovery"].includes(mode)) {
      try { sessionStorage.setItem(passwordSetupKey(userId), mode); } catch { /* Form still works. */ }
    }
  }, [userId, mode, linkError]);
  function leave() {
    if (userId) { try { sessionStorage.removeItem(passwordSetupKey(userId)); } catch { /* Optional UI recovery. */ } }
    clearAuthLanding(); setMode(null); setShowReset(false); setLinkError(""); setError(""); setNotice(""); setPassword(""); setConfirmation("");
  }
  async function logout() {
    const pending = userId ? loadSharedDrafts(userId) : { drafts: {} };
    if ((pending.error || Object.keys(pending.drafts).length) && !window.confirm("Some marks have unsynced local drafts. They stay on this device for this account. Sign out anyway?")) return;
    setBusy(true); setError("");
    try { const { error } = await supabase.auth.signOut({ scope: "local" }); if (error) throw error; }
    catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function sendLink(event) {
    event.preventDefault(); setError(""); setNotice(""); setBusy(true);
    try {
      const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), { redirectTo: passwordRedirect(window.location.href) });
      if (error) throw error;
      setNotice("If this email belongs to an account, a password link has been sent. Open the newest email in this browser.");
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  async function save(event) {
    event.preventDefault(); setError(""); setNotice("");
    const invalid = passwordError(password, confirmation); if (invalid) { setError(invalid); return; }
    const expected = userId; setBusy(true);
    try {
      // URL hints never authenticate a user. Verify the current identity first.
      const { data: identity, error: identityError } = await supabase.auth.getUser();
      if (identityError || !identity?.user) throw new Error("Your session expired. Request a fresh password link.");
      if (identity.user.id !== expected || sessionRef.current?.user.id !== expected) throw new Error("The signed-in account changed. Check the email shown and open a fresh password link.");
      const { data, error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      if (data?.user?.id !== expected) throw new Error("Could not confirm the password update. Sign in again to check your account.");
      leave(); setNotice("Password saved. You can now sign in using your email and password.");
    } catch (failure) { setError(failure.message); } finally { setBusy(false); }
  }
  const brand = <><div className="auth-theme-control"><ThemeToggle/></div><BrandMark className="auth-brand-mark"/><h1>Physics</h1><p>Samitha Rathnayake</p></>;
  const feedback = <>{error && <p className="field-error" role="alert">{error}</p>}{notice && <p className="field-help" role="status">{notice}</p>}</>;
  if (session === undefined) return <div className="auth-page"><section className="auth-card">{brand}<p>Checking your session...</p></section></div>;
  if (linkError || showReset || (!session && mode)) return <div className="auth-page"><form className="auth-card" onSubmit={sendLink}>
    {brand}<h2>{linkError ? "This link cannot be used" : "Set or reset your password"}</h2>
    {linkError && <p className="field-error" role="alert">{linkError}</p>}
    {session ? <p>Currently signed in as {session.user.email}. The new email link will verify the account you enter below.</p> : <p>Enter your account email to receive a fresh password link.</p>}
    <label>Email<input type="email" required autoComplete="username" value={email} disabled={busy} onChange={event => setEmail(event.target.value)}/></label>
    {feedback}<button className="primary-button" disabled={busy}>{busy ? "Sending…" : "Send password link"}</button>
    <button type="button" className="text-button" disabled={busy} onClick={leave}>{session ? "Continue with signed-in account" : "Back to sign in"}</button>
  </form></div>;
  if (session && mode) return <div className="auth-page"><form className="auth-card" onSubmit={save}>
    {brand}<h2>{mode === "change" ? "Set or change password" : "Set your password"}</h2><p>Password for <strong>{session.user.email}</strong></p>
    <label>New password<input type="password" required minLength={8} autoComplete="new-password" disabled={busy} value={password} onChange={event => setPassword(event.target.value)}/></label>
    <label>Confirm password<input type="password" required minLength={8} autoComplete="new-password" disabled={busy} value={confirmation} onChange={event => setConfirmation(event.target.value)}/></label>
    <p className="field-help">Use at least 8 characters. Your Supabase project's stronger password requirements also apply.</p>
    {feedback}<button className="primary-button" disabled={busy}>{busy ? "Saving…" : "Save password"}</button>
    <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 4, marginTop: 12 }}>
      {mode === "change" && <button type="button" className="text-button" style={{ minHeight: 44, fontSize: 12 }} disabled={busy} onClick={leave}>Cancel</button>}
      <button type="button" className="text-button" style={{ minHeight: 44, fontSize: 12 }} disabled={busy} onClick={() => { setShowReset(true); setEmail(session.user.email || ""); setError(""); setNotice(""); }}>Request a fresh password link</button>
      <button type="button" className="text-button" style={{ minHeight: 44, fontSize: 12 }} disabled={busy} onClick={logout}>Sign out</button>
    </div>
  </form></div>;
  return children({ notice, onPassword: () => { setMode("change"); setPassword(""); setConfirmation(""); setNotice(""); },
    onReset: value => { setShowReset(true); setEmail(value || ""); setError(""); setNotice(""); } });
}

