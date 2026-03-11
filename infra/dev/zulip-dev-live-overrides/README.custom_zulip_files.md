The files in this directory are the minimal DevLive bootstrap overrides
required for the Foundry Core dev server hosted on `meridian-zulip-dev-01`.

Product code is deployed from `services/foundry-core/app` into
`/opt/meridian/apps/zulip-dev/dev_source_foundry`.

These overrides only provide the DevLive entrypoint that starts Zulip's
`run-dev` flow against that bind-mounted source tree.
