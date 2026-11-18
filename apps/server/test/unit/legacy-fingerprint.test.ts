/** Impressão digital da simulação (specs/004, FR-005a, research R-08) — tasks.md, T014. */
import { describe, expect, it } from 'vitest';
import { computeFingerprint } from '../../src/legacy-import/fingerprint.js';

const base = {
  workbookSha256: 'a'.repeat(64),
  files: [
    { relative: 'x/1.pdf', sha256: '1'.repeat(64) },
    { relative: 'x/2.pdf', sha256: '2'.repeat(64) },
  ],
  mappings: new Map([
    ['legacy_hml_um', 'HML1'],
    ['legacy_hml_dois', 'HML2'],
  ]),
};

describe('computeFingerprint', () => {
  it('não depende da ordem dos arquivos nem das associações', () => {
    expect(
      computeFingerprint({
        ...base,
        files: [...base.files].reverse(),
        mappings: new Map([...base.mappings].reverse()),
      }),
    ).toBe(computeFingerprint(base));
  });

  it('muda com a planilha, com um arquivo ou com a associação', () => {
    const original = computeFingerprint(base);
    expect(computeFingerprint({ ...base, workbookSha256: 'b'.repeat(64) })).not.toBe(original);
    expect(
      computeFingerprint({
        ...base,
        files: [base.files[0]!, { relative: 'x/2.pdf', sha256: '3'.repeat(64) }],
      }),
    ).not.toBe(original);
    expect(
      computeFingerprint({ ...base, mappings: new Map([['legacy_hml_um', 'HML9']]) }),
    ).not.toBe(original);
  });
});
