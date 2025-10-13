declare module 'devcert' {
  interface CertificateOptions {
    /**
     * When true, devcert returns the CA path in addition to the key/cert pair.
     */
    getCaPath?: boolean
  }

  interface Certificate {
    key: string
    cert: string
    caPath?: string
  }

  function certificateFor(
    domain: string,
    options?: CertificateOptions,
  ): Promise<Certificate>

  function certificateFor(
    domains: readonly string[],
    options?: CertificateOptions,
  ): Promise<Certificate>

  const devcert: {
    certificateFor: typeof certificateFor
  }

  export { certificateFor }
  export default devcert
}
