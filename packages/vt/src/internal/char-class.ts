import { ByteFlag } from "../types";

export interface ByteRange {
  readonly start: number;
  readonly end: number;
  readonly flag: ByteFlag;
}

export const BYTE_RANGES: ReadonlyArray<ByteRange> = [
  { start: 0x00, end: 0x1f, flag: ByteFlag.C0Control },
  { start: 0x7f, end: 0x7f, flag: ByteFlag.Delete },
  { start: 0x80, end: 0x9f, flag: ByteFlag.C1Control },
  { start: 0x1b, end: 0x1b, flag: ByteFlag.Escape },
  { start: 0x20, end: 0x2f, flag: ByteFlag.Intermediate },
  { start: 0x30, end: 0x3f, flag: ByteFlag.Parameter },
  { start: 0x40, end: 0x7e, flag: ByteFlag.Final },
  { start: 0x20, end: 0x7e, flag: ByteFlag.Printable },
  { start: 0x9c, end: 0x9c, flag: ByteFlag.StringTerminator },
  { start: 0x07, end: 0x07, flag: ByteFlag.StringTerminator },
];
