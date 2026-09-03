package observability

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/prometheus/client_golang/prometheus"
)

func TestHealthzAlwaysOK(t *testing.T) {
	registry := prometheus.NewRegistry()
	server := NewServer("127.0.0.1:0", registry)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)

	server.httpServer.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}
}

func TestReadyzReflectsReadiness(t *testing.T) {
	registry := prometheus.NewRegistry()
	server := NewServer("127.0.0.1:0", registry)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/readyz", nil)
	server.httpServer.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf(
			"expected status 503 before SetReady(true), got %d",
			recorder.Code,
		)
	}

	server.SetReady(true)

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	server.httpServer.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf(
			"expected status 200 after SetReady(true), got %d",
			recorder.Code,
		)
	}

	var body map[string]string
	if err := json.NewDecoder(recorder.Body).Decode(&body); err != nil {
		t.Fatalf("decode response body: %v", err)
	}

	if body["status"] != "ready" {
		t.Fatalf("expected status \"ready\", got %q", body["status"])
	}

	server.SetReady(false)

	recorder = httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/readyz", nil)
	server.httpServer.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusServiceUnavailable {
		t.Fatalf(
			"expected status 503 after SetReady(false), got %d",
			recorder.Code,
		)
	}
}

func TestMetricsEndpointServesRegisteredMetrics(t *testing.T) {
	registry := prometheus.NewRegistry()
	metrics := NewMetrics(registry)
	metrics.FindingsDetected.WithLabelValues("application").Inc()

	server := NewServer("127.0.0.1:0", registry)

	recorder := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/metrics", nil)
	server.httpServer.Handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("expected status 200, got %d", recorder.Code)
	}

	body := recorder.Body.String()

	if !strings.Contains(body, "aegisops_cluster_agent_findings_detected_total") {
		t.Fatalf(
			"expected /metrics to contain the findings-detected metric, got: %s",
			body,
		)
	}
}

func TestStartAndShutdown(t *testing.T) {
	registry := prometheus.NewRegistry()
	server := NewServer("127.0.0.1:0", registry)

	errs := server.Start()

	ctx, cancel := context.WithTimeout(
		context.Background(),
		2*time.Second,
	)
	defer cancel()

	if err := server.Shutdown(ctx); err != nil {
		t.Fatalf("shutdown failed: %v", err)
	}

	select {
	case err := <-errs:
		if err != nil {
			t.Fatalf("expected a clean shutdown, got error: %v", err)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("server did not report shutdown in time")
	}
}
