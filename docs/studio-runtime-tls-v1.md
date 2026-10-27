# Private Studio runtime TLS — first-version preflight

Date: October 15, 2026. This is a transport repair for private Studio only, not authenticated live-provider acceptance or public production TLS.

## Observed blocker and repair

A real Node TLS-only connection from the actual running Studio image to `api.anthropic.com:443` failed with `UNABLE_TO_GET_ISSUER_CERT_LOCALLY`. The socket closed. No HTTP request, credential, Messages API request or model submission was sent.

The previously exported **public** Zscaler root was rechecked against this Mac's administrative trust using `security verify-cert -p basic`. It contains exactly one certificate and no private key. SHA-256: `7c250d88e7c99564c0ed1e335755f26fe5c2d7f9cc1cfa184c51af063d68cfab`.

An isolated read-only, UID-1000 one-shot using the exact accepted image succeeded when that certificate was supplied through `NODE_EXTRA_CA_CERTS`. It mounted no private state or credentials and was removed afterward. The same repair was then applied to private Studio through an explicit optional Compose override. The actual running service now negotiates **TLS 1.3**, with `rejectUnauthorized:true`, original-host identity validation and confirmed socket closure. No TLS check, hostname check or certificate validation was disabled.

This extends Node's trust with an already host-admin-trusted corporate CA. It does not promise a direct uninspected vendor channel; the host's corporate trust/inspection policy still applies. Actual account/key/model access, completion behavior and privacy authorization remain separate.

## Explicit local configuration

- Base staging remains `deploy/studio-docker/staging.compose.yml`, pinned to immutable image `sha256:5029e89247bb09d1340f23ba4440e80f4521cd8ff05c2f939588ff7a07e0bbaf`.
- Optional override: `deploy/studio-docker/staging.trust.compose.yml`.
- Machine-local public CA: `deploy/studio-docker/trust/host-approved-public-ca.pem`, readable 0644, ignored by Git. No private keys were exported.
- Machine-local nonsecret path setting: `deploy/studio-docker/.env.studio-trust.local`, also ignored by Git.
- Inside only Studio: `NODE_EXTRA_CA_CERTS=/etc/studio/trust/host-approved-public-ca.pem`, with an explicit read-only bind and `create_host_path:false`.

The normalized merged configuration differs only by that environment field and public read-only bind. No image/dependency/source bind, network, port, user, capability, host identity, reviewer or execution grant was added. The default base file does not automatically trust a machine-specific certificate.

Maintenance command, **not needed for normal testing**:

```sh
docker compose --env-file deploy/studio-docker/.env.studio-trust.local \
  -f deploy/studio-docker/staging.compose.yml \
  -f deploy/studio-docker/staging.trust.compose.yml \
  up -d --no-build --pull never --no-deps --wait studio-staging
```

This can recreate Studio and clear session-only provider keys. Do not run it during an authoring session. Never remove the private volume or operate on the OS/companion as part of this repair. A missing/unreadable certificate must fail rather than create a host directory, trust an arbitrary replacement or disable TLS.

## Preservation and bounded verification

Before the update, authenticated metadata confirmed there was no configured session key to lose. Only Studio's sole state writer was stopped. A read-only network-none witness matched all four original private files' bytes/paths/modes/owners. After recreation, both existing drafts and both original runs/history were read back exactly. Built HTML/JS/CSS, CSP, device policy and no-selection state are unchanged. No saved run or external effect was replayed. The companion and OS retained their exact IDs, images and start times.

A permanent Node configuration-contract regression was observed failing before the override existed and passing afterward. Evidence includes the actual before/isolated/after TLS results, public-CA trust metadata, stopped-writer witness, original-record fingerprints and filtered before/after service metadata. This is not proof of the authenticated browser key-save flow or a live Anthropic completion.
