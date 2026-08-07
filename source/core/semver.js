/**
 * The smallest SemVer range matcher that satisfies §8.4.
 *
 * `requires: { mutakit: '^1.0.0', 'acme:theme': '^2' }` is checked at install
 * time, so this needs `^`, `~`, comparators, `*`, and bare versions — not the
 * whole grammar. Anything it cannot parse is reported rather than guessed at.
 */

function parse(version) {
  const match = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z-.]+))?/.exec(String(version).trim());
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: match[2] === undefined ? 0 : Number(match[2]),
    patch: match[3] === undefined ? 0 : Number(match[3]),
    pre: match[4] || "",
    partial: { minor: match[2] === undefined, patch: match[3] === undefined }
  };
}

function compare(a, b) {
  if (a.major !== b.major) return a.major - b.major;
  if (a.minor !== b.minor) return a.minor - b.minor;
  if (a.patch !== b.patch) return a.patch - b.patch;
  if (a.pre === b.pre) return 0;
  if (!a.pre) return 1; // a release outranks any prerelease
  if (!b.pre) return -1;
  return a.pre < b.pre ? -1 : 1;
}

function upperBound(v, operator) {
  if (operator === "^") {
    if (v.major > 0) return { major: v.major + 1, minor: 0, patch: 0, pre: "" };
    if (v.minor > 0 || v.partial.minor) return { major: 0, minor: v.minor + 1, patch: 0, pre: "" };
    return { major: 0, minor: 0, patch: v.patch + 1, pre: "" };
  }
  // '~': allow patch-level changes if a minor is given, minor-level if not.
  if (v.partial.minor) return { major: v.major + 1, minor: 0, patch: 0, pre: "" };
  return { major: v.major, minor: v.minor + 1, patch: 0, pre: "" };
}

function satisfiesOne(version, range) {
  const trimmed = range.trim();
  if (trimmed === "" || trimmed === "*" || trimmed === "x" || trimmed === "latest") return true;

  const match = /^(\^|~|>=|<=|>|<|=)?\s*(.+)$/.exec(trimmed);
  if (!match) return false;
  const operator = match[1] || "=";
  const bound = parse(match[2]);
  if (!bound || !version) return false;

  switch (operator) {
    case "^":
    case "~": {
      if (compare(version, bound) < 0) return false;
      return compare(version, upperBound(bound, operator)) < 0;
    }
    case ">":
      return compare(version, bound) > 0;
    case ">=":
      return compare(version, bound) >= 0;
    case "<":
      return compare(version, bound) < 0;
    case "<=":
      return compare(version, bound) <= 0;
    default: {
      if (bound.partial.minor) return version.major === bound.major;
      if (bound.partial.patch) return version.major === bound.major && version.minor === bound.minor;
      return compare(version, bound) === 0;
    }
  }
}

/** True when `version` satisfies `range`. Space-separated terms are ANDed. */
export function satisfies(version, range) {
  const v = parse(version);
  if (!v) return false;
  return String(range)
    .split("||")
    .some((alternative) =>
      alternative
        .trim()
        .split(/\s+(?![\d.])/)
        .every((term) => satisfiesOne(v, term))
    );
}

export { parse as parseVersion, compare as compareVersions };
