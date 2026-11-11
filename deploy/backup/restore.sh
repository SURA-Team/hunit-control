#!/usr/bin/env bash
# HUNIT Control — restauração de uma cópia de segurança (specs/001, research R-21, FR-031).
#
#   restore.sh <arquivo>
#
# <arquivo> é o caminho da cópia dentro do container ou só o nome dela (procurada em
# BACKUP_DEST, padrão /backups). Decifra com BACKUP_PASSPHRASE e aplica com
# pg_restore --clean --if-exists numa única transação: ou restaura tudo, ou nada muda.
#
# Rode com o servidor parado (passo a passo no README):
#   docker compose stop server
#   docker compose run --rm --entrypoint bash backup /scripts/restore.sh hunit-AAAAMMDD-HHMMSS.dump.gpg
#   docker compose start server
#
# Nunca escreve a frase das cópias nem a senha do banco na saída.
set -euo pipefail

BACKUP_DEST="${BACKUP_DEST:-/backups}"

log() {
  printf '%s restore: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERRO: $*" >&2
  exit 1
}

[[ $# -eq 1 ]] || fail "informe a cópia a restaurar: restore.sh <arquivo>"
[[ -n "${BACKUP_PASSPHRASE:-}" ]] || fail "defina BACKUP_PASSPHRASE (frase que cifrou as cópias)"
# Sem banco de destino, o pg_restore escreveria o conteúdo na tela em vez de restaurar.
[[ -n "${PGDATABASE:-}" ]] || fail "defina PGDATABASE (banco de destino)"

file="$1"
if [[ "$file" != */* ]]; then
  file="$BACKUP_DEST/$file"
fi
[[ -f "$file" ]] || fail "cópia não encontrada: $file"

log "restaurando $(basename "$file") no banco $PGDATABASE"
gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$file" \
  3<<<"$BACKUP_PASSPHRASE" |
  pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction \
    --exit-on-error --dbname="$PGDATABASE"
log "restauração concluída"
