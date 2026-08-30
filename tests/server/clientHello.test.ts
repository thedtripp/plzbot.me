import { describe, it, expect } from "vitest";
import { parseClientHello, NeedMoreDataError } from "../../src/server/tls-capture/clientHello.js";
import { computeJa3 } from "../../src/server/tls-capture/ja3.js";
import { computeJa4 } from "../../src/server/tls-capture/ja4.js";
import { isGrease, GREASE_VALUES } from "../../src/server/tls-capture/grease.js";

/** Hand-builds a syntactically valid ClientHello TLS record for testing, so parser tests don't
 * depend on capturing bytes from a real client (which would make the test environment-dependent
 * and non-reproducible). Only includes the extensions the parser understands. */
function buildClientHello(opts: {
  handshakeVersion?: number;
  cipherSuites?: number[];
  serverName?: string;
  supportedGroups?: number[];
  ecPointFormats?: number[];
  signatureAlgorithms?: number[];
  alpnProtocols?: string[];
  supportedVersions?: number[];
}): Buffer {
  const cipherSuites = opts.cipherSuites ?? [0x1301, 0x1302, 0xc02f];
  const handshakeVersion = opts.handshakeVersion ?? 0x0303;

  const extensions: Buffer[] = [];

  if (opts.serverName) {
    const nameBuf = Buffer.from(opts.serverName, "utf8");
    const serverNameEntry = Buffer.concat([
      Buffer.from([0x00]), // host_name type
      u16(nameBuf.length),
      nameBuf,
    ]);
    const list = Buffer.concat([u16(serverNameEntry.length), serverNameEntry]);
    extensions.push(ext(0, Buffer.concat([u16(list.length - 2), serverNameEntry])));
  }

  if (opts.supportedGroups) {
    const list = Buffer.concat(opts.supportedGroups.map(u16));
    extensions.push(ext(10, Buffer.concat([u16(list.length), list])));
  }

  if (opts.ecPointFormats) {
    const list = Buffer.from(opts.ecPointFormats);
    extensions.push(ext(11, Buffer.concat([Buffer.from([list.length]), list])));
  }

  if (opts.signatureAlgorithms) {
    const list = Buffer.concat(opts.signatureAlgorithms.map(u16));
    extensions.push(ext(13, Buffer.concat([u16(list.length), list])));
  }

  if (opts.alpnProtocols) {
    const entries = Buffer.concat(
      opts.alpnProtocols.map((p) => {
        const b = Buffer.from(p, "utf8");
        return Buffer.concat([Buffer.from([b.length]), b]);
      }),
    );
    extensions.push(ext(16, Buffer.concat([u16(entries.length), entries])));
  }

  if (opts.supportedVersions) {
    const list = Buffer.concat(opts.supportedVersions.map(u16));
    extensions.push(ext(43, Buffer.concat([Buffer.from([list.length]), list])));
  }

  const extensionsBuf = Buffer.concat(extensions);

  const body = Buffer.concat([
    u16(handshakeVersion),
    Buffer.alloc(32, 0x01), // random
    Buffer.from([0x00]), // session id length 0
    u16(cipherSuites.length * 2),
    Buffer.concat(cipherSuites.map(u16)),
    Buffer.from([0x01, 0x00]), // compression methods: length 1, null
    u16(extensionsBuf.length),
    extensionsBuf,
  ]);

  const handshake = Buffer.concat([
    Buffer.from([0x01]), // ClientHello
    u24(body.length),
    body,
  ]);

  const record = Buffer.concat([
    Buffer.from([0x16]), // handshake content type
    u16(0x0301), // record layer version
    u16(handshake.length),
    handshake,
  ]);

  return record;
}

function u16(n: number): Buffer {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
}
function u24(n: number): Buffer {
  const b = Buffer.alloc(3);
  b.writeUIntBE(n, 0, 3);
  return b;
}
function ext(type: number, data: Buffer): Buffer {
  return Buffer.concat([u16(type), u16(data.length), data]);
}

