package incident

import (
	"fmt"
	"strings"

	"github.com/Sharanjoo/aegisops/services/cluster-agent/internal/detection"
)

const (
	maxIncidentTitleLength       = 200
	maxIncidentDescriptionLength = 2000
)

// CreateRequestFromFinding maps a Kubernetes finding to an incident request.
func CreateRequestFromFinding(
	finding detection.Finding,
	clusterName string,
) CreateRequest {
	serviceName := valueOrDefault(
		finding.ServiceName,
		finding.ContainerName,
	)

	serviceName = valueOrDefault(
		serviceName,
		"unknown-service",
	)

	podName := valueOrDefault(
		finding.PodName,
		"unknown-pod",
	)

	namespace := valueOrDefault(
		finding.Namespace,
		"default",
	)

	clusterName = valueOrDefault(
		clusterName,
		"unknown-cluster",
	)

	message := valueOrDefault(
		finding.Message,
		"no Kubernetes message was provided",
	)

	title := fmt.Sprintf(
		"Kubernetes pod %s is repeatedly restarting",
		podName,
	)

	description := fmt.Sprintf(
		"%s detected in cluster %s. "+
			"Namespace: %s. Pod: %s. "+
			"Container: %s. Container type: %s. "+
			"Restart count: %d. Kubernetes message: %s",
		finding.Reason,
		clusterName,
		namespace,
		podName,
		finding.ContainerName,
		finding.ContainerType,
		finding.RestartCount,
		message,
	)

	return CreateRequest{
		ServiceName: serviceName,
		Title: truncateRunes(
			title,
			maxIncidentTitleLength,
		),
		Description: truncateRunes(
			description,
			maxIncidentDescriptionLength,
		),
		Severity: SeverityHigh,
	}
}

func valueOrDefault(
	value string,
	defaultValue string,
) string {
	value = strings.TrimSpace(value)

	if value == "" {
		return defaultValue
	}

	return value
}

func truncateRunes(
	value string,
	maximumLength int,
) string {
	runes := []rune(value)

	if len(runes) <= maximumLength {
		return value
	}

	return string(runes[:maximumLength])
}
