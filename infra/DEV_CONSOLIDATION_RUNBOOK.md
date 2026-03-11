# Foundry Dev Consolidation Runbook

## Current topology (confirmed March 11, 2026)

- `meridian-zulip-dev-01` (`5.161.60.86`) hosts both:
  - `zulip-dev-zulip-dev-live-1`
  - `zulip-dev-zulip-1`
- `meridian-apps-01` (`178.156.253.167`) hosts:
  - `foundry-server.service`
  - the legacy `meridian-coder-orchestrator` container

The important correction is that the plain `zulip-dev` service is not on the
apps host. Both the legacy Zulip service and DevLive are on the dedicated
Zulip dev server.

## Target topology

- Keep `zulip-dev-live` as the only active Foundry Core dev surface.
- Stop using the plain `zulip-dev` service for validation once DevLive is
  serving the current Foundry Core source.
- Run a dedicated `foundry-server-dev.service` on the apps host, exposed at a
  public dev hostname, without overwriting the current `foundry-server.service`.
- Validate through Foundry desktop against:
  - Foundry Core on `zulip-dev-live`
  - Foundry Server dev on the apps host

## Why this split remains valid

Foundry still uses `services/foundry-core/app` as the chat/core substrate.
Consolidation means:

- one active Core dev host: `zulip-dev-live`
- one active Foundry control-plane dev service
- one desktop client

It does not mean deleting Foundry Core or forcing all development through the
legacy Meridian Zulip overlay path.

## New scripts

- [deploy-foundry-core-devlive.sh](/Users/aldrinclement/Documents/programming/ideas-space/foundry/infra/scripts/deploy-foundry-core-devlive.sh)
  - syncs `services/foundry-core/app` into `/opt/meridian/apps/zulip-dev/dev_source_foundry`
  - syncs the DevLive bootstrap overrides into `custom_zulip_files_foundry`
  - restarts `zulip-dev-live`
- [deploy-foundry-server-sidecar-dev.sh](/Users/aldrinclement/Documents/programming/ideas-space/foundry/infra/scripts/deploy-foundry-server-sidecar-dev.sh)
  - deploys a sidecar `foundry-server-dev.service`
  - keeps the current `foundry-server.service` untouched
  - exposes the dev service through Caddy at a public hostname
- [deploy-foundry-dev-stack.sh](/Users/aldrinclement/Documents/programming/ideas-space/foundry/infra/scripts/deploy-foundry-dev-stack.sh)
  - wrapper that deploys both Core DevLive and Foundry Server dev
- [wind-down-legacy-zulip-dev.sh](/Users/aldrinclement/Documents/programming/ideas-space/foundry/infra/scripts/wind-down-legacy-zulip-dev.sh)
  - stops and removes the plain `zulip` service only after DevLive is healthy

## Recommended cutover sequence

1. Deploy Foundry Core into DevLive:

```bash
cd /Users/aldrinclement/Documents/programming/ideas-space/foundry
./infra/scripts/deploy-foundry-core-devlive.sh 5.161.60.86
```

2. Deploy Foundry Server dev side-by-side on the apps host:

```bash
cd /Users/aldrinclement/Documents/programming/ideas-space/foundry
./infra/scripts/deploy-foundry-server-sidecar-dev.sh \
  178.156.253.167 \
  foundry-server-dev.178.156.253.167.sslip.io \
  https://zulip-dev-live.5.161.60.86.sslip.io
```

3. Or run the combined wrapper:

```bash
cd /Users/aldrinclement/Documents/programming/ideas-space/foundry
./infra/scripts/deploy-foundry-dev-stack.sh \
  5.161.60.86 \
  178.156.253.167
```

4. After desktop validation passes, wind down the legacy Zulip service:

```bash
cd /Users/aldrinclement/Documents/programming/ideas-space/foundry
./infra/scripts/wind-down-legacy-zulip-dev.sh 5.161.60.86
```

## Validation checklist

Validate in Foundry desktop against the dev stack:

1. Connect a server account to `zulip-dev-live`.
2. Open agent settings and verify provider list loads.
3. Connect Codex via OAuth.
4. Disconnect Codex and confirm the card returns to `Not connected`.
5. Reconnect and select a model.
6. Start a supervisor flow that spawns a delegate/worker.
7. Confirm the spawned runtime inherits Codex access and the selected model.

Do not wind down the legacy `zulip` service until this checklist passes.
