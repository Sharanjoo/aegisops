package incident

import (
	"strings"
	"testing"

	"github.com/Sharanjoo/aegisops/services/cluster-agent/internal/detection"
)

func TestCreateRequestFromFinding(t *testing.T) {
	finding := detection.Finding{
		Namespace:     "payments",
		PodName:       "payments-api-abc",
		ServiceName:   "payments-api",
		ContainerName: "payments-api",
		ContainerType: detection.ContainerTypeApplication,
		RestartCount:  5,
		Reason:        detection.CrashLoopBackOffReason,
		Message:       "back-off restarting failed container",
	}

	request := CreateRequestFromFinding(
		finding,
		"kind-aegisops-dev",
	)

	if request.ServiceName != "payments-api" {
		t.Errorf(
			"expected payments-api, got %s",
			request.ServiceName,
		)
	}

	if request.Severity != SeverityHigh {
		t.Errorf(
			"expected HIGH severity, got %s",
			request.Severity,
		)
	}

	expectedFragments := []string{
		"CrashLoopBackOff",
		"kind-aegisops-dev",
		"payments",
		"payments-api-abc",
		"Restart count: 5",
	}

	for _, fragment := range expectedFragments {
		if !strings.Contains(
			request.Description,
			fragment,
		) {
			t.Errorf(
				"description does not contain %q",
				fragment,
			)
		}
	}
}

func TestCreateRequestFromFindingUsesFallbackServiceName(
	t *testing.T,
) {
	request := CreateRequestFromFinding(
		detection.Finding{
			PodName:       "worker-abc",
			ContainerName: "worker",
			Reason:        detection.CrashLoopBackOffReason,
		},
		"test-cluster",
	)

	if request.ServiceName != "worker" {
		t.Errorf(
			"expected worker, got %s",
			request.ServiceName,
		)
	}
}
