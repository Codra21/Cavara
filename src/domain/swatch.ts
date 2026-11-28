// Pure CSS swatch allowlist shared by admin validation, editor preview, snapshot decoding and storefront rendering.
// Accepts hex colours, rgb/rgba/hsl/hsla, and linear/radial/conic gradients built only from safe colour/angle/length tokens.

export const MAX_SWATCH_LENGTH = 300;

const SAFE_CHARS = /^[#a-zA-Z0-9(),.%\s/-]+$/;
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
const NUMBER_OR_PERCENT = /^(?:\d+(?:\.\d+)?|\.\d+)%?$/;
const PERCENT = /^(?:\d+(?:\.\d+)?|\.\d+)%$/;
const HUE = /^-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|grad|turn)?$/i;
const ANGLE = /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:deg|rad|grad|turn))$/i;
const LENGTH_OR_PERCENT = /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px))$/i;
const STOP_POSITION = /^(?:0|-?(?:\d+(?:\.\d+)?|\.\d+)(?:%|px|deg|rad|grad|turn))$/i;
const LINEAR_DIRECTION = /^to\s+(?:top|bottom|left|right)(?:\s+(?:top|bottom|left|right))?$/i;
const RADIAL_SHAPES = new Set(["circle", "ellipse"]);
const RADIAL_SIZES = new Set(["closest-side", "farthest-side", "closest-corner", "farthest-corner"]);
const POSITION_KEYWORDS = new Set(["top", "bottom", "left", "right", "center"]);

function isSafeRgb(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (trimmed.includes(",")) {
    if (trimmed.includes("/")) return false;
    const parts = trimmed.split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return false;
    return parts.every((p) => NUMBER_OR_PERCENT.test(p));
  }
  const slashParts = trimmed.split("/");
  if (slashParts.length > 2) return false;
  const channels = slashParts[0]!.trim().split(/\s+/).filter(Boolean);
  if (channels.length !== 3 || !channels.every((c) => NUMBER_OR_PERCENT.test(c))) return false;
  if (slashParts.length === 2) {
    const alpha = slashParts[1]!.trim();
    if (!NUMBER_OR_PERCENT.test(alpha)) return false;
  }
  return true;
}

function isSafeHsl(inner: string): boolean {
  const trimmed = inner.trim();
  if (!trimmed) return false;
  if (trimmed.includes(",")) {
    if (trimmed.includes("/")) return false;
    const parts = trimmed.split(",").map((p) => p.trim());
    if (parts.length !== 3 && parts.length !== 4) return false;
    if (!HUE.test(parts[0]!) || !PERCENT.test(parts[1]!) || !PERCENT.test(parts[2]!)) return false;
    if (parts.length === 4 && !NUMBER_OR_PERCENT.test(parts[3]!)) return false;
    return true;
  }
  const slashParts = trimmed.split("/");
  if (slashParts.length > 2) return false;
  const channels = slashParts[0]!.trim().split(/\s+/).filter(Boolean);
  if (channels.length !== 3) return false;
  if (!HUE.test(channels[0]!) || !PERCENT.test(channels[1]!) || !PERCENT.test(channels[2]!)) return false;
  if (slashParts.length === 2) {
    const alpha = slashParts[1]!.trim();
    if (!NUMBER_OR_PERCENT.test(alpha)) return false;
  }
  return true;
}

function isSafeColor(token: string): boolean {
  const value = token.trim();
  if (!value) return false;
  if (HEX_COLOR.test(value)) return true;
  if (value.toLowerCase() === "transparent") return true;
  const fnMatch = /^(rgba?|hsla?)\(([^()]+)\)$/i.exec(value);
  if (!fnMatch) return false;
  const fn = fnMatch[1]!.toLowerCase();
  const inner = fnMatch[2]!;
  return fn === "rgb" || fn === "rgba" ? isSafeRgb(inner) : isSafeHsl(inner);
}

function isSafePosition(tokens: string[]): boolean {
  if (tokens.length < 1 || tokens.length > 2) return false;
  return tokens.every((t) => POSITION_KEYWORDS.has(t.toLowerCase()) || LENGTH_OR_PERCENT.test(t));
}

