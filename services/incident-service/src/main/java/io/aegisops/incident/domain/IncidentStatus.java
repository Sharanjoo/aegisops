package io.aegisops.incident.domain;

public enum IncidentStatus {
    OPEN,
    ACKNOWLEDGED,
    RESOLVED;

    public boolean canTransitionTo(IncidentStatus targetStatus) {
        if (targetStatus == null) {
            return false;
        }

        if (this == targetStatus) {
            return true;
        }

        return switch (this) {
            case OPEN ->
                    targetStatus == ACKNOWLEDGED
                            || targetStatus == RESOLVED;
            case ACKNOWLEDGED ->
                    targetStatus == RESOLVED;
            case RESOLVED -> false;
        };
    }
}