/**
 * A wrapper around the native DataView to provide helper methods for
 * reading and writing SSH protocol-specific data types.
 */
export class SshDataView extends DataView {
  private textEncoder = new TextEncoder();
  private textDecoder = new TextDecoder('utf-8');
  private offset = 0;

  // --- Writer methods ---

  /**
   * Writes a Uint8Array to the view and advances the offset.
   * @param bytes The bytes to write.
   */
  public setBytes(bytes: Uint8Array): void {
    new Uint8Array(this.buffer, this.byteOffset).set(bytes, this.offset);
    this.offset += bytes.length;
  }

  /**
   * Writes a boolean value and advances the offset.
   * @param value The boolean to write.
   */
  public setBoolean(value: boolean): void {
    this.setUint8(this.offset, value ? 1 : 0);
    this.offset += 1;
  }

  /**
   * Writes a uint32 value and advances the offset.
   * @param value The number to write.
   */
  public setUint32(value: number): void {
    super.setUint32(this.offset, value, false); // false for big-endian
    this.offset += 4;
  }

  /**
   * Writes a string, prefixed with its length as a uint32.
   * @param str The string to write.
   */
  public setString(str: string): void {
    const bytes = this.textEncoder.encode(str);
    this.setUint32(bytes.length);
    this.setBytes(bytes);
  }

  // --- Reader methods ---

  /**
   * Reads a uint32 value and advances the offset.
   * @returns The read number.
   */
  public getUint32(): number {
    const value = super.getUint32(this.offset, false);
    this.offset += 4;
    return value;
  }

  /**
   * Reads a block of bytes of a given length and advances the offset.
   * @param length The number of bytes to read.
   * @returns The read bytes as a Uint8Array.
   */
  public getBytes(length: number): Uint8Array {
    const bytes = new Uint8Array(this.buffer, this.byteOffset + this.offset, length);
    this.offset += length;
    return bytes;
  }

  /**
   * Reads a length-prefixed string and advances the offset.
   * @returns The read string.
   */
  public getString(): string {
    const length = this.getUint32();
    const bytes = this.getBytes(length);
    return this.textDecoder.decode(bytes);
  }

  /**
   * Reads a boolean value and advances the offset.
   */
  public getBoolean(): boolean {
    const value = this.getUint8(this.offset);
    this.offset += 1;
    return value !== 0;
  }
}
