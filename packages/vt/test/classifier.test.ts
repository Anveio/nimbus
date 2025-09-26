import { describe, expect, it } from "vitest";
import { classifyByte } from "../src/classifier";
import { ByteFlag } from "../src/types";

describe("classifyByte", () => {
  it("categorises ESC as escape", () => {
    const flags = classifyByte(0x1b);
    expect(flags & ByteFlag.Escape).not.toBe(0);
    expect(flags & ByteFlag.C0Control).not.toBe(0);
  });

  it("categorises printable ASCII", () => {
    const flags = classifyByte(0x41);
    expect(flags & ByteFlag.Printable).not.toBe(0);
  });

  it("categorises C0 controls", () => {
    expect(classifyByte(0x07) & ByteFlag.StringTerminator).not.toBe(0);
    expect(classifyByte(0x1f) & ByteFlag.C0Control).not.toBe(0);
  });

  it("prioritises delete over printable", () => {
    expect(classifyByte(0x7f) & ByteFlag.Delete).not.toBe(0);
  });

  it("prioritises final bytes after parameters", () => {
    expect(classifyByte(0x41) & ByteFlag.Printable).not.toBe(0);
    expect(classifyByte(0x40) & ByteFlag.Final).not.toBe(0);
  });
});
