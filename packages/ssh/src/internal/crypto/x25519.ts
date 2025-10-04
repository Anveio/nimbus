const FIELD_PRIME = (1n << 255n) - 19n
const A24 = 121665n

function clampScalar(input: Uint8Array): Uint8Array {
  if (input.length !== 32) {
    throw new RangeError('Curve25519 private scalar must be 32 bytes')
  }
  const scalar = new Uint8Array(input)
  const first = scalar[0] ?? 0
  let last = scalar[31] ?? 0
  scalar[0] = first & 248
  last &= 127
  last |= 64
  scalar[31] = last
  return scalar
}

function decodeLittleEndian(bytes: Uint8Array): bigint {
  let value = 0n
  for (let i = bytes.length - 1; i >= 0; i -= 1) {
    value = (value << 8n) + BigInt(bytes[i] ?? 0)
  }
  return value
}

function encodeLittleEndian(value: bigint): Uint8Array {
  const result = new Uint8Array(32)
  let temp = value
  for (let i = 0; i < 32; i += 1) {
    result[i] = Number(temp & 0xffn)
    temp >>= 8n
  }
  return result
}

function mod(value: bigint): bigint {
  const result = value % FIELD_PRIME
  return result >= 0n ? result : result + FIELD_PRIME
}

function modAdd(a: bigint, b: bigint): bigint {
  return mod(a + b)
}

function modSub(a: bigint, b: bigint): bigint {
  return mod(a - b)
}

function modMul(a: bigint, b: bigint): bigint {
  return mod(a * b)
}

function modPow(base: bigint, exponent: bigint): bigint {
  let result = 1n
  let b = mod(base)
  let e = exponent
  while (e > 0n) {
    if (e & 1n) {
      result = modMul(result, b)
    }
    e >>= 1n
    b = modMul(b, b)
  }
  return result
}

function modInv(value: bigint): bigint {
  // Fermat little theorem: a^(p-2) mod p
  return modPow(value, FIELD_PRIME - 2n)
}

function montgomeryLadder(scalar: Uint8Array, uBytes: Uint8Array): Uint8Array {
  const k = decodeLittleEndian(scalar)
  const u = decodeLittleEndian(uBytes)

  const x1 = u
  let x2 = 1n
  let z2 = 0n
  let x3 = u
  let z3 = 1n
  let swap = 0n

  for (let t = 254; t >= 0; t -= 1) {
    const kBit = (k >> BigInt(t)) & 1n
    if (swap !== kBit) {
      const tempX = x2
      x2 = x3
      x3 = tempX
      const tempZ = z2
      z2 = z3
      z3 = tempZ
      swap = kBit
    }

    const a = modAdd(x2, z2)
    const aa = modMul(a, a)
    const b = modSub(x2, z2)
    const bb = modMul(b, b)
    const e = modSub(aa, bb)
    const c = modAdd(x3, z3)
    const d = modSub(x3, z3)
    const da = modMul(d, a)
    const cb = modMul(c, b)
    const x3New = modMul(modAdd(da, cb), modAdd(da, cb))
    const z3New = modMul(x1, modMul(modSub(da, cb), modSub(da, cb)))
    const x2New = modMul(aa, bb)
    const z2New = modMul(e, modAdd(aa, modMul(A24, e)))

    x3 = x3New
    z3 = z3New
    x2 = x2New
    z2 = z2New
  }

  if (swap !== 0n) {
    const tempX = x2
    x2 = x3
    x3 = tempX
    const tempZ = z2
    z2 = z3
    z3 = tempZ
  }

  const result = modMul(x2, modInv(z2))
  return encodeLittleEndian(result)
}

export function scalarMultBase(scalar: Uint8Array): Uint8Array {
  const clamped = clampScalar(scalar)
  const basePoint = new Uint8Array(32)
  basePoint[0] = 9
  return montgomeryLadder(clamped, basePoint)
}

export function scalarMult(
  scalar: Uint8Array,
  publicKey: Uint8Array,
): Uint8Array {
  const clamped = clampScalar(scalar)
  return montgomeryLadder(clamped, publicKey)
}

export { clampScalar }
