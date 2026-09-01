package io.aegisops.incident.messaging;

import org.apache.kafka.clients.admin.NewTopic;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.kafka.config.TopicBuilder;

@Configuration
public class KafkaTopicConfiguration {

    @Bean
    NewTopic incidentEventsTopic(
            @Value("${aegisops.kafka.topics.incident-events}")
            String topicName
    ) {
        return TopicBuilder
                .name(topicName)
                .partitions(3)
                .replicas(1)
                .build();
    }
}