/**
 * Human-readable names for TLS code points, from the IANA TLS parameter registries
 * (https://www.iana.org/assignments/tls-parameters/ and tls-extensiontype-values/).
 * Only the values commonly seen from browsers and mainstream TLS libraries are listed;
 * anything else is rendered as its hex value, never guessed.
 */
export const CIPHER_SUITE_NAMES: Record<number, string> = {
  0x1301: "TLS_AES_128_GCM_SHA256",
  0x1302: "TLS_AES_256_GCM_SHA384",
  0x1303: "TLS_CHACHA20_POLY1305_SHA256",
  0x1304: "TLS_AES_128_CCM_SHA256",
  0x1305: "TLS_AES_128_CCM_8_SHA256",
  0xc02b: "TLS_ECDHE_ECDSA_WITH_AES_128_GCM_SHA256",
  0xc02f: "TLS_ECDHE_RSA_WITH_AES_128_GCM_SHA256",
  0xc02c: "TLS_ECDHE_ECDSA_WITH_AES_256_GCM_SHA384",
  0xc030: "TLS_ECDHE_RSA_WITH_AES_256_GCM_SHA384",
  0xcca9: "TLS_ECDHE_ECDSA_WITH_CHACHA20_POLY1305_SHA256",
  0xcca8: "TLS_ECDHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
  0xccaa: "TLS_DHE_RSA_WITH_CHACHA20_POLY1305_SHA256",
  0xc013: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA",
  0xc014: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA",
  0xc009: "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA",
  0xc00a: "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA",
  0xc023: "TLS_ECDHE_ECDSA_WITH_AES_128_CBC_SHA256",
  0xc024: "TLS_ECDHE_ECDSA_WITH_AES_256_CBC_SHA384",
  0xc027: "TLS_ECDHE_RSA_WITH_AES_128_CBC_SHA256",
  0xc028: "TLS_ECDHE_RSA_WITH_AES_256_CBC_SHA384",
  0x009c: "TLS_RSA_WITH_AES_128_GCM_SHA256",
  0x009d: "TLS_RSA_WITH_AES_256_GCM_SHA384",
  0x009e: "TLS_DHE_RSA_WITH_AES_128_GCM_SHA256",
  0x009f: "TLS_DHE_RSA_WITH_AES_256_GCM_SHA384",
  0x002f: "TLS_RSA_WITH_AES_128_CBC_SHA",
  0x0035: "TLS_RSA_WITH_AES_256_CBC_SHA",
  0x003c: "TLS_RSA_WITH_AES_128_CBC_SHA256",
  0x003d: "TLS_RSA_WITH_AES_256_CBC_SHA256",
  0x0033: "TLS_DHE_RSA_WITH_AES_128_CBC_SHA",
  0x0039: "TLS_DHE_RSA_WITH_AES_256_CBC_SHA",
  0x0067: "TLS_DHE_RSA_WITH_AES_128_CBC_SHA256",
  0x006b: "TLS_DHE_RSA_WITH_AES_256_CBC_SHA256",
  0x000a: "TLS_RSA_WITH_3DES_EDE_CBC_SHA",
  0x00ff: "TLS_EMPTY_RENEGOTIATION_INFO_SCSV",
  0x5600: "TLS_FALLBACK_SCSV",
};

export const EXTENSION_NAMES: Record<number, string> = {
  0: "server_name",
  1: "max_fragment_length",
  5: "status_request",
  10: "supported_groups",
  11: "ec_point_formats",
  13: "signature_algorithms",
  14: "use_srtp",
  15: "heartbeat",
  16: "application_layer_protocol_negotiation",
  17: "status_request_v2",
  18: "signed_certificate_timestamp",
  19: "client_certificate_type",
  20: "server_certificate_type",
  21: "padding",
  22: "encrypt_then_mac",
  23: "extended_master_secret",
  27: "compress_certificate",
  28: "record_size_limit",
  34: "delegated_credential",
  35: "session_ticket",
  41: "pre_shared_key",
  42: "early_data",
  43: "supported_versions",
  44: "cookie",
  45: "psk_key_exchange_modes",
  47: "certificate_authorities",
  49: "post_handshake_auth",
  50: "signature_algorithms_cert",
  51: "key_share",
  0x4469: "application_settings (ALPS)",
  0x44cd: "application_settings_new (ALPS)",
  0xfe0d: "encrypted_client_hello",
  0xff01: "renegotiation_info",
};

export const GROUP_NAMES: Record<number, string> = {
  0x0017: "secp256r1",
  0x0018: "secp384r1",
  0x0019: "secp521r1",
  0x001d: "x25519",
  0x001e: "x448",
  0x0100: "ffdhe2048",
  0x0101: "ffdhe3072",
  0x0102: "ffdhe4096",
  0x6399: "X25519Kyber768Draft00",
  0x11ec: "X25519MLKEM768",
  0x11eb: "SecP256r1MLKEM768",
};

export const SIGNATURE_ALGORITHM_NAMES: Record<number, string> = {
  0x0401: "rsa_pkcs1_sha256",
  0x0501: "rsa_pkcs1_sha384",
  0x0601: "rsa_pkcs1_sha512",
  0x0403: "ecdsa_secp256r1_sha256",
  0x0503: "ecdsa_secp384r1_sha384",
  0x0603: "ecdsa_secp521r1_sha512",
  0x0804: "rsa_pss_rsae_sha256",
  0x0805: "rsa_pss_rsae_sha384",
  0x0806: "rsa_pss_rsae_sha512",
  0x0807: "ed25519",
  0x0808: "ed448",
  0x0809: "rsa_pss_pss_sha256",
  0x080a: "rsa_pss_pss_sha384",
  0x080b: "rsa_pss_pss_sha512",
  0x0201: "rsa_pkcs1_sha1",
  0x0203: "ecdsa_sha1",
  0x0301: "rsa_sha224 (legacy)",
  0x0303: "ecdsa_sha224 (legacy)",
};

export const TLS_VERSION_NAMES: Record<number, string> = {
  0x0304: "TLS 1.3",
  0x0303: "TLS 1.2",
  0x0302: "TLS 1.1",
  0x0301: "TLS 1.0",
  0x0300: "SSL 3.0",
};

export const PSK_MODE_NAMES: Record<number, string> = { 0: "psk_ke", 1: "psk_dhe_ke" };

export function hex4(n: number): string {
  return `0x${n.toString(16).padStart(4, "0")}`;
}

export function nameOf(table: Record<number, string>, n: number, isGrease?: (n: number) => boolean): string {
  if (isGrease?.(n)) return `GREASE (${hex4(n)})`;
  return table[n] ?? hex4(n);
}
