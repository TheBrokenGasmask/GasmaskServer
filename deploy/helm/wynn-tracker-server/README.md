# wynn-tracker-server Helm chart

Optional. `npm run start` with a local `config.json` still works unchanged.

Deploys the server (HTTP API + `/ws` WebSocket + Discord bot) with an optional
ingress and cert-manager TLS.

## Prerequisites

- An image in GHCR. `.github/workflows/build-image.yml` builds and pushes one
  from the root `Dockerfile` on every push to `tbgm`; no local build needed.
  It publishes a multi-arch manifest (`linux/amd64` + `linux/arm64`), so an
  arm64 node and an x86 node both pull the same tag and get the right binary.
  No `nodeSelector` for architecture is needed.
- A pull secret, while the GitHub repo is private. See `imagePullSecrets` in
  `values.yaml`.
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

## Updating

Pushing to `tbgm` builds a new image and tags it `:latest`. It does **not**
restart anything: Kubernetes has no reason to replace a running pod just
because a tag it already resolved now points somewhere else. Deploying the new
image is one command, once the Actions run is green:

```bash
kubectl -n wynntracker rollout restart deploy/wynn-tracker-wynn-tracker-server
```

The pod restarts, re-pulls `:latest` (`image.pullPolicy: Always`) and comes up
on the new code. `strategy: Recreate` means the old pod stops before the new one
starts, so expect a few seconds of downtime and one Discord gateway reconnect.

To roll back, pin the previous commit's tag instead of restarting:

```bash
helm upgrade wynn-tracker deploy/helm/wynn-tracker-server --reuse-values \
  --set-string image.tag=sha-1a2b3c4
```

Because `:latest` is mutable, the deployed spec does not record which commit is
running. `kubectl -n wynntracker describe pod -l app.kubernetes.io/name=wynn-tracker-server`
shows the resolved image digest, which GHCR's package page maps back to a commit.

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
