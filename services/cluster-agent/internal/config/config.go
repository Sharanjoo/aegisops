package config

import (
	"fmt"
	"os"
	"strings"
	"time"
)

const (
	clusterNameEnvironment = "AEGISOPS_CLUSTER_NAME"

	incidentServiceURLEnvironment = "AEGISOPS_INCIDENT_SERVICE_URL"

	incidentServiceTimeoutEnvironment = "AEGISOPS_INCIDENT_SERVICE_TIMEOUT"

	findingCooldownEnvironment = "AEGISOPS_FINDING_COOLDOWN"
)

const (
	defaultClusterName        = "kind-aegisops-dev"
	defaultIncidentServiceURL = "http://localhost:8080"

	defaultIncidentServiceTimeout = 5 * time.Second
	defaultFindingCooldown        = 15 * time.Minute
)

// Config contains the cluster agent runtime configuration.
type Config struct {
	ClusterName            string
	IncidentServiceURL     string
	IncidentServiceTimeout time.Duration
	FindingCooldown        time.Duration
}

// Load reads configuration from environment variables.
func Load() (Config, error) {
	incidentServiceTimeout, err := durationFromEnvironment(
		incidentServiceTimeoutEnvironment,
		defaultIncidentServiceTimeout,
	)
	if err != nil {
		return Config{}, err
	}

	findingCooldown, err := durationFromEnvironment(
		findingCooldownEnvironment,
		defaultFindingCooldown,
	)
	if err != nil {
		return Config{}, err
	}

	return Config{
		ClusterName: environmentOrDefault(
			clusterNameEnvironment,
			defaultClusterName,
		),
		IncidentServiceURL: environmentOrDefault(
			incidentServiceURLEnvironment,
			defaultIncidentServiceURL,
		),
		IncidentServiceTimeout: incidentServiceTimeout,
		FindingCooldown:        findingCooldown,
	}, nil
}

func environmentOrDefault(
	name string,
	defaultValue string,
) string {
	value := strings.TrimSpace(os.Getenv(name))

	if value == "" {
		return defaultValue
	}

	return value
}

func durationFromEnvironment(
	name string,
	defaultValue time.Duration,
) (time.Duration, error) {
	value := strings.TrimSpace(os.Getenv(name))

	if value == "" {
		return defaultValue, nil
	}

	duration, err := time.ParseDuration(value)
	if err != nil {
		return 0, fmt.Errorf(
			"parse %s duration %q: %w",
			name,
			value,
			err,
		)
	}

	if duration <= 0 {
		return 0, fmt.Errorf(
			"%s must be greater than zero",
			name,
		)
	}

	return duration, nil
}
