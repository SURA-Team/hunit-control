/**
 * O que foi recebido do Hunit no momento de uma falha (FR-024): a tela (captura e HTML) ou a
 * resposta que não foi reconhecida. Pelo menos um dos campos deve estar preenchido para a
 * evidência ser gravada.
 */
export interface EvidenceMaterial {
  /** Captura da tela em PNG, com os campos de entrada cobertos. */
  screenshot?: Buffer;
  /** HTML da tela, sem o valor dos campos de entrada. */
  html?: string;
  /** Resposta do Hunit que não foi reconhecida (texto, normalmente JSON). */
  response?: string;
}

/** Indica se há algo para gravar. Conteúdo vazio (captura ou texto sem bytes) não conta. */
export function hasEvidenceMaterial(material: EvidenceMaterial | null | undefined): boolean {
  if (!material) return false;
  return [material.screenshot, material.html, material.response].some(
    (content) => content !== undefined && content.length > 0,
  );
}
