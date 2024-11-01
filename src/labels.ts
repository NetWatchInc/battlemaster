/**
 * Label definitions
 *
 * This module defines the source of truth for available labels.
 */

/**
 * Readonly array of Label objects that are validated against the schema.
 * Each label is comprised of rkey, identifier, and category.
 */

export const LABELS = [
	{
		rkey: '3l7jxzftheq2o',
		identifier: 'pvp',
		category: 'pvp',
	},
	{
		rkey: '3l7jy25rx3t2s',
		identifier: 'pve',
		category: 'pve',
	},
	{
		rkey: '3l7jy2pqpz72p',
		identifier: 'rp',
		category: 'rp',
	},
	// rkey for label removal
	{
		rkey: '3l7jy2zq3z2qo',
		identifier: '',
		category: '',
	},
] as const;
