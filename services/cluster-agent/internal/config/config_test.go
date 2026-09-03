package config

import (
	"testing"
	"time"
)

func TestLoadUsesDefaults(t *testing.T) {
	t.Setenv(clusterNameEnvironment, "")
	t.Setenv(incidentServiceURLEnvironment, "")
	t.Setenv(incidentServiceTimeoutEnvironment, "")
	t.Setenv(findingCooldownEnvironment, "")
	t.Setenv(metricsHostEnvironment, "")
	t.Setenv(metricsPortEnvironment, "")

	configuration, err := Load()
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}

	if configuration.ClusterName != defaultClusterName {
		t.Errorf(
			"expected cluster name %s, got %s",
			defaultClusterName,
			configuration.ClusterName,
		)
	}

	if configuration.IncidentServiceURL !=
		defaultIncidentServiceURL {
		t.Errorf(
			"expected incident service URL %s, got %s",
			defaultIncidentServiceURL,
			configuration.IncidentServiceURL,
		)
	}

	if configuration.IncidentServiceTimeout !=
		defaultIncidentServiceTimeout {
		t.Errorf(
			"expected timeout %s, got %s",
			defaultIncidentServiceTimeout,
			configuration.IncidentServiceTimeout,
		)
	}

	if configuration.FindingCooldown !=
		defaultFindingCooldown {
		t.Errorf(
			"expected cooldown %s, got %s",
			defaultFindingCooldown,
			configuration.FindingCooldown,
		)
	}

	if configuration.MetricsHost != defaultMetricsHost {
		t.Errorf(
			"expected metrics host %s, got %s",
			defaultMetricsHost,
			configuration.MetricsHost,
		)
	}

	if configuration.MetricsPort != defaultMetricsPort {
		t.Errorf(
			"expected metrics port %s, got %s",
			defaultMetricsPort,
			configuration.MetricsPort,
		)
	}
}

func TestLoadUsesEnvironmentOverrides(t *testing.T) {
	t.Setenv(clusterNameEnvironment, "production-cluster")
	t.Setenv(
		incidentServiceURLEnvironment,
		"http://incident-service:8080",
	)
	t.Setenv(incidentServiceTimeoutEnvironment, "10s")
	t.Setenv(findingCooldownEnvironment, "30m")
	t.Setenv(metricsHostEnvironment, "127.0.0.1")
	t.Setenv(metricsPortEnvironment, "9999")

	configuration, err := Load()
	if err != nil {
		t.Fatalf("load configuration: %v", err)
	}

	if configuration.ClusterName != "production-cluster" {
		t.Errorf(
			"unexpected cluster name: %s",
			configuration.ClusterName,
		)
	}

	if configuration.IncidentServiceURL !=
		"http://incident-service:8080" {
		t.Errorf(
			"unexpected incident service URL: %s",
			configuration.IncidentServiceURL,
		)
	}

	if configuration.IncidentServiceTimeout !=
		10*time.Second {
		t.Errorf(
			"unexpected timeout: %s",
			configuration.IncidentServiceTimeout,
		)
	}

	if configuration.FindingCooldown !=
		30*time.Minute {
		t.Errorf(
			"unexpected cooldown: %s",
			configuration.FindingCooldown,
		)
	}

	if configuration.MetricsHost != "127.0.0.1" {
		t.Errorf(
			"unexpected metrics host: %s",
			configuration.MetricsHost,
		)
	}

	if configuration.MetricsPort != "9999" {
		t.Errorf(
			"unexpected metrics port: %s",
			configuration.MetricsPort,
		)
	}
}

func TestLoadRejectsInvalidDuration(t *testing.T) {
	t.Setenv(
		incidentServiceTimeoutEnvironment,
		"not-a-duration",
	)

	_, err := Load()

	if err == nil {
		t.Fatal("expected invalid duration error")
	}
}
