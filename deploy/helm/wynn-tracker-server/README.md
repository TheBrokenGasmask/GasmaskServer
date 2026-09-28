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

Pushing to `tbgm` deploys itself. `.github/workflows/build-image.yml` builds
both architectures, publishes the manifest, then its `deploy` job pins the new
immutable tag onto the running Deployment and waits for the rollout:

```bash
kubectl -n wynntracker set image deploy/wynn-tracker-wynn-tracker-server \
  server=ghcr.io/thebrokengasmask/gasmaskserver:sha-1a2b3c4
```

`set image` rather than `rollout restart`, so the live spec records which commit
is running and `kubectl rollout undo` is a real rollback. If the new pod fails
to become ready within 5 minutes the workflow goes red, so a broken deploy is
visible in the Actions tab rather than only in the cluster.

`strategy: Recreate` means the old pod stops before the new one starts: a few
seconds of downtime and one Discord gateway reconnect per deploy.

### Credentials

The `deploy` job authenticates as the `ci-deployer` ServiceAccount from
[`deploy/k8s/ci-deployer.yaml`](../../k8s/ci-deployer.yaml), whose RBAC permits
patching this one Deployment and watching rollouts — it cannot read Secrets, so
the token grants no access to `config.json`, the Discord token or the SQL
password. Apply it once, then set three repository secrets:

| Secret | Value |
| --- | --- |
| `KUBE_SERVER` | API server URL, e.g. `https://<ip>:6443` |
| `KUBE_CA` | cluster CA certificate, base64 (as stored in the token Secret) |
| `KUBE_TOKEN` | the `ci-deployer` ServiceAccount token |

With `KUBE_TOKEN` unset the `deploy` job skips itself and the build still runs,
so the workflow is usable before the cluster side is wired up.

### Rolling back

```bash
kubectl -n wynntracker rollout undo deploy/wynn-tracker-wynn-tracker-server
```

Note that CI pins a `sha-` tag directly on the Deployment, which the Helm
release does not know about. A later `helm upgrade` resets the image to
`:latest` — harmless, since `pullPolicy: Always` still fetches the newest
build, but the recorded commit is lost until the next push re-pins it.

Manual deploy, if CI is unavailable:

```bash
kubectl -n wynntracker rollout restart deploy/wynn-tracker-wynn-tracker-server
```

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
