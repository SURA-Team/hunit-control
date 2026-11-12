/**
 * Leitura do certificado raiz escolhido na configuração (specs/002, T015, FR-002, research R-03):
 * o app mostra a impressão digital, o emissor e a validade para o operador conferir, e só aceita
 * o certificado de uma autoridade dentro da validade.
 */
import { X509Certificate } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { CertificateError, readCertificate } from '../../src/main/certificate.js';
import {
  createAuthority,
  createTestCertificates,
  type TestCertificates,
} from '../helpers/certificates.js';

let certificates: TestCertificates;

beforeAll(async () => {
  certificates = await createTestCertificates();
});

describe('readCertificate', () => {
  it('lê o certificado da autoridade e devolve o que o operador confere', () => {
    const { authority } = certificates;
    const reference = new X509Certificate(authority.certificatePem);

    const result = readCertificate(authority.certificatePem);

    expect(result.info).toEqual({
      fingerprint256: reference.fingerprint256,
      subject: expect.stringContaining('Autoridade de teste do HUNIT Control') as string,
      issuer: expect.stringContaining('Autoridade de teste do HUNIT Control') as string,
      validTo: reference.validToDate.toISOString(),
      isCertificateAuthority: true,
    });
    expect(result.pem).toContain('-----BEGIN CERTIFICATE-----');
  });

  it('aceita o arquivo com espaços e linhas em branco em volta', () => {
    const result = readCertificate(`\n\n  ${certificates.authority.certificatePem}\n\n`);

    expect(result.info.isCertificateAuthority).toBe(true);
  });

  it('recusa certificado que não é de autoridade', () => {
    expect(() => readCertificate(certificates.leafOnly)).toThrow(
      expect.objectContaining({ reason: 'not_authority' }) as Error,
    );
  });

  it('recusa arquivo que não é um certificado PEM válido', () => {
    for (const content of [
      '',
      'não é um certificado',
      '-----BEGIN CERTIFICATE-----\nlixo\n-----END CERTIFICATE-----',
    ]) {
      expect(() => readCertificate(content)).toThrow(CertificateError);
      expect(() => readCertificate(content)).toThrow(
        expect.objectContaining({ reason: 'invalid' }) as Error,
      );
    }
  });

  it('recusa autoridade vencida', async () => {
    const day = 24 * 60 * 60 * 1000;
    const expired = await createAuthority('Autoridade vencida', {
      notBefore: new Date(Date.now() - 400 * day),
      notAfter: new Date(Date.now() - day),
    });

    expect(() => readCertificate(expired.certificatePem)).toThrow(
      expect.objectContaining({ reason: 'expired' }) as Error,
    );
  });
});
