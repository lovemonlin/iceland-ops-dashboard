import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Where the Android app checkout lives for parity tests.
 *
 * Local development uses the sibling `../iceland-aurora`. CI can point here with ANDROID_REPO
 * after a read-only checkout. Missing files skip the comparison rather than inventing a copy.
 */
export function androidRepoRoot() {
  const fromEnv = process.env.ANDROID_REPO?.trim();
  return fromEnv ? resolve(fromEnv) : resolve(process.cwd(), "..", "iceland-aurora");
}

export function androidPath(...parts: string[]) {
  return resolve(androidRepoRoot(), ...parts);
}

export function hasAndroidFile(...parts: string[]) {
  return existsSync(androidPath(...parts));
}