function isSafeRadialPreamble(arg: string): boolean {
  const tokens = arg.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const atIndex = tokens.findIndex((t) => t.toLowerCase() === "at");
  const beforeAt = atIndex === -1 ? tokens : tokens.slice(0, atIndex);
  const afterAt = atIndex === -1 ? [] : tokens.slice(atIndex + 1);
  if (atIndex !== -1 && !isSafePosition(afterAt)) return false;
  if (beforeAt.length === 0) return atIndex !== -1;

  let i = 0;
  if (RADIAL_SHAPES.has(beforeAt[i]!.toLowerCase())) i++;
  const rest = beforeAt.slice(i);
  if (rest.length === 0) return true;
  if (rest.length === 1 && (RADIAL_SIZES.has(rest[0]!.toLowerCase()) || LENGTH_OR_PERCENT.test(rest[0]!))) return true;
  if (rest.length === 2 && rest.every((t) => LENGTH_OR_PERCENT.test(t))) return true;
  return false;
}

function isSafeConicPreamble(arg: string): boolean {
  const tokens = arg.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  let i = 0;
  let matched = false;
  if (tokens[i]?.toLowerCase() === "from") {
    if (!tokens[i + 1] || !ANGLE.test(tokens[i + 1]!)) return false;
    i += 2;
    matched = true;
  }
  if (tokens[i]?.toLowerCase() === "at") {
    const pos = tokens.slice(i + 1);
    if (!isSafePosition(pos)) return false;
    i = tokens.length;
    matched = true;
  }
  return matched && i === tokens.length;
}

function splitTopLevel(input: string, delimiter: "," | "space"): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === "(") {
      depth++;
      if (depth > 1) return null;
    } else if (ch === ")") {
      depth--;
      if (depth < 0) return null;
    } else if (depth === 0) {
      if (delimiter === "," && ch === ",") {
        parts.push(input.slice(start, i).trim());
        start = i + 1;
      } else if (delimiter === "space" && /\s/.test(ch!)) {
        const piece = input.slice(start, i).trim();
        if (piece) parts.push(piece);
        start = i + 1;
      }
    }
  }
  if (depth !== 0) return null;
  const tail = input.slice(start).trim();
  if (delimiter === ",") parts.push(tail);
  else if (tail) parts.push(tail);
  return parts;
}

function isSafeColorStop(arg: string): boolean {
  const tokens = splitTopLevel(arg, "space");
  if (!tokens || tokens.length < 1 || tokens.length > 3) return false;
  if (!isSafeColor(tokens[0]!)) return false;
  for (let i = 1; i < tokens.length; i++) {
    if (!STOP_POSITION.test(tokens[i]!)) return false;
  }
  return true;
}

function isSafeGradient(value: string): boolean {
  const match = /^((?:repeating-)?(?:linear|radial|conic)-gradient)\((.+)\)$/i.exec(value);
  if (!match) return false;
  const fn = match[1]!.toLowerCase();
  const args = splitTopLevel(match[2]!, ",");
  if (!args || args.length < 2 || args.some((a) => a.length === 0)) return false;

  let stopStart = 0;
  const first = args[0]!;
  if (fn.endsWith("linear-gradient")) {
    if (ANGLE.test(first) || LINEAR_DIRECTION.test(first)) stopStart = 1;
  } else if (fn.endsWith("radial-gradient")) {
    if (isSafeRadialPreamble(first)) stopStart = 1;
  } else if (fn.endsWith("conic-gradient")) {
    if (isSafeConicPreamble(first)) stopStart = 1;
  }

  const stops = args.slice(stopStart);
  if (stops.length < 2) return false;
  return stops.every(isSafeColorStop);
}

/** Returns true only for safe CSS swatch colours and gradients (never url(), image-set(), var(), comments or quotes). */
export function isSafeSwatch(value: string): boolean {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_SWATCH_LENGTH) return false;
  if (!SAFE_CHARS.test(trimmed)) return false;
  return isSafeColor(trimmed) || isSafeGradient(trimmed);
}

/** Returns the trimmed swatch when it passes `isSafeSwatch`, otherwise empty string. */
export function safeSwatch(value: string): string {
  return isSafeSwatch(value) ? value.trim() : "";
}
