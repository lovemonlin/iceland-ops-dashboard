/**
 * Stable IMO warning fields taken from the CAP broker's active/detailed payload.
 *
 * Field names follow the live 2026-04-14 API (observed 2026-09-21): official colour lives in
 * `parameter.Color`, not in a Dashboard mapping from severity. Optional CAP fields that the
 * current feed omits (`effective`, `instruction_*`, `circle`, `status`) stay optional.
 */
export interface NormalizedImoGeocode {
  en?: Record<string, string[]>;
  is?: Record<string, string[]>;
}

export interface NormalizedImoWarning {
  identifier: string;
  /** Official IMO colour from `parameter.Color`, e.g. "Yellow". Never inferred from severity. */
  warningColor?: string;
  severity?: string;
  certainty?: string;
  urgency?: string;
  status?: string;
  messageType?: string;
  eventIs?: string;
  eventEn?: string;
  areaId?: number | string;
  forecastAreaId?: number | string;
  areaNameIs?: string;
  areaNameEn?: string;
  sent?: string;
  effective?: string;
  onset?: string;
  expires?: string;
  headlineIs?: string;
  headlineEn?: string;
  descriptionIs?: string;
  descriptionEn?: string;
  instructionIs?: string;
  instructionEn?: string;
  polygon?: string[];
  circle?: string[];
  geocode?: NormalizedImoGeocode;
  web?: string;
}

const text = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const idValue = (value: unknown): number | string | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  return text(value);
};

const stringList = (value: unknown): string[] | undefined => {
  if (typeof value === "string") {
    const item = text(value);
    return item ? [item] : undefined;
  }
  if (!Array.isArray(value)) return undefined;
  const items = value.map((entry) => text(entry)).filter((entry): entry is string => entry !== undefined);
  return items.length > 0 ? items : undefined;
};

const geocodeMap = (value: unknown): Record<string, string[]> | undefined => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const mapped: Record<string, string[]> = {};
  for (const [key, entry] of Object.entries(value)) {
    const list = stringList(entry);
    if (list) mapped[key] = list;
  }
  return Object.keys(mapped).length > 0 ? mapped : undefined;
};

const firstNamed = (map: Record<string, string[]> | undefined, names: string[]) => {
  if (!map) return undefined;
  for (const name of names) {
    const value = map[name]?.[0];
    if (value) return value;
  }
  return Object.values(map)[0]?.[0];
};

const parameterValue = (parameter: unknown, key: string) => {
  if (!parameter || typeof parameter !== "object" || Array.isArray(parameter)) return undefined;
  return stringList((parameter as Record<string, unknown>)[key])?.[0];
};

/**
 * Turns one already-validated CAP warning object into the snapshot shape.
 *
 * Unknown optional fields are skipped. Identifier is required by the parser before this runs.
 */
export function normalizeImoWarning(raw: Record<string, unknown>): NormalizedImoWarning {
  const identifier = text(raw.identifier);
  if (!identifier) {
    throw new Error("normalizeImoWarning requires an identifier");
  }

  const geocodeEn = geocodeMap(raw.geocode_en);
  const geocodeIs = geocodeMap(raw.geocode_is);
  const geocode =
    geocodeEn || geocodeIs ? { ...(geocodeEn ? { en: geocodeEn } : {}), ...(geocodeIs ? { is: geocodeIs } : {}) } : undefined;

  const warning: NormalizedImoWarning = { identifier };
  const warningColor = parameterValue(raw.parameter, "Color");
  const severity = text(raw.severity);
  const certainty = text(raw.certainty);
  const urgency = text(raw.urgency);
  const status = text(raw.status);
  const messageType = text(raw.msgtype);
  const eventIs = text(raw.event_is);
  const eventEn = text(raw.event_en);
  const areaId = idValue(raw.area_id);
  const forecastAreaId = idValue(raw.forecast_area_id);
  const areaNameIs = firstNamed(geocodeIs, ["Spásvæði"]) ?? text(raw.area_is) ?? text(raw.area);
  const areaNameEn = firstNamed(geocodeEn, ["Forecast Region"]) ?? text(raw.area_en) ?? text(raw.area);
  const sent = text(raw.sent);
  const effective = text(raw.effective);
  const onset = text(raw.onset);
  const expires = text(raw.expires);
  const headlineIs = text(raw.headline_is);
  const headlineEn = text(raw.headline_en);
  const descriptionIs = text(raw.description_is);
  const descriptionEn = text(raw.description_en);
  const instructionIs = text(raw.instruction_is) ?? text(raw.instruction);
  const instructionEn = text(raw.instruction_en) ?? text(raw.instruction);
  const polygon = stringList(raw.polygon);
  const circle = stringList(raw.circle);
  const web = text(raw.web) ?? text(raw.url);

  if (warningColor) warning.warningColor = warningColor;
  if (severity) warning.severity = severity;
  if (certainty) warning.certainty = certainty;
  if (urgency) warning.urgency = urgency;
  if (status) warning.status = status;
  if (messageType) warning.messageType = messageType;
  if (eventIs) warning.eventIs = eventIs;
  if (eventEn) warning.eventEn = eventEn;
  if (areaId !== undefined) warning.areaId = areaId;
  if (forecastAreaId !== undefined) warning.forecastAreaId = forecastAreaId;
  if (areaNameIs) warning.areaNameIs = areaNameIs;
  if (areaNameEn) warning.areaNameEn = areaNameEn;
  if (sent) warning.sent = sent;
  if (effective) warning.effective = effective;
  if (onset) warning.onset = onset;
  if (expires) warning.expires = expires;
  if (headlineIs) warning.headlineIs = headlineIs;
  if (headlineEn) warning.headlineEn = headlineEn;
  if (descriptionIs) warning.descriptionIs = descriptionIs;
  if (descriptionEn) warning.descriptionEn = descriptionEn;
  if (instructionIs) warning.instructionIs = instructionIs;
  if (instructionEn) warning.instructionEn = instructionEn;
  if (polygon) warning.polygon = polygon;
  if (circle) warning.circle = circle;
  if (geocode) warning.geocode = geocode;
  if (web) warning.web = web;
  return warning;
}

export function normalizeImoWarnings(raw: Record<string, unknown>[]): NormalizedImoWarning[] {
  return raw.map((entry) => normalizeImoWarning(entry));
}
