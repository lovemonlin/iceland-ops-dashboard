import {
  ECMWF_EXPECTED_FRAME_COUNT,
  ECMWF_FORECAST_HORIZON_HOURS,
  ECMWF_FRAME_STEP_HOURS,
} from "@/config/ecmwf";
import type { MonitorErrorType } from "@/health/model";
import { isModelCycle } from "@/monitors/ecmwf/schedule";

const HOUR_MS = 3_600_000;

/**
 * Shape actually published by `iceland-aurora-cloud` (verified read-only against production):
 *
 * { model, run_at, generated_at, source_url, attribution,
 *   frames: [{ valid_at, image_url }, ...] }
 *
 * Only `model`, `run_at` and `frames` are treated as required; the rest are informational.
 */
export interface EcmwfFrame {
  validAt: Date;
  imageUrl: string;
}

export interface EcmwfManifest {
  model: string;
  runAt: Date;
  generatedAt?: Date;
  frames: EcmwfFrame[];
}

export type ManifestCheck =
  | { ok: true; manifest: EcmwfManifest }
  | { ok: false; errorType: MonitorErrorType; message: string };

function fail(errorType: MonitorErrorType, message: string): ManifestCheck {
  return { ok: false, errorType, message };
}

function parseTimestamp(value: unknown) {
  if (typeof value !== "string") return undefined;
  const ms = Date.parse(value);
  return Number.isNaN(ms) ? undefined : new Date(ms);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

/**
 * Validates a production manifest against the published contract.
 * `now` is injected so schedule-sensitive checks can be tested against a fixed clock.
 */
export function validateEcmwfManifest(raw: unknown, now: Date): ManifestCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return fail("SCHEMA_ERROR", "Manifest is not a JSON object.");
  }

  const value = raw as Record<string, unknown>;

  if (typeof value.model !== "string" || !value.model.trim()) {
    return fail("SCHEMA_ERROR", "Manifest is missing the model identification field.");
  }

  if (typeof value.run_at !== "string") {
    return fail("SCHEMA_ERROR", "Manifest is missing run_at.");
  }

  const runAt = parseTimestamp(value.run_at);
  if (!runAt) return fail("INVALID_TIMESTAMP", `run_at "${value.run_at}" is not a valid timestamp.`);

  if (!isModelCycle(runAt)) {
    return fail("INVALID_TIMESTAMP", `run_at ${runAt.toISOString()} is not a 00/06/12/18 UTC model cycle.`);
  }

  if (runAt.getTime() > now.getTime()) {
    return fail("INVALID_TIMESTAMP", `run_at ${runAt.toISOString()} is in the future.`);
  }

  let generatedAt: Date | undefined;
  if (value.generated_at !== undefined) {
    generatedAt = parseTimestamp(value.generated_at);
    if (!generatedAt) {
      return fail("INVALID_TIMESTAMP", `generated_at "${String(value.generated_at)}" is not a valid timestamp.`);
    }
  }

  if (!Array.isArray(value.frames)) return fail("SCHEMA_ERROR", "Manifest frames is not an array.");
  if (value.frames.length === 0) return fail("EMPTY_DATA", "Manifest contains zero frames.");

  const frames: EcmwfFrame[] = [];
  for (const [index, entry] of value.frames.entries()) {
    if (!entry || typeof entry !== "object") return fail("SCHEMA_ERROR", `Frame ${index} is not an object.`);
    const frame = entry as Record<string, unknown>;
    const validAt = parseTimestamp(frame.valid_at);
    if (!validAt) return fail("INVALID_TIMESTAMP", `Frame ${index} has an invalid valid_at.`);
    if (!isHttpUrl(frame.image_url)) return fail("SCHEMA_ERROR", `Frame ${index} has an invalid image_url.`);
    frames.push({ validAt, imageUrl: frame.image_url });
  }

  if (frames[0].validAt.getTime() !== runAt.getTime()) {
    return fail("SCHEMA_ERROR", "First frame does not start at the model run.");
  }

  for (let index = 1; index < frames.length; index += 1) {
    const gapHours = (frames[index].validAt.getTime() - frames[index - 1].validAt.getTime()) / HOUR_MS;
    if (gapHours !== ECMWF_FRAME_STEP_HOURS) {
      return fail(
        "SCHEMA_ERROR",
        `Frame ${index} is ${gapHours} h after the previous frame; expected ${ECMWF_FRAME_STEP_HOURS} h.`,
      );
    }
  }

  const coverageHours = (frames[frames.length - 1].validAt.getTime() - runAt.getTime()) / HOUR_MS;
  if (coverageHours !== ECMWF_FORECAST_HORIZON_HOURS) {
    return fail(
      "SCHEMA_ERROR",
      `Forecast covers run +${coverageHours} h; expected run +${ECMWF_FORECAST_HORIZON_HOURS} h.`,
    );
  }

  // 17 frames is the production contract, but it is checked last: a manifest that fails the
  // sequence or coverage checks above is broken even when it happens to carry 17 entries.
  if (frames.length !== ECMWF_EXPECTED_FRAME_COUNT) {
    return fail("SCHEMA_ERROR", `Manifest carries ${frames.length} frames; expected ${ECMWF_EXPECTED_FRAME_COUNT}.`);
  }

  return { ok: true, manifest: { model: value.model, runAt, generatedAt, frames } };
}
