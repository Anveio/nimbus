import { ParserState } from "../types";

/**
 * Low-level mutable parser state. Each field maps to a primitive described by
 * the VT500 state diagram.
 */
export interface ParserContext {
  state: ParserState;
  collectBuffer: number[];
  params: number[];
  currentParam: number | null;
  hasPrivatePrefix: boolean;
  intermediates: number[];
}

export const createInitialContext = (): ParserContext => ({
  state: ParserState.Ground,
  collectBuffer: [],
  params: [],
  currentParam: null,
  hasPrivatePrefix: false,
  intermediates: [],
});
