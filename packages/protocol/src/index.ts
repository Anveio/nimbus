import * as algorithms from './algorithms';
import { SSH_MSG } from './constants';
import { NegotiatedAlgorithms, SshMessage } from './types';
import { SshDataView } from './utils/SshDataView';

type ProtocolState =
  | 'pre-identification'
  | 'post-identification'
  | 'kex-init-sent';

/**
 * The SshProtocol class is responsible for managing the state of an SSH connection.
 * It handles the transport layer logic: packet framing, encryption, and MACing.
 * It is transport-agnostic and operates on raw byte streams.
 */
export class SshProtocol {
  private state: ProtocolState = 'pre-identification';
  private buffer: Uint8Array = new Uint8Array(0);
  private keysExchanged = false; // Tracks if the initial key exchange is complete
  private serverIdentification: string | null = null;

  // KEXINIT payloads are stored for computing the exchange hash
  private clientKexinitPayload: Uint8Array | null = null;
  private serverKexinitPayload: Uint8Array | null = null;
  private negotiatedAlgorithms: NegotiatedAlgorithms | null = null;

  private readonly CLIENT_IDENTIFICATION = 'SSH-2.0-ManaSSH_0.1';

  /**
   * Generates the client's identification message.
   * This should be the very first thing sent over the transport layer.
   * @returns A Uint8Array containing the client identification string.
   */
  public getIdentificationMessage(): Uint8Array {
    return new TextEncoder().encode(this.CLIENT_IDENTIFICATION + '\r\n');
  }

  /**
   * Creates and sends the Key Exchange Initialization (KEXINIT) message.
   * This should be called immediately after the identification exchange is complete.
   */
  public sendKexinit(): void {
    const cookie = new Uint8Array(16);
    crypto.getRandomValues(cookie);

    const payload = this._createKexinitPayload(cookie);
    this.clientKexinitPayload = payload;

    this.sendMessage({
      type: SSH_MSG.KEXINIT,
      payload,
    });
    this.state = 'kex-init-sent';
  }

  /**
   * Processes incoming raw data from the transport layer.
   * It handles the initial identification string exchange and then
   * buffers the data to deframe it into complete SSH packets.
   * @param data The raw byte array received from the transport.
   */
  public handleData(data: Uint8Array): void {
    // 1. Append the new data to our internal buffer.
    const newBuffer = new Uint8Array(this.buffer.length + data.length);
    newBuffer.set(this.buffer);
    newBuffer.set(data, this.buffer.length);
    this.buffer = newBuffer;

    // 2. Handle the appropriate phase of the connection.
    if (this.state === 'pre-identification') {
      this._handleServerIdentification();
    }

    // The state might have changed, so we check again.
    if (this.state === 'post-identification' || this.state === 'kex-init-sent') {
      this._processPacketBuffer();
    }
  }

  /**
   * Looks for the server's identification string in the buffer.
   * This is a special, non-packet-based part of the handshake.
   */
  private _handleServerIdentification(): void {
    // Find the first CRLF (\r\n)
    for (let i = 0; i < this.buffer.length - 1; i++) {
      if (this.buffer[i] === 13 && this.buffer[i + 1] === 10) {
        const identificationBytes = this.buffer.subarray(0, i);
        this.serverIdentification = new TextDecoder().decode(identificationBytes);

        if (!this.serverIdentification.startsWith('SSH-2.0-')) {
          throw new Error(
            `Invalid server identification: ${this.serverIdentification}`,
          );
        }

        console.log(`Received server identification: ${this.serverIdentification}`);

        // Remove the identification string (including CRLF) from the buffer
        this.buffer = this.buffer.subarray(i + 2);
        this.state = 'post-identification';

        // Now that we have the server's ID, we must send our KEXINIT packet.
        this.sendKexinit();
        break;
      }
    }
  }

  /**
   * Continuously processes the buffer to extract and handle complete SSH packets.
   */
  private _processPacketBuffer(): void {
    // A packet needs at least 4 bytes to declare its length.
    while (this.buffer.length >= 4) {
      const view = new DataView(this.buffer.buffer, this.buffer.byteOffset);
      const packetLength = view.getUint32(0, false); // SSH is network byte order (big-endian)

      // The total length includes the 4-byte length field itself.
      const totalPacketSize = 4 + packetLength;

      // Check if the full packet has been received.
      if (this.buffer.length < totalPacketSize) {
        // Not enough data yet, wait for more.
        break;
      }

      // We have a complete packet.
      const packetData = this.buffer.subarray(4, totalPacketSize);
      this._handlePacket(packetData);

      // Slice the processed packet from the buffer.
      this.buffer = this.buffer.subarray(totalPacketSize);
    }
  }

  /**
   * Handles a single, complete, and potentially encrypted packet.
   * @param packetData The raw packet data, excluding the 4-byte length field.
   */
  private _handlePacket(packetData: Uint8Array): void {
    if (this.keysExchanged) {
      // TODO: Decrypt packetData
      console.log(`Handling encrypted packet of size ${packetData.length}`);
    } else {
      // Before the first NEWKEYS, packets are not encrypted.
      console.log(`Handling unencrypted packet of size ${packetData.length}`);
      const paddingLength = packetData[0];
      const payload = packetData.subarray(1, packetData.length - paddingLength);
      this._handlePayload(payload);
    }
  }

