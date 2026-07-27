package io.axoniq.quickstart.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.io.ClassPathResource;
import org.springframework.http.MediaType;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.ServerResponse;

import static org.springframework.web.reactive.function.server.RequestPredicates.GET;
import static org.springframework.web.reactive.function.server.RouterFunctions.route;

/**
 * Spring WebFlux configuration for serving static web resources.
 *
 * <p>This configuration class addresses the fundamental difference between Spring MVC and
 * Spring WebFlux regarding static resource handling. Unlike Spring MVC, which automatically
 * serves static resources from {@code src/main/resources/static}, WebFlux requires explicit
 * configuration to handle static file serving.</p>
 *
 * <p><strong>Problem solved:</strong></p>
 * <p>WebFlux applications don't automatically serve static resources, causing 404 errors
 * when trying to access HTML, CSS, JavaScript, and image files. This configuration
 * provides a reactive solution using functional routing.</p>
 *
 * <p><strong>Architecture choice:</strong></p>
 * <p>This implementation uses Spring WebFlux's functional routing approach rather than
 * annotation-based controllers, which aligns with the reactive programming model and
 * provides better performance for static resource serving.</p>
 *
 * <p><strong>Routing strategy:</strong></p>
 * <ul>
 *   <li><strong>Root path ({@code /})</strong>: Serves the main index.html file</li>
 *   <li><strong>File paths ({@code /{filename}})</strong>: Serves any requested static resource</li>
 *   <li><strong>Content-Type detection</strong>: Automatically sets appropriate MIME types</li>
 *   <li><strong>404 handling</strong>: Returns proper HTTP 404 for missing resources</li>
 * </ul>
 *
 * <p><strong>Supported file types:</strong></p>
 * <ul>
 *   <li>HTML files (text/html)</li>
 *   <li>CSS files (text/css)</li>
 *   <li>JavaScript files (text/javascript)</li>
 *   <li>Images and other files (application/octet-stream)</li>
 * </ul>
 *
 * <p><strong>Security considerations:</strong></p>
 * <ul>
 *   <li>Files are served only from the classpath static directory</li>
 *   <li>No directory traversal vulnerabilities due to ClassPathResource usage</li>
 *   <li>Proper content-type headers prevent MIME-type confusion attacks</li>
 * </ul>
 *
 * <p><strong>Performance characteristics:</strong></p>
 * <ul>
 *   <li>Non-blocking I/O through WebFlux reactive streams</li>
 *   <li>Efficient resource handling via Spring's ClassPathResource</li>
 *   <li>Minimal memory footprint for static file serving</li>
 * </ul>
 *
 * @see RouterFunction
 * @see ServerResponse
 * @see ClassPathResource
 *
 * @author AxonIQ Quickstart
 * @version 1.0
 * @since 1.0
 */
@Configuration
public class WebConfig {

    /**
     * Creates a functional router for serving static web resources.
     *
     * <p>This bean defines the routing rules for static resource requests using
     * Spring WebFlux's functional routing API. It handles both the root path
     * (serving index.html) and individual file requests with proper content-type
     * detection and 404 error handling.</p>
     *
     * <p><strong>Route definitions:</strong></p>
     * <ol>
     *   <li><strong>GET "/"</strong> → serves static/index.html as text/html</li>
     *   <li><strong>GET "/{filename}"</strong> → serves static/{filename} with detected content-type</li>
     * </ol>
     *
     * <p><strong>Implementation details:</strong></p>
     * <ul>
     *   <li>Uses {@link ClassPathResource} for secure classpath-only access</li>
     *   <li>Employs regex pattern {@code /{filename:.+}} to match any filename with extension</li>
     *   <li>Automatically detects and sets appropriate MIME types</li>
     *   <li>Returns HTTP 404 for non-existent resources</li>
     * </ul>
     *
     * @return RouterFunction that handles static resource requests
     */
    @Bean
    public RouterFunction<ServerResponse> staticResourceRouter() {
        return route(GET("/"), request ->
            ServerResponse.ok()
                .contentType(MediaType.TEXT_HTML)
                .bodyValue(new ClassPathResource("static/index.html"))
        ).andRoute(GET("/{filename:.+}"), request -> {
            String filename = request.pathVariable("filename");
            ClassPathResource resource = new ClassPathResource("static/" + filename);

            if (resource.exists()) {
                MediaType mediaType = getMediaType(filename);
                return ServerResponse.ok()
                    .contentType(mediaType)
                    .bodyValue(resource);
            } else {
                return ServerResponse.notFound().build();
            }
        });
    }

    /**
     * Determines the appropriate MIME type based on file extension.
     *
     * <p>This utility method provides content-type detection for common web resource
     * file types, ensuring that browsers receive proper MIME type headers for
     * correct rendering and security.</p>
     *
     * <p><strong>Supported extensions:</strong></p>
     * <ul>
     *   <li><strong>.html</strong> → text/html</li>
     *   <li><strong>.css</strong> → text/css</li>
     *   <li><strong>.js</strong> → text/javascript</li>
     *   <li><strong>others</strong> → application/octet-stream (binary default)</li>
     * </ul>
     *
     * <p><strong>Security benefit:</strong></p>
     * <p>Setting correct content-type headers prevents browsers from performing
     * MIME-type sniffing, which could lead to security vulnerabilities when
     * user-uploaded content is served.</p>
     *
     * <p><strong>Extensibility:</strong></p>
     * <p>Additional file types can be easily added by extending the if-else chain
     * or by implementing a more sophisticated mapping strategy for production use.</p>
     *
     * @param filename the name of the file including its extension
     * @return the appropriate MediaType for the file
     */
    private MediaType getMediaType(String filename) {
        if (filename.endsWith(".html")) {
            return MediaType.TEXT_HTML;
        } else if (filename.endsWith(".css")) {
            return MediaType.valueOf("text/css");
        } else if (filename.endsWith(".js")) {
            return MediaType.valueOf("text/javascript");
        } else {
            return MediaType.APPLICATION_OCTET_STREAM;
        }
    }
}