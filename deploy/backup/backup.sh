#!/usr/bin/env bash
# HUNIT Control — cópia de segurança do banco (specs/001, research R-21, FR-029 a FR-031).
#
# Roda no serviço "backup" do Docker Compose, na mesma imagem do banco (postgres:17), que já traz
# pg_dump, pg_restore e gpg.
#
#   backup.sh         laço: verifica a cada BACKUP_CHECK_MINUTES (15) minutos
#   backup.sh once    uma verificação só (testes e uso manual)
#
# Em cada verificação: se a cópia mais nova tiver mais de BACKUP_INTERVAL_HOURS horas, ou se não
# houver nenhuma, faz uma nova (pg_dump → gpg com AES-256). Olhar a idade da cópia mais nova, em
# vez de um horário fixo, faz a cópia atrasada logo que o PC volta a ser ligado (FR-029). Depois
# apaga as cópias com mais de BACKUP_RETENTION_DAYS dias, nunca a mais nova.
#
# Variáveis:
#   PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE  conexão com o banco (padrão do PostgreSQL)
#   BACKUP_PASSPHRASE      frase que cifra as cópias (obrigatória; guarde-a fora do PC)
#   BACKUP_INTERVAL_HOURS  idade máxima da cópia mais nova (padrão 24)
#   BACKUP_RETENTION_DAYS  dias que cada cópia é guardada (padrão 30)
#   BACKUP_CHECK_MINUTES   intervalo entre verificações no modo laço (padrão 15)
#   BACKUP_DEST            pasta das cópias dentro do container (padrão /backups)
#
# Só toca em arquivos com o nome hunit-AAAAMMDD-HHMMSS.dump.gpg: a pasta pode ter outras coisas.
# Nunca escreve a frase das cópias nem a senha do banco na saída.
set -euo pipefail

BACKUP_DEST="${BACKUP_DEST:-/backups}"
BACKUP_INTERVAL_HOURS="${BACKUP_INTERVAL_HOURS:-24}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-30}"
BACKUP_CHECK_MINUTES="${BACKUP_CHECK_MINUTES:-15}"
NAME_PATTERN='^hunit-[0-9]{8}-[0-9]{6}\.dump\.gpg$'
# Cópia em andamento: apagada se o script terminar antes de ela ficar pronta.
TMP_FILE=""
trap 'if [[ -n "$TMP_FILE" ]]; then rm -f "$TMP_FILE"; fi' EXIT

log() {
  printf '%s backup: %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

fail() {
  log "ERRO: $*" >&2
  exit 1
}

require_positive_integer() {
  local name="$1" value="$2"
  [[ "$value" =~ ^[1-9][0-9]*$ ]] || fail "$name deve ser um número inteiro maior que zero"
}

check_config() {
  [[ -n "${BACKUP_PASSPHRASE:-}" ]] || fail "defina BACKUP_PASSPHRASE (frase que cifra as cópias)"
  require_positive_integer BACKUP_INTERVAL_HOURS "$BACKUP_INTERVAL_HOURS"
  require_positive_integer BACKUP_RETENTION_DAYS "$BACKUP_RETENTION_DAYS"
  require_positive_integer BACKUP_CHECK_MINUTES "$BACKUP_CHECK_MINUTES"
  mkdir -p "$BACKUP_DEST"
}

# Cópias da pasta, da mais antiga para a mais nova (o nome tem a data em UTC).
list_backups() {
  find "$BACKUP_DEST" -maxdepth 1 -type f -printf '%f\n' | grep -E "$NAME_PATTERN" | sort || true
}

# Data da cópia (segundos desde 1970) a partir do nome.
backup_epoch() {
  local stamp="${1#hunit-}"
  stamp="${stamp%.dump.gpg}"
  date -u -d "${stamp:0:4}-${stamp:4:2}-${stamp:6:2} ${stamp:9:2}:${stamp:11:2}:${stamp:13:2}" +%s
}

# Cifra a entrada padrão com a frase das cópias, sem passá-la na linha de comando.
encrypt_to() {
  gpg --batch --yes --quiet --pinentry-mode loopback --passphrase-fd 3 \
    --symmetric --cipher-algo AES256 --output "$1" 3<<<"$BACKUP_PASSPHRASE"
}

decrypt() {
  gpg --batch --quiet --pinentry-mode loopback --passphrase-fd 3 --decrypt "$1" \
    3<<<"$BACKUP_PASSPHRASE"
}

make_backup() {
  local name
  name="hunit-$(date -u +%Y%m%d-%H%M%S).dump.gpg"
  # Nunca deixa cópia pela metade com o nome final: grava no temporário e renomeia no fim.
  TMP_FILE="$BACKUP_DEST/.${name}.tmp"
  log "fazendo a cópia $name"
  pg_dump --format=custom --no-owner --no-privileges | encrypt_to "$TMP_FILE"
  # Confere que a cópia abre e é um dump válido antes de dar o nome final.
  decrypt "$TMP_FILE" | pg_restore --list >/dev/null
  mv "$TMP_FILE" "$BACKUP_DEST/$name"
  TMP_FILE=""
  log "cópia $name concluída ($(du -h "$BACKUP_DEST/$name" | cut -f1))"
}

remove_old_backups() {
  local now cutoff newest file
  now="$(date -u +%s)"
  cutoff=$((now - BACKUP_RETENTION_DAYS * 86400))
  newest="$(list_backups | tail -n 1)"
  while IFS= read -r file; do
    [[ -n "$file" && "$file" != "$newest" ]] || continue
    if (($(backup_epoch "$file") < cutoff)); then
      rm -f "$BACKUP_DEST/$file"
      log "cópia $file apagada (mais de $BACKUP_RETENTION_DAYS dias)"
    fi
  done < <(list_backups)
}

check_once() {
  local newest age_limit
  # Sobra de uma cópia interrompida (PC desligado no meio).
  find "$BACKUP_DEST" -maxdepth 1 -type f -name '.hunit-*.tmp' -delete
  newest="$(list_backups | tail -n 1)"
  age_limit=$(($(date -u +%s) - BACKUP_INTERVAL_HOURS * 3600))
  if [[ -z "$newest" ]] || (($(backup_epoch "$newest") <= age_limit)); then
    make_backup
  fi
  remove_old_backups
}

check_config
if [[ "${1:-}" == "once" ]]; then
  check_once
  exit 0
fi

log "verificando a cada $BACKUP_CHECK_MINUTES min; nova cópia quando a mais nova passar de $BACKUP_INTERVAL_HOURS h"
while true; do
  # Uma falha (banco parado, pasta indisponível) não derruba o laço: tenta de novo na próxima.
  (check_once) || log "a verificação falhou; nova tentativa em $BACKUP_CHECK_MINUTES min"
  sleep "$((BACKUP_CHECK_MINUTES * 60))"
done
