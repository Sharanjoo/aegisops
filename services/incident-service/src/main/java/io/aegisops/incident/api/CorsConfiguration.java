package io.aegisops.incident.api;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Allows the local Vite dashboard dev server to call the REST API from the
 * browser. Browsers block cross-origin fetches by default, and this service
 * previously configured no CORS policy at all, so a page served from
 * http://localhost:5173 could not read http://localhost:8080/api/v1/incidents.
 *
 * The allowed origin is intentionally a single configurable value, not a
 * wildcard: production deployments must set AEGISOPS_CORS_ALLOWED_ORIGIN to
 * their actual dashboard origin rather than relying on this default.
 */
@Configuration
public class CorsConfiguration implements WebMvcConfigurer {

    private final String allowedOrigin;

    public CorsConfiguration(
            @Value("${aegisops.cors.allowed-origin:http://localhost:5173}")
            String allowedOrigin
    ) {
        this.allowedOrigin = allowedOrigin;
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/api/v1/**")
                .allowedOrigins(allowedOrigin)
                .allowedMethods("GET", "POST", "PATCH")
                .allowedHeaders("Content-Type")
                .maxAge(3600);
    }
}
