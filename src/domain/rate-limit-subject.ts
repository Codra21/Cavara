// The string a rate limit counts against for a client address. Pure.
//
// An IPv4 address is one subscriber. An IPv6 subscriber usually controls a whole /64, so counting the full address
// would let one client rotate through 2^64 addresses and never hit a limit. IPv6 is therefore cut to its /64 prefix.

const MAX_SUBJECT_LENGTH = 64;

function parseIpv4(text: string): number[] | null {
  const parts = text.split(".");
  if (parts.length !== 4) return null;
  const octets = parts.map((part) => (/^\d{1,3}$/.test(part) ? Number(part) : NaN));
  return octets.every((octet) => octet <= 255) ? octets : null;
}

/** The eight 16-bit groups of an IPv6 address (with `::` expanded and a trailing dotted IPv4 converted), or null. */
function parseIpv6(text: string): number[] | null {
  let tail: number[] = [];
  let body = text;
  const lastColon = body.lastIndexOf(":");
  const dotted = body.slice(lastColon + 1);
  if (dotted.includes(".")) {
    const octets = parseIpv4(dotted);
    if (!octets) return null;
    tail = [((octets[0] ?? 0) << 8) | (octets[1] ?? 0), ((octets[2] ?? 0) << 8) | (octets[3] ?? 0)];
    body = body.slice(0, lastColon + 1) + "0:0";
  }
  const halves = body.split("::");
  if (halves.length > 2) return null;
  const toGroups = (part: string) => (part === "" ? [] : part.split(":"));
  const head = toGroups(halves[0] ?? "");
  const rest = halves.length === 2 ? toGroups(halves[1] ?? "") : [];
  const all = [...head, ...rest];
  if (!all.every((group) => /^[0-9a-f]{1,4}$/i.test(group))) return null;
  const missing = 8 - all.length;
  if (halves.length === 2 ? missing < 1 : missing !== 0) return null;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...rest].map((group) =>
    parseInt(group, 16),
  );
  if (tail.length) groups.splice(6, 2, ...tail);
  return groups;
}

/**
 * IPv4 as it is, IPv6 as its /64 prefix ("2001:db8:0:0::/64"), an IPv4-mapped IPv6 address (::ffff:1.2.3.4) as the
 * IPv4 address. Anything else (an empty header, "local" in dev, junk) comes back trimmed, lower case and cut to 64
 * characters, so it still counts against one bucket and never throws.
 */
export function rateLimitSubject(client: string): string {
  const raw = client.trim().replace(/^\[|\]$/g, "");
  const text = raw.split("%")[0]!.toLowerCase();
  const v4 = parseIpv4(text);
  if (v4) return v4.join(".");
  if (text.includes(":")) {
    const groups = parseIpv6(text);
    if (groups) {
      if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
        return [groups[6]! >> 8, groups[6]! & 255, groups[7]! >> 8, groups[7]! & 255].join(".");
      }
      return `${groups
        .slice(0, 4)
        .map((group) => group.toString(16))
        .join(":")}::/64`;
    }
  }
  return text.slice(0, MAX_SUBJECT_LENGTH) || "unknown";
}
