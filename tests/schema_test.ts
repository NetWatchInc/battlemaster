import { assertEquals, assertThrows } from '@std/assert';
import {
	ConfigSchema,
	LabelSchema,
	LabelValueDefinitionSchema,
	LocaleSchema,
} from '../src/schemas.ts';

Deno.test('LocaleSchema validation', () => {
	const validLocale = {
		lang: 'en',
		name: 'English',
		description: 'English language',
	};
	assertEquals(LocaleSchema.parse(validLocale), validLocale);

	assertThrows(
		() => LocaleSchema.parse({ ...validLocale, lang: 123 }),
		Error,
		'Expected string, received number',
	);
});

Deno.test('LabelSchema validation', () => {
	const validLabel = {
		rkey: '3jzfcijpj2z2a',
		identifier: 'test-label',
		locales: [
			{ lang: 'en', name: 'Test Label', description: 'A test label' },
		],
	};
	assertEquals(LabelSchema.parse(validLabel), validLabel);

	assertThrows(
        () => LabelSchema.parse({ ...validLabel, rkey: '3jzfcijpj2z2aa' }),
		Error,
		'String must contain exactly 13 character(s)',
	);
});

Deno.test('LabelValueDefinitionSchema validation', () => {
	const validLabelValueDefinition = {
		identifier: 'test-label',
		severity: 'inform',
		blurs: 'none',
		defaultSetting: 'warn',
		adultOnly: false,
		locales: [
			{ lang: 'en', name: 'Test Label', description: 'A test label' },
		],
	};
	assertEquals(
		LabelValueDefinitionSchema.parse(validLabelValueDefinition),
		validLabelValueDefinition,
	);

	assertThrows(
		() =>
			LabelValueDefinitionSchema.parse({
				...validLabelValueDefinition,
				severity: 'invalid',
			}),
		Error,
		"Invalid enum value. Expected 'inform' | 'alert' | 'none', received 'invalid'",
	);
});

Deno.test('ConfigSchema validation', () => {
	const validConfig = {
		DID: 'did:plc:?',
		SIGNING_KEY: 'did:key:?',
		JETSTREAM_URL: 'wss://jetstream.atproto.tools/subscribe',
		COLLECTION: 'app.bsky.feed.like',
		CURSOR_INTERVAL: 100000,
		BSKY_HANDLE: 'battlemaster.netwatch.dev',
		BSKY_PASSWORD: 'this-is-a-very-secure-password',
	};
	assertEquals(ConfigSchema.parse(validConfig), validConfig);

	assertThrows(
		() => ConfigSchema.parse({ ...validConfig, JETSTREAM_URL: 'not-a-url' }),
		Error,
		'Invalid url',
	);
});
