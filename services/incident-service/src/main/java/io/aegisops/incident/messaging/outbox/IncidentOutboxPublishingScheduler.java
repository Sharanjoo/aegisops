package io.aegisops.incident.messaging.outbox;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(
        name = "aegisops.outbox.publisher.enabled",
        havingValue = "true",
        matchIfMissing = true
)
public class IncidentOutboxPublishingScheduler {

    private final IncidentOutboxPublisher outboxPublisher;

    public IncidentOutboxPublishingScheduler(
            IncidentOutboxPublisher outboxPublisher
    ) {
        this.outboxPublisher = outboxPublisher;
    }

    @Scheduled(
            fixedDelayString =
                    "${aegisops.outbox.publish-interval-ms:1000}"
    )
    public void publishPendingEvents() {
        outboxPublisher.publishPendingEvents();
    }
}