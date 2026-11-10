import { makeSampleData } from "./sampleData.js";

export const STORAGE_KEY = "samitha-physics-stage1-v1";

export function readWorkspace() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return { data: makeSampleData(), error: "" };
    const data = JSON.parse(stored);
    if (
      data.schemaVersion !== 1 ||
      !["students", "scores", "users", "tests", "history"].every((key) =>
        Array.isArray(data[key]),
      ) ||
      !data.submissions
    )
      throw new Error("Unsupported saved workspace");
    return { data, error: "" };
  } catch {
    return {
      data: makeSampleData(),
      error:
        "Saved browser data could not be read. Sample data is shown; it will not overwrite your saved workspace unless you choose Reset demo.",
    };
  }
}

export function writeWorkspace(data) {
  // The caller catches storage failures and never reports a failed write as saved.
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}
