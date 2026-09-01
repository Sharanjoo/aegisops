package io.aegisops.incident.exception;

import io.aegisops.incident.domain.IncidentStatus;

public final class InvalidIncidentStatusTransitionException
        extends RuntimeException {

    public InvalidIncidentStatusTransitionException(
            IncidentStatus currentStatus,
            IncidentStatus targetStatus
    ) {
        super(
                "Cannot transition incident status from "
                        + currentStatus
                        + " to "
                        + targetStatus
        );
    }
}