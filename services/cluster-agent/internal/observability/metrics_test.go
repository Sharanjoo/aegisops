package observability

import (
	"testing"

	"github.com/prometheus/client_golang/prometheus"
	"github.com/prometheus/client_golang/prometheus/testutil"
)

func TestMetricsCountersIncrement(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics := NewMetrics(registry)

	metrics.FindingsDetected.WithLabelValues("application").Inc()
	metrics.FindingsDetected.WithLabelValues("application").Inc()
	metrics.FindingsDetected.WithLabelValues("init").Inc()
	metrics.FindingsSuppressed.Inc()
	metrics.IncidentSubmissions.WithLabelValues("succeeded").Inc()
	metrics.IncidentSubmissions.WithLabelValues("failed").Inc()
	metrics.IncidentSubmissions.WithLabelValues("failed").Inc()
	metrics.WatchFailures.Inc()

	assertCounterValue(
		t,
		metrics.FindingsDetected.WithLabelValues("application"),
		2,
	)
	assertCounterValue(
		t,
		metrics.FindingsDetected.WithLabelValues("init"),
		1,
	)
	assertCounterValue(t, metrics.FindingsSuppressed, 1)
	assertCounterValue(
		t,
		metrics.IncidentSubmissions.WithLabelValues("succeeded"),
		1,
	)
	assertCounterValue(
		t,
		metrics.IncidentSubmissions.WithLabelValues("failed"),
		2,
	)
	assertCounterValue(t, metrics.WatchFailures, 1)
}

func assertCounterValue(
	t *testing.T,
	counter prometheus.Counter,
	expected float64,
) {
	t.Helper()

	actual := testutil.ToFloat64(counter)

	if actual != expected {
		t.Fatalf("expected counter value %v, got %v", expected, actual)
	}
}