describe("parseClientHello", () => {
  it("returns null for non-TLS data", () => {
    expect(parseClientHello(Buffer.from("GET / HTTP/1.1\r\n"))).toBeNull();
  });

  it("throws NeedMoreDataError for a truncated record", () => {
    const full = buildClientHello({});
    const truncated = full.subarray(0, full.length - 10);
    expect(() => parseClientHello(truncated)).toThrow(NeedMoreDataError);
  });

  it("parses cipher suites, SNI, groups, point formats, sig algs, ALPN, and versions", () => {
    const buf = buildClientHello({
      cipherSuites: [0x1301, 0x1302, 0xc02f, 0x0a0a /* GREASE */],
      serverName: "example.test",
      supportedGroups: [0x001d, 0x0017, 0x0a0a],
      ecPointFormats: [0],
      signatureAlgorithms: [0x0403, 0x0804],
      alpnProtocols: ["h2", "http/1.1"],
      supportedVersions: [0x0304, 0x0303, 0x0a0a],
    });

    const parsed = parseClientHello(buf);
    expect(parsed).not.toBeNull();
    expect(parsed!.cipherSuites).toEqual([0x1301, 0x1302, 0xc02f, 0x0a0a]);
    expect(parsed!.serverName).toBe("example.test");
    expect(parsed!.supportedGroups).toEqual([0x001d, 0x0017, 0x0a0a]);
    expect(parsed!.ecPointFormats).toEqual([0]);
    expect(parsed!.signatureAlgorithms).toEqual([0x0403, 0x0804]);
    expect(parsed!.alpnProtocols).toEqual(["h2", "http/1.1"]);
    expect(parsed!.supportedVersions).toEqual([0x0304, 0x0303, 0x0a0a]);
    expect(parsed!.extensions.map((e) => e.type)).toEqual([0, 10, 11, 13, 16, 43]);
  });
});

describe("GREASE filtering", () => {
  it("recognizes all 16 RFC 8701 GREASE values", () => {
    expect(GREASE_VALUES.size).toBe(16);
    expect(isGrease(0x0a0a)).toBe(true);
    expect(isGrease(0xfafa)).toBe(true);
    expect(isGrease(0x1301)).toBe(false);
  });
});

describe("JA3", () => {
  it("excludes GREASE and hashes deterministically", () => {
    const buf = buildClientHello({
      cipherSuites: [0x0a0a, 0x1301, 0x1302],
      supportedGroups: [0x001d, 0x1a1a],
      ecPointFormats: [0],
    });
    const parsed = parseClientHello(buf)!;
    const { ja3String, ja3Hash } = computeJa3(parsed);

    expect(ja3String).toBe("771,4865-4866,10-11,29,0");
    expect(ja3Hash).toHaveLength(32);

    // Same logical handshake, GREASE values shuffled -- hash must be identical (GREASE excluded).
    const buf2 = buildClientHello({
      cipherSuites: [0x2a2a, 0x1301, 0x1302],
      supportedGroups: [0x001d, 0x9a9a],
      ecPointFormats: [0],
    });
    const parsed2 = parseClientHello(buf2)!;
    expect(computeJa3(parsed2).ja3Hash).toBe(ja3Hash);
  });
});

describe("JA4", () => {
  it("produces the documented a_b_c shape and is TCP/'t'-prefixed", () => {
    const buf = buildClientHello({
      handshakeVersion: 0x0303,
      cipherSuites: [0x1301, 0x1302],
      serverName: "example.test",
      signatureAlgorithms: [0x0403],
      alpnProtocols: ["h2"],
      supportedVersions: [0x0304, 0x0303],
    });
    const parsed = parseClientHello(buf)!;
    const { ja4, parts } = computeJa4(parsed);

    expect(ja4).toMatch(/^t\d{2}[di]\d{2}\d{2}\w{2}_[0-9a-f]{12}_[0-9a-f]{12}$/);
    // TLS1.3 (from supported_versions), SNI present, 2 ciphers, 4 extensions
    // (server_name, signature_algorithms, alpn, supported_versions), alpn "h2".
    expect(parts.a).toBe("t13d0204h2");
  });

  it("reports 'i' (no SNI) when server_name is absent", () => {
    const buf = buildClientHello({ cipherSuites: [0x1301] });
    const parsed = parseClientHello(buf)!;
    expect(computeJa4(parsed).parts.a[3]).toBe("i");
  });
});
