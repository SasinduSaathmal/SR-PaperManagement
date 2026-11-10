// Persist flow labels only. Never store invitation tokens or passwords here.
export function readAuthLanding(href) {
  try {
    const url = new URL(href), hash = new URLSearchParams(url.hash.slice(1));
    const get = name => hash.get(name) || url.searchParams.get(name);
    if (get("error") || get("error_code") || get("error_description"))
      return { mode: null, error: "This sign-in link is invalid, expired, or already used. Request a new password link below." };
    const type = get("type"), intent = url.searchParams.get("auth");
    return { mode: type === "invite" || intent === "setup" ? "invite"
      : type === "recovery" || intent === "recovery" ? "recovery" : null, error: "" };
  } catch { return { mode: null, error: "" }; }
}
export function passwordError(password, confirmation) {
  if (password.length < 8) return "Use at least 8 characters. Your project's password policy may require more.";
  if (password !== confirmation) return "The passwords do not match.";
  return "";
}
export const passwordSetupKey = id => `physics-auth-password-setup:${id}`;
export function passwordRedirect(href) {
  const url = new URL(href);
  return `${url.origin}${url.pathname}?auth=recovery`;
}
export function clearAuthLanding(browser = globalThis.window) {
  const url = new URL(browser.location.href);
  for (const key of ["auth", "code", "token_hash", "type", "error", "error_code", "error_description"]) url.searchParams.delete(key);
  const hash = new URLSearchParams(url.hash.slice(1));
  if (["access_token", "refresh_token", "error", "error_code", "type"].some(key => hash.has(key))) url.hash = "";
  browser.history.replaceState(browser.history.state, "", url.pathname + url.search + url.hash);
}
