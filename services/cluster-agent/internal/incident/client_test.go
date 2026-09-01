package incident

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestClientCreatesIncident(t *testing.T) {
	server := httptest.NewServer(
		http.HandlerFunc(
			func(
				writer http.ResponseWriter,
				request *http.Request,
			) {
				if request.Method != http.MethodPost {
					t.Errorf(
						"expected POST, got %s",
						request.Method,
					)
				}

				if request.URL.Path != createIncidentPath {
					t.Errorf(
						"expected path %s, got %s",
						createIncidentPath,
						request.URL.Path,
					)
				}

				var createRequest CreateRequest

				if err := json.NewDecoder(request.Body).
					Decode(&createRequest); err != nil {
					t.Errorf(
						"decode request: %v",
						err,
					)
				}

				if createRequest.ServiceName !=
					"payments-api" {
					t.Errorf(
						"expected payments-api, got %s",
						createRequest.ServiceName,
					)
				}

				writer.Header().Set(
					"Content-Type",
					"application/json",
				)
				writer.WriteHeader(http.StatusCreated)

				_, _ = writer.Write([]byte(`{
					"id": "incident-123",
					"serviceName": "payments-api",
					"severity": "HIGH",
					"status": "OPEN"
				}`))
			},
		),
	)
	defer server.Close()

	client, err := NewClient(server.URL, time.Second)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}

	createdIncident, err := client.Create(
		context.Background(),
		CreateRequest{
			ServiceName: "payments-api",
			Title:       "Pod is repeatedly restarting",
			Description: "CrashLoopBackOff detected",
			Severity:    SeverityHigh,
		},
	)
	if err != nil {
		t.Fatalf("create incident: %v", err)
	}

	if createdIncident.ID != "incident-123" {
		t.Errorf(
			"expected incident-123, got %s",
			createdIncident.ID,
		)
	}

	if createdIncident.Status != "OPEN" {
		t.Errorf(
			"expected OPEN, got %s",
			createdIncident.Status,
		)
	}
}

func TestClientReturnsServiceError(t *testing.T) {
	server := httptest.NewServer(
		http.HandlerFunc(
			func(
				writer http.ResponseWriter,
				_ *http.Request,
			) {
				http.Error(
					writer,
					`{"title":"Internal server error"}`,
					http.StatusInternalServerError,
				)
			},
		),
	)
	defer server.Close()

	client, err := NewClient(server.URL, time.Second)
	if err != nil {
		t.Fatalf("create client: %v", err)
	}

	_, err = client.Create(
		context.Background(),
		CreateRequest{
			ServiceName: "payments-api",
			Title:       "Pod is repeatedly restarting",
			Description: "CrashLoopBackOff detected",
			Severity:    SeverityHigh,
		},
	)

	if err == nil {
		t.Fatal("expected incident service error")
	}

	if !strings.Contains(err.Error(), "500") {
		t.Errorf(
			"expected HTTP 500 in error, got %v",
			err,
		)
	}
}
