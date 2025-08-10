/**
 * Defines the default sets of cryptographic algorithms supported by the client.
 * The order indicates preference.
 */

// Key Exchange Algorithms (RFC 4253, Section 6.4)
export const KEX_ALGORITHMS = [
  'curve25519-sha256',
  'curve25519-sha256@libssh.org',
  'diffie-hellman-group14-sha256',
];

// Server Host Key Algorithms (RFC 4253, Section 6.4)
export const SERVER_HOST_KEY_ALGORITHMS = [
  'ssh-ed25519',
  'rsa-sha2-512',
  'rsa-sha2-256',
];

// Encryption Algorithms (Client to Server) (RFC 4253, Section 6.3)
export const ENCRYPTION_ALGORITHMS_C2S = [
  'aes256-gcm@openssh.com',
  'aes128-gcm@openssh.com',
  'aes256-ctr',
  'aes192-ctr',
  'aes128-ctr',
];

// Encryption Algorithms (Server to Client)
export const ENCRYPTION_ALGORITHMS_S2C = ENCRYPTION_ALGORITHMS_C2S;

// MAC Algorithms (Client to Server) (RFC 4253, Section 6.4)
export const MAC_ALGORITHMS_C2S = [
  'hmac-sha2-256-etm@openssh.com',
  'hmac-sha2-512-etm@openssh.com',
  'hmac-sha2-256',
  'hmac-sha2-512',
];

// MAC Algorithms (Server to Client)
export const MAC_ALGORITHMS_S2C = MAC_ALGORITHMS_C2S;

// Compression Algorithms (Client to Server) (RFC 4253, Section 6.2)
export const COMPRESSION_ALGORITHMS_C2S = ['none'];

// Compression Algorithms (Server to Client)
export const COMPRESSION_ALGORITHMS_S2C = COMPRESSION_ALGORITHMS_C2S;

// Languages (Client to Server)
export const LANGUAGES_C2S = [''];

// Languages (Server to Client)
export const LANGUAGES_S2C = [''];
