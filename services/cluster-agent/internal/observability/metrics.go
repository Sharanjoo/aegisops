package observability

import "github.com/prometheus/client_golang/prometheus"

// Metrics holds the cluster agent's Prometheus counters. Every label set is
// small and bounded (container type, outcome) - never pod names, incident
// IDs, namespaces, or error strings, which would explode cardinality.
type Metrics struct {
	FindingsDetected    *prometheus.CounterVec
	FindingsSuppressed  prometheus.Counter
	IncidentSubmissions *prometheus.CounterVec
	WatchFailures       prometheus.Counter
}

// NewMetrics creates and registers the cluster agent's metrics on registry.
func NewMetrics(registry *prometheus.Registry) *Metrics {
	metrics := &Metrics{
		FindingsDetected: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "aegisops_cluster_agent_findings_detected_total",
				Help: "Kubernetes failure signals detected, by container type.",
			},
			[]string{"container_type"},
		),
		FindingsSuppressed: prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "aegisops_cluster_agent_findings_suppressed_total",
				Help: "Findings suppressed as duplicates during the cooldown window.",
			},
		),
		IncidentSubmissions: prometheus.NewCounterVec(
			prometheus.CounterOpts{
				Name: "aegisops_cluster_agent_incident_submissions_total",
				Help: "Incident-service submission attempts, by outcome (succeeded or failed).",
			},
			[]string{"outcome"},
		),
		WatchFailures: prometheus.NewCounter(
			prometheus.CounterOpts{
				Name: "aegisops_cluster_agent_watch_failures_total",
				Help: "Times the Kubernetes Pod watcher stopped due to an unrecoverable error.",
			},
		),
	}

	registry.MustRegister(
		metrics.FindingsDetected,
		metrics.FindingsSuppressed,
		metrics.IncidentSubmissions,
		metrics.WatchFailures,
	)

	// Registers every bounded label value at 0 immediately, rather than
	// only after that container type/outcome first occurs - so these
	// counters are visible on the very first Prometheus scrape.
	for _, containerType := range []string{"application", "init"} {
		metrics.FindingsDetected.WithLabelValues(containerType)
	}

	for _, outcome := range []string{"succeeded", "failed"} {
		metrics.IncidentSubmissions.WithLabelValues(outcome)
	}

	return metrics
}
