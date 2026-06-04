#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_MAX_LINES = 300;
const TIME_ZONE = "Asia/Shanghai";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(dirname, "..");

function fail(message) {
  console.error(`[progress-rotate] ${message}`);
  process.exit(1);
}

function parsePositiveInt(value, label) {
  const parsed = Number.parseInt(value ?? "", 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    fail(
      `${label} must be a positive integer, received ${value ?? "missing"}.`,
    );
  }
  return parsed;
}

function parseArgs(args) {
  let maxLines = DEFAULT_MAX_LINES;
  let force = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--max-lines") {
      maxLines = parsePositiveInt(args[index + 1], "--max-lines");
      index += 1;
      continue;
    }
    fail(`unknown argument ${arg}. Use --max-lines <count> or --force.`);
  }

  return { force, maxLines };
}

function cstParts(date) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    month: "2-digit",
    second: "2-digit",
    timeZone: TIME_ZONE,
    year: "numeric",
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter((part) => part.type !== "literal")
      .map((part) => [part.type, part.value]),
  );
  return {
    day: parts.day,
    hour: parts.hour,
    minute: parts.minute,
    month: parts.month,
    second: parts.second,
    year: parts.year,
  };
}

function cstDateStamp(date) {
  const parts = cstParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function cstTimestamp(date) {
  const parts = cstParts(date);
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}${parts.minute}${parts.second}`;
}

function lineCount(text) {
  const normalized = text.trimEnd();
  return normalized.length === 0 ? 0 : normalized.split(/\r?\n/).length;
}

function buildFreshProgress({
  archiveRelPath,
  currentDate,
  maxLines,
  totalLines,
}) {
  return `# Cucumber Studio Progress

Last updated: ${currentDate} CST

Current window line threshold: ${maxLines} lines.

Historical archives:
- [${currentDate} oversized log before rotation](${archiveRelPath}): ${totalLines} lines moved out of the active handoff window.

Maintenance:
- Keep this file focused on the current handoff window and rotate it before it grows past ${maxLines} lines.
- Run \`pnpm progress:rotate\` from the repository root when the threshold is reached.
- Historical entries live under \`docs/progress/\`; do not duplicate archived history back into this file.

## ${currentDate}

- Rotated the previous ${totalLines}-line \`progress.md\` into \`${archiveRelPath}\` and reset this file as the current handoff window.
`;
}

const { force, maxLines } = parseArgs(process.argv.slice(2));
const progressPath = path.join(rootDir, "progress.md");
const archiveDir = path.join(rootDir, "docs", "progress");

const progressText = await readFile(progressPath, "utf8").catch((error) => {
  fail(`cannot read progress.md: ${error.message}`);
});

if (!progressText.startsWith("# Cucumber Studio Progress")) {
  fail("progress.md does not start with the expected Cucumber Studio heading.");
}

const totalLines = lineCount(progressText);
if (!force && totalLines <= maxLines) {
  console.log(
    `[progress-rotate] progress.md has ${totalLines} lines, under the ${maxLines}-line threshold.`,
  );
  process.exit(0);
}

const now = new Date();
const currentDate = cstDateStamp(now);
const archiveRelPath = `docs/progress/${cstTimestamp(now)}-archive.md`;
const archivePath = path.join(rootDir, archiveRelPath);

await mkdir(archiveDir, { recursive: true }).catch((error) => {
  fail(`cannot create docs/progress directory: ${error.message}`);
});

await writeFile(archivePath, `${progressText.trimEnd()}\n`, {
  encoding: "utf8",
  flag: "wx",
}).catch((error) => {
  fail(`cannot create archive ${archiveRelPath}: ${error.message}`);
});

const freshProgress = buildFreshProgress({
  archiveRelPath,
  currentDate,
  maxLines,
  totalLines,
});

await writeFile(progressPath, freshProgress, "utf8").catch((error) => {
  fail(
    `cannot reset progress.md after archiving ${archiveRelPath}: ${error.message}`,
  );
});

console.log(
  `[progress-rotate] archived ${totalLines} lines to ${archiveRelPath} and reset progress.md.`,
);
