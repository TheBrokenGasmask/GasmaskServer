# wynn-tracker-server Helm chart

Optional. `npm run start` with a local `config.json` still works unchanged.

Deploys the server (HTTP API + `/ws` WebSocket + Discord bot) with an optional
ingress and cert-manager TLS.

## Prerequisites

- An image built from the `Dockerfile` at the repo root.
- A reachable MySQL/MariaDB instance. Not deployed by this chart.
- An ingress controller, if `ingress.enabled=true`.
- cert-manager, if `ingress.tls.mode=cert-manager`. Verify the controller pods
  are running, not just the CRDs — orphaned CRDs will pass the chart's check
  while nothing can actually issue a certificate.

## Install

```bash
helm install wynn-tracker deploy/helm/wynn-tracker-server \
  --namespace wynntracker --create-namespace -f my-values.yaml \
  --set-string secrets.discordToken=... \
  --set-string secrets.sqlPassword=... \
  --set-string secrets.wynncraftToken=...
```

Secrets passed with `--set-string` are not stored in the values file, so they
must be supplied again on every `helm upgrade` or the app will start with an
empty token and password.

## Configuration

The app reads `/app/config.json` only; it has no environment-variable support.
The chart renders that file into a Secret and mounts it.

- `config` is copied into `config.json` verbatim, so new keys need no chart change.
- `secrets` is merged on top: `discordToken` → `token`, `wynncraftToken` →
  `wynncraft-token`, `sqlPassword` → `sql.password`, `chatBridgeWebhookUrl` →
  `chat-bridge.webhook-url`.
- `existingSecret` mounts a Secret you manage instead. `config.host-port` must
  still match it, since the chart cannot read an external Secret.
- `config.host-port` drives the container port, Service target and probes.

## TLS

`ingress.tls.mode`:

- `cert-manager` — creates an ACME ClusterIssuer and annotates the ingress.
  Set `certManager.createIssuer=false` and `certManager.issuerName` to reuse an
  existing issuer. Use `certManager.server=https://acme-staging-v02.api.letsencrypt.org/directory`
  while testing.
- `existing` — bring your own `kubernetes.io/tls` Secret via
  `ingress.tls.secretName`, e.g. one loaded from certbot output.
- `none` — TLS terminated elsewhere.

## Notes

- `replicaCount` above 1 is rejected: auth tokens are in-memory and a second
  replica would open a duplicate Discord gateway connection.
- Probes are TCP. The app has no health endpoint and binds its port before the
  database connects, so a ready pod is not proof it is working.
- On Traefik the `ingress.websocket` annotations are inert and unnecessary; the
  app's 30s heartbeat keeps connections inside Traefik's 180s idle timeout.
