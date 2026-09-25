{{/* Chart name, overridable. */}}
{{- define "wynn-tracker-server.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Fully qualified release name. */}}
{{- define "wynn-tracker-server.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{- define "wynn-tracker-server.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "wynn-tracker-server.labels" -}}
helm.sh/chart: {{ include "wynn-tracker-server.chart" . }}
{{ include "wynn-tracker-server.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end -}}

{{- define "wynn-tracker-server.selectorLabels" -}}
app.kubernetes.io/name: {{ include "wynn-tracker-server.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}

{{- define "wynn-tracker-server.serviceAccountName" -}}
{{- if .Values.serviceAccount.create -}}
{{- default (include "wynn-tracker-server.fullname" .) .Values.serviceAccount.name -}}
{{- else -}}
{{- default "default" .Values.serviceAccount.name -}}
{{- end -}}
{{- end -}}

{{/*
The port the app listens on. config.host-port is the single source of truth:
it lands in config.json, and the container port, Service targetPort and probes
are all derived from it.
*/}}
{{- define "wynn-tracker-server.port" -}}
{{- int (default 8080 (index .Values.config "host-port")) -}}
{{- end -}}

{{/* Name of the Secret holding config.json. */}}
{{- define "wynn-tracker-server.configSecretName" -}}
{{- if .Values.existingSecret -}}
{{- .Values.existingSecret -}}
{{- else -}}
{{- printf "%s-config" (include "wynn-tracker-server.fullname" .) -}}
{{- end -}}
{{- end -}}

{{- define "wynn-tracker-server.configSecretKey" -}}
{{- if .Values.existingSecret -}}
{{- default "config.json" .Values.existingSecretKey -}}
{{- else -}}
config.json
{{- end -}}
{{- end -}}

{{/*
config.json contents: .Values.config with the sensitive values merged on top,
so secrets never have to be duplicated into the config tree.
*/}}
{{- define "wynn-tracker-server.configJson" -}}
{{- $cfg := deepCopy (default dict .Values.config) -}}
{{- $s := default dict .Values.secrets -}}
{{- if $s.discordToken -}}
{{- $_ := set $cfg "token" $s.discordToken -}}
{{- end -}}
{{- if $s.wynncraftToken -}}
{{- $_ := set $cfg "wynncraft-token" $s.wynncraftToken -}}
{{- end -}}
{{- if $s.sqlPassword -}}
{{- $sql := deepCopy (default dict (index $cfg "sql")) -}}
{{- $_ := set $sql "password" $s.sqlPassword -}}
{{- $_ := set $cfg "sql" $sql -}}
{{- end -}}
{{- if $s.chatBridgeWebhookUrl -}}
{{- $bridge := deepCopy (default dict (index $cfg "chat-bridge")) -}}
{{- $_ := set $bridge "webhook-url" $s.chatBridgeWebhookUrl -}}
{{- $_ := set $cfg "chat-bridge" $bridge -}}
{{- end -}}
{{- toPrettyJson $cfg -}}
{{- end -}}

{{/* Whether TLS is being served by the ingress at all. */}}
{{- define "wynn-tracker-server.tlsEnabled" -}}
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled (ne .Values.ingress.tls.mode "none") -}}
true
{{- end -}}
{{- end -}}

{{- define "wynn-tracker-server.tlsSecretName" -}}
{{- default (printf "%s-tls" (include "wynn-tracker-server.fullname" .)) .Values.ingress.tls.secretName -}}
{{- end -}}

{{- define "wynn-tracker-server.issuerName" -}}
{{- default (printf "%s-acme" (include "wynn-tracker-server.fullname" .)) .Values.certManager.issuerName -}}
{{- end -}}

{{/* Whether cert-manager resources and annotations should be rendered. */}}
{{- define "wynn-tracker-server.certManagerEnabled" -}}
{{- if and (include "wynn-tracker-server.tlsEnabled" .) (eq .Values.ingress.tls.mode "cert-manager") -}}
true
{{- end -}}
{{- end -}}

{{/* Every hostname the ingress serves. */}}
{{- define "wynn-tracker-server.hosts" -}}
{{- $hosts := list .Values.ingress.host -}}
{{- range .Values.ingress.extraHosts -}}
{{- $hosts = append $hosts . -}}
{{- end -}}
{{- toJson (compact $hosts) -}}
{{- end -}}

{{/*
Fail early with a readable message rather than letting the apply fail on a
missing CRD or an issuer that cannot possibly work.
*/}}
{{- define "wynn-tracker-server.validate" -}}
{{- if .Values.ingress.enabled -}}
{{- if not .Values.ingress.host -}}
{{- fail "ingress.enabled is true but ingress.host is empty" -}}
{{- end -}}
{{- if not (has .Values.ingress.tls.mode (list "cert-manager" "existing" "none")) -}}
{{- fail (printf "ingress.tls.mode must be one of cert-manager, existing, none (got %q)" .Values.ingress.tls.mode) -}}
{{- end -}}
{{- if and (eq .Values.ingress.tls.mode "existing") .Values.ingress.tls.enabled (not .Values.ingress.tls.secretName) -}}
{{- fail "ingress.tls.mode=existing requires ingress.tls.secretName to name an existing kubernetes.io/tls Secret" -}}
{{- end -}}
{{- end -}}
{{- if include "wynn-tracker-server.certManagerEnabled" . -}}
{{- if and .Values.certManager.checkCrds (not (.Capabilities.APIVersions.Has "cert-manager.io/v1")) -}}
{{- fail "cert-manager CRDs (cert-manager.io/v1) were not found in the cluster. Install cert-manager first:\n  helm repo add jetstack https://charts.jetstack.io\n  helm install cert-manager jetstack/cert-manager -n cert-manager --create-namespace --set crds.enabled=true\nOr set ingress.tls.mode=existing / certManager.checkCrds=false." -}}
{{- end -}}
{{- if .Values.certManager.createIssuer -}}
{{- if not .Values.certManager.email -}}
{{- fail "certManager.email is required to register an ACME account with Let's Encrypt" -}}
{{- end -}}
{{- if not (has .Values.certManager.issuerKind (list "ClusterIssuer" "Issuer")) -}}
{{- fail (printf "certManager.issuerKind must be ClusterIssuer or Issuer (got %q)" .Values.certManager.issuerKind) -}}
{{- end -}}
{{- if not (has .Values.certManager.solver (list "http01" "dns01")) -}}
{{- fail (printf "certManager.solver must be http01 or dns01 (got %q)" .Values.certManager.solver) -}}
{{- end -}}
{{- if and (eq .Values.certManager.solver "dns01") (not .Values.certManager.dns01) -}}
{{- fail "certManager.solver=dns01 requires certManager.dns01 to hold a provider block (e.g. cloudflare: {...})" -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if gt (int .Values.replicaCount) 1 -}}
{{- fail "replicaCount must be 1: auth tokens are held in memory and a second replica would open a duplicate Discord gateway connection" -}}
{{- end -}}
{{- end -}}
