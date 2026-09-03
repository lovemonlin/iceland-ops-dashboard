/**
 * Minimal reader for the `on.schedule` block of a workflow file.
 *
 * Deliberately not a YAML parser: the dashboard only needs the cron entries, and adding a YAML
 * dependency for four lines of a known file shape is not worth it. It walks the `schedule:` block
 * by indentation rather than scanning the whole file, so a `cron` word elsewhere cannot leak in.
 */
export function extractCronSchedules(source: string) {
  const lines = source.split(/\r?\n/);
  const scheduleIndex = lines.findIndex((line) => /^\s*schedule:\s*$/.test(line));
  if (scheduleIndex === -1) return [];

  const scheduleIndent = lines[scheduleIndex].search(/\S/);
  const crons: string[] = [];

  for (const line of lines.slice(scheduleIndex + 1)) {
    if (!line.trim()) continue;
    const indent = line.search(/\S/);
    // Dedenting back to or past `schedule:` ends the block.
    if (indent <= scheduleIndent) break;
    const match = line.match(/^\s*-?\s*cron:\s*["']?([^"'#]+?)["']?\s*(?:#.*)?$/);
    if (match) crons.push(match[1].trim());
  }

  return crons;
}

// Turns a five-field cron into plain English, e.g. a slash-5 minute field becomes
// "every 5 minutes". Falls back to the raw expression when it is not a simple case.
export function describeCron(cron: string) {
  const fields = cron.trim().split(/\s+/);
  if (fields.length !== 5) return cron;
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  const daily = dayOfMonth === "*" && month === "*" && dayOfWeek === "*";
  if (!daily) return cron;

  const everyMinutes = minute.match(/^\*\/(\d+)$/);
  if (everyMinutes && hour === "*") return `every ${everyMinutes[1]} minutes`;

  const everyHours = hour.match(/^\*\/(\d+)$/);
  if (everyHours && /^\d+$/.test(minute)) {
    return `at :${minute.padStart(2, "0")} past every ${everyHours[1]} hours`;
  }
  if (hour === "*" && /^\d+$/.test(minute)) return `at :${minute.padStart(2, "0")} past every hour`;

  return cron;
}
