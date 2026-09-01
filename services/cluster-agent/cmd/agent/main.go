package main

import (
	"context"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	corev1 "k8s.io/api/core/v1"

	"github.com/Sharanjoo/aegisops/services/cluster-agent/internal/config"
	"github.com/Sharanjoo/aegisops/services/cluster-agent/internal/detection"
	"github.com/Sharanjoo/aegisops/services/cluster-agent/internal/incident"
	clusterkubernetes "github.com/Sharanjoo/aegisops/services/cluster-agent/internal/kubernetes"
)

func main() {
	logger := slog.New(
		slog.NewJSONHandler(os.Stdout, nil),
	)

	ctx, stop := signal.NotifyContext(
		context.Background(),
		os.Interrupt,
		syscall.SIGTERM,
	)
	defer stop()

	configuration, err := config.Load()
	if err != nil {
		logger.Error(
			"failed to load configuration",
			"error",
			err,
		)
		os.Exit(1)
	}

	incidentClient, err := incident.NewClient(
		configuration.IncidentServiceURL,
		configuration.IncidentServiceTimeout,
	)
	if err != nil {
		logger.Error(
			"failed to create incident-service client",
			"error",
			err,
		)
		os.Exit(1)
	}

	clientset, configSource, err :=
		clusterkubernetes.NewClientset()
	if err != nil {
		logger.Error(
			"failed to create Kubernetes client",
			"error",
			err,
		)
		os.Exit(1)
	}

	serverVersion, err := clientset.Discovery().ServerVersion()
	if err != nil {
		logger.Error(
			"failed to retrieve Kubernetes server version",
			"error",
			err,
		)
		os.Exit(1)
	}

	logger.Info(
		"connected to Kubernetes",
		"configSource",
		configSource,
		"serverVersion",
		serverVersion.GitVersion,
	)

	deduplicator := detection.NewDeduplicator(
		configuration.FindingCooldown,
	)

	podWatcher := clusterkubernetes.NewPodWatcher(
		clientset,
		func(handlerContext context.Context, pod *corev1.Pod) {
			findings :=
				detection.DetectCrashLoopBackOff(pod)

			for _, finding := range findings {
				if !deduplicator.Allow(finding) {
					logger.Debug(
						"duplicate finding suppressed",
						"podUID",
						finding.PodUID,
						"container",
						finding.ContainerName,
					)

					continue
				}

				logger.Warn(
					"CrashLoopBackOff detected",
					"cluster",
					configuration.ClusterName,
					"namespace",
					finding.Namespace,
					"pod",
					finding.PodName,
					"container",
					finding.ContainerName,
					"restartCount",
					finding.RestartCount,
				)

				createRequest :=
					incident.CreateRequestFromFinding(
						finding,
						configuration.ClusterName,
					)

				createdIncident, err := incidentClient.Create(
					handlerContext,
					createRequest,
				)
				if err != nil {
					// Do not suppress a finding whose incident
					// could not be created.
					deduplicator.Forget(finding)

					logger.Error(
						"failed to create incident",
						"error",
						err,
						"namespace",
						finding.Namespace,
						"pod",
						finding.PodName,
						"container",
						finding.ContainerName,
					)

					continue
				}

				logger.Info(
					"incident created from Kubernetes finding",
					"incidentId",
					createdIncident.ID,
					"serviceName",
					createdIncident.ServiceName,
					"severity",
					createdIncident.Severity,
					"status",
					createdIncident.Status,
					"namespace",
					finding.Namespace,
					"pod",
					finding.PodName,
				)
			}
		},
	)

	logger.Info(
		"cluster agent started",
		"clusterName",
		configuration.ClusterName,
		"incidentServiceURL",
		configuration.IncidentServiceURL,
		"findingCooldown",
		configuration.FindingCooldown.String(),
	)

	if err := podWatcher.Run(ctx); err != nil {
		logger.Error(
			"Pod watcher stopped unexpectedly",
			"error",
			err,
		)
		os.Exit(1)
	}

	logger.Info("cluster agent stopped")
}
