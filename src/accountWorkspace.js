import { makeSampleData } from "./sampleData.js";
import { STORAGE_KEY } from "./storage.js";

export const accountWorkspaceKey = (id) => `${STORAGE_KEY}:account:${id}`;

export function accountActor(profile) {
  if (!profile?.id || !profile.is_active || !["admin", "marker"].includes(profile.role)) {
    throw new Error("An active account profile is required.");
  }
  const name = profile.display_name.trim() || "Marker";
  return {
    key: profile.id,
    name,
    initials: name.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase(),
    admin: profile.role === "admin",
  };
}

export function withAccount(state, profile) {
  const actor = accountActor(profile);
  return {
    ...state,
    // Keep fictional authors for attribution; never claim their existing marks.
    users: [...state.users.filter((user) => user.key !== actor.key), actor],
    // These are practice tests only. Real participants will come from the DB.
    tests: state.tests.map((test) => ({
      ...test,
      participants: [...new Set([...test.participants, actor.key])],
    })),
  };
}

export const createAccountSample = (profile) => withAccount(makeSampleData(), profile);

export function readAccountWorkspace(profile, storage) {
  try {
    storage ??= globalThis.localStorage;
    const raw = storage.getItem(accountWorkspaceKey(profile.id));
    if (!raw) return { data: createAccountSample(profile), error: "" };
    const data = JSON.parse(raw);
    if (data.schemaVersion !== 1 ||
        !["students", "scores", "users", "tests", "history"].every((key) => Array.isArray(data[key])) ||
        !data.submissions || typeof data.submissions !== "object") {
      throw new Error("Unsupported saved workspace");
    }
    return { data: withAccount(data, profile), error: "" };
  } catch {
    return {
      data: createAccountSample(profile),
      error: "Saved practice data could not be read. Reset sample data before saving changes.",
    };
  }
}

export async function fetchAccountProfile(client, userId, signal) {
  const { data, error } = await client.from("profiles")
    .select("id, display_name, role, is_active")
    .eq("id", userId)
    .abortSignal(signal)
    .maybeSingle();
  if (error) throw new Error(`Could not load your account: ${error.message}`);
  if (!data || data.id !== userId) throw new Error("No account profile was found. Ask an admin to check your account.");
  if (!data.is_active) throw new Error("Your account is disabled. Contact an admin.");
  if (!["admin", "marker"].includes(data.role)) throw new Error("Your account role is not recognised. Contact an admin.");
  return data;
}
