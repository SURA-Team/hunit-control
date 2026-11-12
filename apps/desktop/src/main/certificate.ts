/**
 * Leitura do certificado raiz do servidor escolhido na configuração (specs/002, FR-002, research
 * R-03). É a autoridade interna do Caddy do servidor (feature 001, R-20): o certificado é público,
 * não é segredo. O app guarda o PEM e confia só nele para falar com o servidor.
 */
import { X509Certificate } from 'node:crypto';
import type { CertificateInfo } from '../shared/ipc-types.js';

export type CertificateProblem = 'invalid' | 'not_authority' | 'expired';

const MESSAGES: Record<CertificateProblem, string> = {
  invalid: 'O arquivo não é um certificado válido (formato PEM, como o hunit-raiz.crt).',
  not_authority:
    'O arquivo é um certificado, mas não de autoridade. Use o certificado raiz exportado do servidor (hunit-raiz.crt).',
  expired: 'O certificado raiz está vencido. Exporte o certificado raiz do servidor de novo.',
};

export class CertificateError extends Error {
  constructor(readonly reason: CertificateProblem) {
    super(MESSAGES[reason]);
    this.name = 'CertificateError';
  }
}

export interface ReadCertificate {
  /** O certificado normalizado (PEM). */
  pem: string;
  info: CertificateInfo;
}

/**
 * Descreve um certificado já guardado, sem recusar o vencido: a configuração mostra o que está lá
 * (inclusive a validade vencida) para o operador trocar. `null` = não é um certificado.
 */
export function describeCertificate(pem: string): CertificateInfo | null {
  try {
    const certificate = new X509Certificate(pem.trim());
    return {
      fingerprint256: certificate.fingerprint256,
      subject: certificate.subject,
      issuer: certificate.issuer,
      validTo: certificate.validToDate.toISOString(),
      isCertificateAuthority: certificate.ca,
    };
  } catch {
    return null;
  }
}

/**
 * Lê o certificado e devolve o que o operador confere na tela.
 *
 * @throws CertificateError se não for um certificado PEM, não for de autoridade ou estiver vencido.
 */
export function readCertificate(content: string, now: Date = new Date()): ReadCertificate {
  if (!content.includes('-----BEGIN CERTIFICATE-----')) throw new CertificateError('invalid');

  let certificate: X509Certificate;
  try {
    certificate = new X509Certificate(content.trim());
  } catch {
    throw new CertificateError('invalid');
  }

  if (!certificate.ca) throw new CertificateError('not_authority');
  if (certificate.validToDate.getTime() <= now.getTime()) throw new CertificateError('expired');

  return {
    pem: certificate.toString(),
    info: {
      fingerprint256: certificate.fingerprint256,
      subject: certificate.subject,
      issuer: certificate.issuer,
      validTo: certificate.validToDate.toISOString(),
      isCertificateAuthority: true,
    },
  };
}
