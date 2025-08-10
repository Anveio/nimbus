/**
 * Defines the core data structures used in the SSH protocol.
 */

/**
 * Represents a single, complete SSH packet as defined in RFC 4253.
 * This is the unit of data that is encrypted and MAC'd.
 */
export interface SshPacket {
  /**
   * The length of the payload in bytes.
   */
  length: number;
  /**
   * The length of the padding in bytes.
   */
  paddingLength: number;
  /**
   * The core content of the packet, containing one or more SSH messages.
   */
  payload: Uint8Array;
  /**
   * The Message Authentication Code for this packet.
   */
  mac: Uint8Array;
}

/**
 * Represents a single, decrypted SSH message.
 */
export interface SshMessage {
  /**
   * The message type number (e.g., SSH_MSG.KEXINIT).
   */
  type: number;
  /**
   * The raw payload of the message, excluding the type byte.
   */
  payload: Uint8Array;
}

/**
 * Holds the set of algorithms chosen during key exchange negotiation.
 */
export interface NegotiatedAlgorithms {
  kex: string;
  serverHostKey: string;
  encryptionC2S: string;
  encryptionS2C: string;
  macC2S: string;
  macS2C: string;
  compressionC2S: string;
  compressionS2C: string;
}

/**
 * Holds the set of algorithms chosen during key exchange negotiation.
 */
export interface NegotiatedAlgorithms {
  kex: string;
  serverHostKey: string;
  encryptionC2S: string;
  encryptionS2C: string;
  macC2S: string;
  macS2C: string;
  compressionC2S: string;
  compressionS2C: string;
}
