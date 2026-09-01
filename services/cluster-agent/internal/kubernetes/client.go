package kubernetes

import (
	"fmt"
	"os"
	"path/filepath"
	"time"

	kubernetesclient "k8s.io/client-go/kubernetes"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
)

// NewClientset creates a Kubernetes client using in-cluster authentication
// when deployed, or the local kubeconfig during development.
func NewClientset() (
	kubernetesclient.Interface,
	string,
	error,
) {
	config, configSource, err := loadConfig()
	if err != nil {
		return nil, "", err
	}

	config.UserAgent = "aegisops-cluster-agent"
	config.QPS = 10
	config.Burst = 20
	config.Timeout = 30 * time.Second

	clientset, err := kubernetesclient.NewForConfig(config)
	if err != nil {
		return nil, "", fmt.Errorf(
			"create Kubernetes clientset: %w",
			err,
		)
	}

	return clientset, configSource, nil
}

func loadConfig() (*rest.Config, string, error) {
	config, inClusterError := rest.InClusterConfig()
	if inClusterError == nil {
		return config, "in-cluster", nil
	}

	kubeconfigPath := os.Getenv("KUBECONFIG")

	if kubeconfigPath == "" {
		userHome, err := os.UserHomeDir()
		if err != nil {
			return nil, "", fmt.Errorf(
				"resolve user home directory: %w",
				err,
			)
		}

		kubeconfigPath = filepath.Join(
			userHome,
			".kube",
			"config",
		)
	}

	config, err := clientcmd.BuildConfigFromFlags(
		"",
		kubeconfigPath,
	)
	if err != nil {
		return nil, "", fmt.Errorf(
			"load kubeconfig %q: %w",
			kubeconfigPath,
			err,
		)
	}

	return config, kubeconfigPath, nil
}
