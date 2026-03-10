# Licensing Map

Unless a file or subdirectory says otherwise, Foundry-authored code in this
repository is licensed under Elastic License 2.0. The repo includes imported and
derived third-party code that keeps its original licensing terms.

The main carveouts are:

- `services/foundry-core/app`: Apache License 2.0. See
  `services/foundry-core/app/LICENSE`.
- `infra/apps/foundry-coder`: build and patch material for a Coder-derived AGPL
  fork. Keep the upstream AGPL notices and obligations with any redistributed
  modified source or binaries produced from that subtree.
- Any vendored or generated third-party assets that ship with their own license
  headers or bundled notice files remain under those original terms.

If you are unsure whether a file is Foundry-authored or imported, treat the
more specific directory-level license notice as controlling.
