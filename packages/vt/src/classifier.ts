import { BYTE_RANGES } from "./internal/char-class";
import { ByteFlag } from "./types";

/**
 * Determine the category for a byte according to ECMA-48 / VT500 rules.
 * The ranges are ordered by priority. The function intentionally has a
 * predictable branch pattern to stay hot in the parser loop.
 */
export const classifyByte = (value: number): ByteFlag => {
  let flags = ByteFlag.None;
  for (const spec of BYTE_RANGES) {
    if (value >= spec.start && value <= spec.end) {
      flags |= spec.flag;
    }
  }
  return flags === ByteFlag.None ? ByteFlag.Printable : flags;
};
