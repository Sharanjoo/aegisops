package incident

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

const createIncidentPath = "/api/v1/incidents"

// Severity represents an incident severity accepted by the incident service.
type Severity string

const (
	SeverityLow      Severity = "LOW"
	SeverityMedium   Severity = "MEDIUM"
	SeverityHigh     Severity = "HIGH"
	SeverityCritical Severity = "CRITICAL"
)

// CreateRequest is the request sent to the incident service.
type CreateRequest struct {
	ServiceName string   `json:"serviceName"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Severity    Severity `json:"severity"`
}

// CreatedIncident contains the relevant incident-service response fields.
type CreatedIncident struct {
	ID          string   `json:"id"`
	ServiceName string   `json:"serviceName"`
	Severity    Severity `json:"severity"`
	Status      string   `json:"status"`
}

// Client communicates with the AegisOps incident service.
type Client struct {
	baseURL    *url.URL
	httpClient *http.Client
}

// NewClient creates an incident-service HTTP client.
func NewClient(
	rawBaseURL string,
	timeout time.Duration,
) (*Client, error) {
	rawBaseURL = strings.TrimSpace(rawBaseURL)

	if rawBaseURL == "" {
		return nil, errors.New("incident service URL is required")
	}

	if timeout <= 0 {
		return nil, errors.New(
			"incident service timeout must be positive",
		)
	}

	baseURL, err := url.Parse(rawBaseURL)
	if err != nil {
		return nil, fmt.Errorf(
			"parse incident service URL: %w",
			err,
		)
	}

	if baseURL.Scheme != "http" &&
		baseURL.Scheme != "https" {
		return nil, errors.New(
			"incident service URL must use HTTP or HTTPS",
		)
	}

	if baseURL.Host == "" {
		return nil, errors.New(
			"incident service URL must include a host",
		)
	}

	return &Client{
		baseURL: baseURL,
		httpClient: &http.Client{
			Timeout: timeout,
		},
	}, nil
}

// Create sends a new incident to the incident service.
func (client *Client) Create(
	ctx context.Context,
	request CreateRequest,
) (*CreatedIncident, error) {
	payload, err := json.Marshal(request)
	if err != nil {
		return nil, fmt.Errorf(
			"encode incident request: %w",
			err,
		)
	}

	endpoint := client.baseURL.ResolveReference(
		&url.URL{Path: createIncidentPath},
	)

	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		endpoint.String(),
		bytes.NewReader(payload),
	)
	if err != nil {
		return nil, fmt.Errorf(
			"create incident HTTP request: %w",
			err,
		)
	}

	httpRequest.Header.Set(
		"Content-Type",
		"application/json",
	)
	httpRequest.Header.Set(
		"Accept",
		"application/json",
	)

	response, err := client.httpClient.Do(httpRequest)
	if err != nil {
		return nil, fmt.Errorf(
			"send incident request: %w",
			err,
		)
	}
	defer response.Body.Close()

	responseBody := io.LimitReader(response.Body, 1<<20)

	if response.StatusCode != http.StatusCreated {
		body, readError := io.ReadAll(responseBody)
		if readError != nil {
			return nil, fmt.Errorf(
				"incident service returned %s",
				response.Status,
			)
		}

		return nil, fmt.Errorf(
			"incident service returned %s: %s",
			response.Status,
			strings.TrimSpace(string(body)),
		)
	}

	var createdIncident CreatedIncident

	if err := json.NewDecoder(responseBody).
		Decode(&createdIncident); err != nil {
		return nil, fmt.Errorf(
			"decode incident response: %w",
			err,
		)
	}

	if createdIncident.ID == "" {
		return nil, errors.New(
			"incident service returned an empty incident ID",
		)
	}

	return &createdIncident, nil
}