  /**
   * Handles the decrypted payload of a packet, which may contain multiple messages.
   * @param payload The decrypted payload.
   */
  private _handlePayload(payload: Uint8Array):
 void {
    const messageType = payload[0];
    const messageData = payload.subarray(1);
    const message: SshMessage = { type: messageType, payload: messageData };

    console.log(`Received message of type: ${Object.keys(SSH_MSG).find(key => SSH_MSG[key] === message.type) || message.type}`);

    switch (message.type) {
      case SSH_MSG.KEXINIT:
        this.serverKexinitPayload = payload;
        this._negotiateAlgorithms();
        // TODO: Start the key exchange process (e.g., Diffie-Hellman)
        break;
      // TODO: Add state machine logic here to handle other message types.
    }
  }

  /**
   * A placeholder for sending data.
   * @param message The SSH message to send.
   */
  public sendMessage(message: SshMessage): void {
    console.log(`Sending message of type ${message.type}`);
    // TODO: Implement packet framing and encryption logic here.
  }

  /**
   * Constructs the KEXINIT payload.
   * @param cookie A 16-byte random value.
   * @returns The constructed payload as a Uint8Array.
   */
  private _createKexinitPayload(cookie: Uint8Array): Uint8Array {
    const lists = [
      algorithms.KEX_ALGORITHMS,
      algorithms.SERVER_HOST_KEY_ALGORITHMS,
      algorithms.ENCRYPTION_ALGORITHMS_C2S,
      algorithms.ENCRYPTION_ALGORITHMS_S2C,
      algorithms.MAC_ALGORITHMS_C2S,
      algorithms.MAC_ALGORITHMS_S2C,
      algorithms.COMPRESSION_ALGORITHMS_C2S,
      algorithms.COMPRESSION_ALGORITHMS_S2C,
      algorithms.LANGUAGES_C2S,
      algorithms.LANGUAGES_S2C,
    ];

    // Calculate the total length of the payload
    let totalLength = 1 + 16; // message type + cookie
    for (const list of lists) {
      const str = list.join(',');
      totalLength += 4 + str.length; // 4 bytes for length prefix
    }
    totalLength += 1 + 4; // first_kex_packet_follows (boolean) + reserved (uint32)

    const buffer = new ArrayBuffer(totalLength);
    const view = new SshDataView(buffer);

    view.setUint8(SSH_MSG.KEXINIT);
    view.setBytes(cookie);
    for (const list of lists) {
      view.setString(list.join(','));
    }
    view.setBoolean(false); // first_kex_packet_follows
    view.setUint32(0); // reserved

    return new Uint8Array(buffer);
  }

  /**
   * Parses the server's KEXINIT payload.
   */
  private _parseKexinitPayload(payload: Uint8Array): Record<string, string[]> {
    const view = new SshDataView(payload.buffer, payload.byteOffset);
    view.getBytes(16); // Skip cookie
    const serverAlgorithms = {
      kex: view.getString().split(','),
      serverHostKey: view.getString().split(','),
      encryptionC2S: view.getString().split(','),
      encryptionS2C: view.getString().split(','),
      macC2S: view.getString().split(','),
      macS2C: view.getString().split(','),
      compressionC2S: view.getString().split(','),
      compressionS2C: view.getString().split(','),
      languagesC2S: view.getString().split(','),
      languagesS2C: view.getString().split(','),
    };
    return serverAlgorithms;
  }

  /**
   * Compares client and server algorithms and selects the final set.
   */
  private _negotiateAlgorithms(): void {
    if (!this.serverKexinitPayload) {
      throw new Error('Server KEXINIT payload not received.');
    }
    // The server payload includes the message type, so we skip it.
    const serverAlgs = this._parseKexinitPayload(this.serverKexinitPayload.subarray(1));

    const find = (client: string[], server: string[]) => {
      const choice = client.find(alg => server.includes(alg));
      if (!choice) throw new Error(`Failed to agree on algorithm: ${client} vs ${server}`);
      return choice;
    };

    this.negotiatedAlgorithms = {
      kex: find(algorithms.KEX_ALGORITHMS, serverAlgs.kex),
      serverHostKey: find(algorithms.SERVER_HOST_KEY_ALGORITHMS, serverAlgs.serverHostKey),
      encryptionC2S: find(algorithms.ENCRYPTION_ALGORITHMS_C2S, serverAlgs.encryptionC2S),
      encryptionS2C: find(algorithms.ENCRYPTION_ALGORITHMS_S2C, serverAlgs.encryptionS2C),
      macC2S: find(algorithms.MAC_ALGORITHMS_C2S, serverAlgs.macC2S),
      macS2C: find(algorithms.MAC_ALGORITHMS_S2C, serverAlgs.macS2C),
      compressionC2S: find(algorithms.COMPRESSION_ALGORITHMS_C2S, serverAlgs.compressionC2S),
      compressionS2C: find(algorithms.COMPRESSION_ALGORITHMS_S2C, serverAlgs.compressionS2C),
    };

    console.log('Negotiated algorithms:', this.negotiatedAlgorithms);
  }
}

