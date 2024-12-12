/**
 * Core application file for Battlemaster
 *
 * This module serves as the primary entry point for the Battlemaster labeler,
 * providing comprehensive connection and event management. It orchestrates all major
 * components and ensures robust error handling throughout the application lifecycle.
 *
 * Primary responsibilities include:
 * - Configuration initialization and validation
 * - ATP authentication and session management
 * - Jetstream connection lifecycle management
 * - Event processing and cursor management
 * - Graceful shutdown coordination
 */

import { AtpAgent } from 'atproto';
import { CommitCreateEvent, Jetstream } from 'jetstream';
import { Labeler } from './labeler.ts';
import {
	closeConfig,
	CONFIG,
	initializeConfig,
	setConfigValue,
} from './config.ts';
import { DidSchema, RkeySchema } from './schemas.ts';
import { verifyKvStore } from '../scripts/kv_utils.ts';
import { AtpError, JetstreamError } from './errors.ts';
import * as log from '@std/log';
import { MetricsTracker } from './metrics.ts';
import { Handler } from './handler.ts';

/** Persistent key-value store for application state and data */
const kv = await Deno.openKv();

/** Application-wide logger instance */
const logger = log.getLogger();

/** Set for tracking processed events to prevent duplicates */
const processedEvents = new Set<string>();

/** Interval for cleaning up expired events from the deduplication cache (5 minutes) */
const CACHE_CLEANUP_INTERVAL = 300000;

/** Duration to retain processed events in the cache (1 hour) */
const EVENT_RETENTION_DURATION = 3600000;

/**
 * Main function orchestrating the application lifecycle.
 * Initializes all components and manages the core event processing loop.
 *
 * This function:
 * 1. Initializes and validates configuration
 * 2. Sets up and verifies the KV store
 * 3. Authenticates with ATP
 * 4. Establishes Jetstream connection
 * 5. Sets up event processing and monitoring
 *
 * @throws {AtpError} If ATP initialization or authentication fails
 * @throws {JetstreamError} If Jetstream connection or initialization fails
 */
async function main() {
	try {
		await initializeConfig();
		if (!(await verifyKvStore())) {
			throw new Error('KV store verification failed');
		}
		logger.info('KV store verified successfully');

		// Ensure cursor is properly initialized
		const expectedCursor = Date.now() * 1000;
		if (CONFIG.CURSOR < expectedCursor) {
			logger.info(
				`Cursor needs update. Current: ${CONFIG.CURSOR}, setting to: ${expectedCursor} (${
					new Date(expectedCursor / 1000).toISOString()
				})`,
			);
			await setConfigValue('CURSOR', expectedCursor);
		} else {
			logger.info(
				`Cursor is current: ${CONFIG.CURSOR} (${
					new Date(CONFIG.CURSOR / 1000).toISOString()
				})`,
			);
		}

		// Initialize core services
		const agent = new AtpAgent({ service: CONFIG.BSKY_URL });
		const metrics = new MetricsTracker(kv);
		const labeler = new Labeler(metrics);

		// Validate required authentication configuration
		if (!CONFIG.BSKY_HANDLE || !CONFIG.BSKY_PASSWORD) {
			throw new AtpError(
				'BSKY_HANDLE and BSKY_PASSWORD must be set in the configuration',
			);
		}

		// Authenticate with ATP service
		try {
			await agent.login({
				identifier: CONFIG.BSKY_HANDLE,
				password: CONFIG.BSKY_PASSWORD,
			});
			logger.info('Logged in to ATP successfully');
		} catch (error) {
			if (error instanceof Error) {
				throw new AtpError(`ATP login failed: ${error.message}`);
			} else {
				throw new AtpError('ATP login failed: Unknown error');
			}
		}

		await labeler.init();

		try {
			// Initialize Jetstream connection
			const jetstream = new Jetstream({
				wantedCollections: [CONFIG.COLLECTION],
				endpoint: CONFIG.JETSTREAM_URL,
				cursor: CONFIG.CURSOR,
			});

			// Configure event handling
			setupJetstreamListeners(jetstream, labeler);

			// Configure cache cleanup
			setInterval(() => {
				const now = Date.now();
				for (const eventId of processedEvents) {
					const [, , timeStr] = eventId.split(':');
					const eventTime = parseInt(timeStr);
					if (now - eventTime > EVENT_RETENTION_DURATION) {
						processedEvents.delete(eventId);
					}
				}
			}, CACHE_CLEANUP_INTERVAL);

			// Initialize and start connection management
			const handler = new Handler(jetstream);
			await handler.start();
			logger.info('Jetstream started with connection management');

			setupCursorUpdateInterval(jetstream, handler);
			setupShutdownHandlers(labeler, handler);
		} catch (error) {
			if (error instanceof Error) {
				throw new JetstreamError(
					`Jetstream initialization failed: ${error.message}`,
				);
			} else {
				throw new JetstreamError(
					'Jetstream initialization failed: Unknown error',
				);
			}
		}
	} catch (error) {
		if (error instanceof AtpError || error instanceof JetstreamError) {
			logger.error(`Error in main: ${error.message}`);
		} else {
			logger.error(`Error in main: ${String(error)}`);
		}
		Deno.exit(1);
	}
}

