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
import { Jetstream } from 'jetstream';
import { Labeler } from './labeler.ts';
import { closeConfig, CONFIG, initializeConfig } from './config.ts';
import { DidSchema, RkeySchema } from './schemas.ts';
import { verifyKvStore } from '../scripts/kv_utils.ts';
import { AtpError, JetstreamError } from './errors.ts';
import * as log from '@std/log';
import { MetricsTracker } from './metrics.ts';
import { Handler } from './handler.ts';

const kv = await Deno.openKv();
const logger = log.getLogger();

/**
 * Orchestrates the Battlemaster application lifecycle.
 * Initializes core services and establishes necessary connections.
 *
 * The function follows a sequential initialization process:
 * 1. Configuration and KV store setup
 * 2. ATP authentication
 * 3. Labeler initialization
 * 4. Jetstream connection establishment
 * 5. Event handler configuration
 *
 * @throws {AtpError} If ATP initialization or authentication fails
 * @throws {JetstreamError} If Jetstream connection initialization fails
 */
async function main() {
	try {
		await initializeConfig();
		if (!(await verifyKvStore())) {
			throw new Error('KV store verification failed');
		}
		logger.info('KV store verified successfully');

		const agent = new AtpAgent({ service: CONFIG.BSKY_URL });
		const metrics = new MetricsTracker(kv);
		const labeler = new Labeler(metrics);

		if (!CONFIG.BSKY_HANDLE || !CONFIG.BSKY_PASSWORD) {
			throw new AtpError(
				'BSKY_HANDLE and BSKY_PASSWORD must be set in the configuration',
			);
		}

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

		const cursor = await initializeCursor();

		try {
			const jetstream = new Jetstream({
				wantedCollections: [CONFIG.COLLECTION],
				endpoint: CONFIG.JETSTREAM_URL,
				cursor: cursor,
			});

			// Configure event processing
			setupJetstreamListeners(jetstream, labeler);

			// Initialize connection management
			const handler = new Handler(jetstream);
			await handler.start();
			logger.info('Jetstream started with connection management');

			setupCursorUpdateInterval(jetstream);
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
 * Manages cursor initialization and retrieval.
 * Ensures proper event tracking by maintaining the last processed position.
 *
 * @returns The cursor value in microseconds since epoch
 */
async function initializeCursor(): Promise<number> {
	const cursorResult = await kv.get(['cursor']);
	if (cursorResult.value === null) {
		const cursor = Date.now() * 1000;
		logger.info(
			`Cursor not found, setting to: ${cursor} (${
				new Date(cursor / 1000).toISOString()
			})`,
		);
		await kv.set(['cursor'], cursor);
		return cursor;
	} else {
		const cursor = cursorResult.value as number;
		logger.info(
			`Cursor found: ${cursor} (${new Date(cursor / 1000).toISOString()})`,
		);
		return cursor;
	}
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
	jetstream.onCreate(CONFIG.COLLECTION, async (event: unknown) => {
		try {
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
			}
		} catch (error) {
			logger.error(
				`Error processing event: ${
					error instanceof Error ? error.message : String(error)
				}`,
			);
		}
	});
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
 */
function setupCursorUpdateInterval(jetstream: Jetstream<string, string>) {
	setInterval(async () => {
		if (jetstream.cursor) {
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
 * Configures graceful shutdown handlers.
 * Ensures proper cleanup of resources during application termination.
 *
 * @param labeler - The Labeler instance requiring cleanup
 * @param handler - The Handler instance managing connection state
 */
function setupShutdownHandlers(labeler: Labeler, handler: Handler) {
	const shutdown = async () => {
		logger.info('Shutting down...');
		await labeler.shutdown();
		await handler.shutdown();
		await closeConfig();
		kv.close();
		Deno.exit(0);
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
