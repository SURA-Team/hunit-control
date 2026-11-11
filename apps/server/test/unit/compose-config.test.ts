/**
 * Configuração de implantação (T064): quem publica porta no `docker-compose.yml`, o proxy HTTPS e
 * a cópia de segurança (SC-013, research R-20 e R-21).
 *
 * Mesmo padrão de `docker-image-version.test.ts`: lê os arquivos do repositório, sem Docker.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

const readFromRepoRoot = (relativePath: string): string =>
  readFileSync(new URL(`../../../../${relativePath}`, import.meta.url), 'utf8');

type PortEntry = string | number | { host_ip?: string; published?: string | number };

interface ComposeService {
  image?: string;
  ports?: PortEntry[];
  volumes?: Array<string | { source?: string; target?: string; read_only?: boolean }>;
}

const compose = parse(readFromRepoRoot('docker-compose.yml')) as {
  services: Record<string, ComposeService>;
};
const services = compose.services;

/**
 * Endereço do host em que a porta é publicada; `null` = todas as interfaces.
 *
 * Formatos curtos: "3000", "8080:3000", "127.0.0.1:8080:3000", "${PORT:-3000}:3000",
 * "127.0.0.1:${PORT:-3000}:3000". As variáveis do Compose têm ":" dentro, por isso são retiradas
 * antes de separar os campos.
 */
function hostIpOf(entry: PortEntry): string | null {
  if (typeof entry === 'object') return entry.host_ip ?? null;
  const fields = String(entry)
    .replace(/\$\{[^}]*\}/g, 'VAR')
    .split(':');
  return fields.length === 3 ? (fields[0] ?? null) : null;
}

const isAllInterfaces = (hostIp: string | null) => hostIp === null || hostIp === '0.0.0.0';

describe('docker-compose.yml: portas (SC-013, R-20)', () => {
  it('tem os serviços server, db, proxy e backup', () => {
    expect(Object.keys(services).sort()).toEqual(['backup', 'db', 'proxy', 'server']);
  });

  it('publica a porta HTTP do server só em 127.0.0.1', () => {
    const ports = services['server']?.ports ?? [];
    expect(ports.length).toBeGreaterThan(0);
    for (const port of ports) expect(hostIpOf(port)).toBe('127.0.0.1');
  });

  it('só o proxy publica porta em todas as interfaces', () => {
    for (const [name, service] of Object.entries(services)) {
      const exposed = (service.ports ?? []).filter((port) => isAllInterfaces(hostIpOf(port)));
      if (name === 'proxy') {
        expect(exposed.length, 'o proxy precisa receber as conexões da rede').toBeGreaterThan(0);
      } else {
        expect(exposed, `o serviço "${name}" não pode publicar porta para a rede`).toEqual([]);
      }
    }
  });

  it('o proxy publica só a porta HTTPS (sem HTTP na porta 80)', () => {
    const ports = services['proxy']?.ports ?? [];
    expect(ports).toHaveLength(1);
    expect(ports[0]).toMatch(/:443$/);
  });
});

describe('proxy HTTPS (FR-032, R-20)', () => {
  const caddyfile = readFromRepoRoot('deploy/caddy/Caddyfile');

  it('usa a imagem oficial do Caddy numa versão exata', () => {
    expect(services['proxy']?.image).toMatch(/^caddy:\d+\.\d+\.\d+(-alpine)?$/);
  });

  it('emite o certificado pela autoridade interna do Caddy, sem instalar a CA no sistema', () => {
    expect(caddyfile).toMatch(/^\s*tls internal\s*$/m);
    expect(caddyfile).toMatch(/^\s*skip_install_trust\s*$/m);
  });

  it('atende o nome do PC e localhost e repassa ao server sem acumular respostas (SSE)', () => {
    expect(caddyfile).toMatch(/^\{\$SERVER_HOSTNAME\}, localhost \{$/m);
    expect(caddyfile).toMatch(/reverse_proxy server:3000 \{[^}]*flush_interval -1/);
  });

  it('guarda a autoridade certificadora num volume nomeado', () => {
    const volumes = (services['proxy']?.volumes ?? []).map(String);
    expect(volumes).toContain('caddy-data:/data');
  });
});

describe('cópia de segurança (FR-030, R-21)', () => {
  it('usa a mesma imagem do banco, para o pg_dump ter a versão do servidor', () => {
    expect(services['backup']?.image).toBeDefined();
    expect(services['backup']?.image).toBe(services['db']?.image);
  });

  it('monta os scripts somente leitura e a pasta de destino em /backups', () => {
    const volumes = (services['backup']?.volumes ?? []).map(String);
    expect(volumes).toContain('./deploy/backup:/scripts:ro');
    expect(volumes.some((volume) => /^\$\{BACKUP_DIR[^}]*\}:\/backups$/.test(volume))).toBe(true);
  });
});