/**
 * Generates a unique identifier for event deduplication.
 * Combines the event's DID, revision, and timestamp to create a unique string.
 *
 * @param event - The Jetstream event requiring a unique identifier
 * @returns A unique string identifier for the event
 */
function generateEventId(
	event: CommitCreateEvent<string>,
): string {
	return `${event.did}:${event.commit.rev}:${Date.now()}`;
}

/**
 * Configures Jetstream event listeners and processing logic.
 * Handles event validation and processing through the labeler.
 *
 * @param jetstream - The Jetstream instance for event subscription
 * @param labeler - The Labeler instance for event processing
 */
function setupJetstreamListeners(
	jetstream: Jetstream<string, string>,
	labeler: Labeler,
) {
	jetstream.onCreate(
		CONFIG.COLLECTION,
		async (event: CommitCreateEvent<typeof CONFIG.COLLECTION>) => {
			try {
				const eventId = generateEventId(event);
				if (processedEvents.has(eventId)) {
					logger.debug(`Skipping duplicate create event: ${eventId}`);
					return;
				}

				if (!isValidEvent(event)) {
					logger.error('Received invalid event structure:', { event });
					return;
				}

				if (event.commit?.record?.subject?.uri?.includes(CONFIG.DID)) {
					const validatedDID = DidSchema.parse(event.did);
					const rkey = event.commit.record.subject.uri.split('/').pop();

					if (!rkey) {
						logger.error('Could not extract rkey from event:', { event });
						return;
					}

					const validatedRkey = RkeySchema.parse(rkey);
					await labeler.handleLike(validatedDID, validatedRkey);

					if (jetstream.cursor) {
						await setConfigValue('CURSOR', jetstream.cursor);
					}
				}
			} catch (error) {
				logger.error(
					`Error processing event: ${
						error instanceof Error ? error.message : String(error)
					}`,
				);
			}
		},
	);
}

/**
 * Event structure type guard.
 * Ensures incoming events conform to the expected format.
 *
 * @param event - The event object requiring validation
 * @returns Boolean indicating if the event structure is valid
 */
function isValidEvent(event: unknown): event is {
	did: string;
	commit: {
		record: {
			subject: {
				uri: string;
			};
		};
	};
} {
	if (typeof event !== 'object' || event === null) return false;

	const e = event as Record<string, unknown>;
	return (
		typeof e.did === 'string' &&
		typeof e.commit === 'object' && e.commit !== null &&
		typeof (e.commit as Record<string, unknown>).record === 'object' &&
		(e.commit as Record<string, unknown>).record !== null &&
		typeof ((e.commit as Record<string, unknown>).record as Record<
				string,
				unknown
			>).subject === 'object' &&
		((e.commit as Record<string, unknown>).record as Record<string, unknown>)
				.subject !== null &&
		typeof (((e.commit as Record<string, unknown>).record as Record<
				string,
				unknown
			>).subject as Record<string, unknown>).uri === 'string'
	);
}

/**
 * Establishes periodic cursor state persistence.
 * Ensures recovery point maintenance for event processing.
 *
 * @param jetstream - The Jetstream instance providing cursor values
 * @param handler - The Handler instance managing connection state
 */
function setupCursorUpdateInterval(
	jetstream: Jetstream<string, string>,
	handler: Handler,
) {
	setInterval(async () => {
		if (jetstream.cursor && handler.connected) {
			logger.info(
				`Updating cursor to: ${jetstream.cursor} (${
					new Date(jetstream.cursor / 1000).toISOString()
				})`,
			);
			await kv.set(['cursor'], jetstream.cursor);
		}
	}, CONFIG.CURSOR_INTERVAL);
}

/**
 * Configures handlers for graceful application shutdown.
 * Ensures proper cleanup of resources during application termination.
 *
 * @param labeler - The Labeler instance requiring cleanup
 * @param handler - The Handler instance managing connection state
 */
function setupShutdownHandlers(labeler: Labeler, handler: Handler) {
	let isShuttingDown = false;

	const shutdown = async () => {
		if (isShuttingDown) {
			return;
		}
		isShuttingDown = true;

		logger.info('Initiating shutdown sequence...');

		try {
			await Promise.race([
				handler.shutdown(),
				new Promise((resolve) => setTimeout(resolve, 7000)),
			]);
			await labeler.shutdown();
			await closeConfig();
			kv.close();
			logger.info('Shutdown completed successfully');
		} catch (error) {
			logger.error(
				`Error during shutdown: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		} finally {
			Deno.exit(0);
		}
	};

	Deno.addSignalListener('SIGINT', shutdown);
	Deno.addSignalListener('SIGTERM', shutdown);
}

// Application entry point
main().catch((error) => {
	logger.critical(
		`Unhandled error in main: ${
			error instanceof Error ? error.message : String(error)
		}`,
	);
	Deno.exit(1);
});
