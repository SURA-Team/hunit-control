/**
 * Certificados para os testes do app (specs/002, T014, research R-12): gerados na hora com
 * `@peculiar/x509` — nenhuma chave privada fica no repositório. Imitam a autoridade interna do
 * Caddy do servidor de produção (feature 001, R-20).
 */
// O @peculiar/x509 usa o tsyringe, que exige este polyfill antes de carregar.
import 'reflect-metadata';
import { webcrypto } from 'node:crypto';
import * as x509 from '@peculiar/x509';

/**
 * O par de chaves no tipo que o @peculiar/x509 espera. Este arquivo é compilado com e sem os tipos
 * do DOM (testes do processo principal e de ponta a ponta), e os tipos de criptografia do Node e
 * do DOM não se misturam: as conversões ficam só nas bordas com o `webcrypto` do Node.
 */
type CryptoKeyPair = Parameters<typeof x509.X509CertificateGenerator.createSelfSigned>[0]['keys'];

const setCryptoProvider = x509.cryptoProvider.set.bind(x509.cryptoProvider) as (
  crypto: unknown,
) => void;
setCryptoProvider(webcrypto);

const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256', hash: 'SHA-256' } as const;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface TestAuthority {
  name: string;
  certificatePem: string;
  certificate: x509.X509Certificate;
  keys: CryptoKeyPair;
}

export interface TestServerCertificate {
  certificatePem: string;
  privateKeyPem: string;
}

export interface TestCertificates {
  /** Autoridade "do servidor": a raiz que o app guarda na configuração. */
  authority: TestAuthority;
  /** Outra autoridade, que o app não conhece. */
  strangeAuthority: TestAuthority;
  /** Certificado válido para `localhost` e `127.0.0.1`, emitido pela autoridade do servidor. */
  server: TestServerCertificate;
  /** Emitido pela autoridade do servidor, mas para outro nome. */
  otherName: TestServerCertificate;
  /** Emitido pela autoridade do servidor para `localhost`, mas vencido. */
  expired: TestServerCertificate;
  /** Para `localhost`, mas emitido pela outra autoridade. */
  strange: TestServerCertificate;
  /** Certificado de servidor (não é autoridade), para testar a recusa na configuração. */
  leafOnly: string;
}

async function newKeys(): Promise<CryptoKeyPair> {
  const keys = await webcrypto.subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  return keys as unknown as CryptoKeyPair;
}

async function privateKeyPem(keys: CryptoKeyPair): Promise<string> {
  const der = await webcrypto.subtle.exportKey('pkcs8', keys.privateKey);
  return x509.PemConverter.encode([{ type: 'PRIVATE KEY', rawData: der }]);
}

export async function createAuthority(
  commonName: string,
  validity: { notBefore?: Date; notAfter?: Date } = {},
): Promise<TestAuthority> {
  const keys = await newKeys();
  const now = Date.now();
  const certificate = await x509.X509CertificateGenerator.createSelfSigned({
    name: `CN=${commonName}`,
    keys,
    notBefore: validity.notBefore ?? new Date(now - DAY_MS),
    notAfter: validity.notAfter ?? new Date(now + 3650 * DAY_MS),
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(true, undefined, true),
      new x509.KeyUsagesExtension(
        x509.KeyUsageFlags.keyCertSign | x509.KeyUsageFlags.cRLSign,
        true,
      ),
      await x509.SubjectKeyIdentifierExtension.create(keys.publicKey),
    ],
  });
  return { name: commonName, certificatePem: certificate.toString('pem'), certificate, keys };
}

export interface IssueOptions {
  dns?: string[];
  ip?: string[];
  notBefore?: Date;
  notAfter?: Date;
}

export async function issueServerCertificate(
  authority: TestAuthority,
  options: IssueOptions,
): Promise<TestServerCertificate> {
  const keys = await newKeys();
  const now = Date.now();
  const names: x509.JsonGeneralName[] = [
    ...(options.dns ?? []).map((value) => ({ type: 'dns' as const, value })),
    ...(options.ip ?? []).map((value) => ({ type: 'ip' as const, value })),
  ];
  const certificate = await x509.X509CertificateGenerator.create({
    subject: `CN=${names[0]?.value ?? 'servidor'}`,
    issuer: authority.certificate.subject,
    publicKey: keys.publicKey,
    signingKey: authority.keys.privateKey,
    notBefore: options.notBefore ?? new Date(now - DAY_MS),
    notAfter: options.notAfter ?? new Date(now + 30 * DAY_MS),
    signingAlgorithm: ALGORITHM,
    extensions: [
      new x509.BasicConstraintsExtension(false, undefined, true),
      new x509.KeyUsagesExtension(x509.KeyUsageFlags.digitalSignature, true),
      new x509.ExtendedKeyUsageExtension([x509.ExtendedKeyUsage.serverAuth]),
      new x509.SubjectAlternativeNameExtension(names),
      await x509.AuthorityKeyIdentifierExtension.create(authority.certificate),
    ],
  });
  return { certificatePem: certificate.toString('pem'), privateKeyPem: await privateKeyPem(keys) };
}

/** Todos os certificados usados pelos testes, gerados uma vez por arquivo de teste. */
export async function createTestCertificates(): Promise<TestCertificates> {
  const authority = await createAuthority('Autoridade de teste do HUNIT Control');
  const strangeAuthority = await createAuthority('Autoridade estranha');
  const local = { dns: ['localhost'], ip: ['127.0.0.1'] };
  const [server, otherName, expired, strange] = await Promise.all([
    issueServerCertificate(authority, local),
    issueServerCertificate(authority, { dns: ['outro-servidor.example'] }),
    issueServerCertificate(authority, {
      ...local,
      notBefore: new Date(Date.now() - 60 * DAY_MS),
      notAfter: new Date(Date.now() - 30 * DAY_MS),
    }),
    issueServerCertificate(strangeAuthority, local),
  ]);
  return {
    authority,
    strangeAuthority,
    server,
    otherName,
    expired,
    strange,
    leafOnly: server.certificatePem,
  };
}
