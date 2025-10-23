import { NamedConfig } from '../schema';

const react = [
	{
		name: 'react-19-reference',
		url: 'https://react.dev/reference/react',
		match: 'https://react.dev/reference/react/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/react/react-19.json',
		maxTokens: 2000000,
	},
	{
		name: 'react-19-dom-reference',
		url: 'https://react.dev/reference/react-dom',
		match: 'https://react.dev/reference/react-dom/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/react/react-19-dom.json',
		maxTokens: 2000000,
	},
] as const satisfies readonly NamedConfig[];

const nextJs = [
	{
		name: 'nextjs-16-gs',
		url: 'https://nextjs.org/docs/app/getting-started',
		match: 'https://nextjs.org/docs/app/getting-started/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/nextjs-16-gs.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-api-reference-directives',
		url: 'https://nextjs.org/docs/app/api-reference/directives',
		match: 'https://nextjs.org/docs/app/api-reference/directives/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/api-reference/directives.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-api-reference-components',
		url: 'https://nextjs.org/docs/app/api-reference/components',
		match: 'https://nextjs.org/docs/app/api-reference/components/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/api-reference/components.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-api-reference-fsc',
		url: 'https://nextjs.org/docs/app/api-reference/file-conventions',
		match: 'https://nextjs.org/docs/app/api-reference/file-conventions/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/api-reference/file-conventions.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-api-reference-fsc-metadata',
		url: 'https://nextjs.org/docs/app/api-reference/file-conventions/metadata',
		match:
			'https://nextjs.org/docs/app/api-reference/file-conventions/metadata/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/api-reference/metadata.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-api-reference-functions',
		url: 'https://nextjs.org/docs/app/api-reference/functions',
		match: 'https://nextjs.org/docs/app/api-reference/functions/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/api-reference/functions.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-api-reference-config',
		url: 'https://nextjs.org/docs/app/api-reference/config',
		match: 'https://nextjs.org/docs/app/api-reference/config/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/api-reference/functions.json',
		maxTokens: 2000000,
	},
	{
		name: 'nextjs-16-architecture-accessibility',
		url: 'https://nextjs.org/docs/architecture/accessibility',
		match: 'https://nextjs.org/docs/architecture/accessibility/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/nextjs/accessibility.json',
		maxTokens: 2000000,
	},
] as const satisfies readonly NamedConfig[];

const trpc = [
	{
		name: 'trpc-backend-reference',
		url: 'https://trpc.io/docs/server',
		match: 'https://trpc.io/docs/server/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/trpc/trpc-backend.json',
		maxTokens: 2000000,
	},
	{
		name: 'trpc-backend-nextjs-adapter',
		url: 'https://trpc.io/docs/server/adapters/nextjs',
		match: 'https://trpc.io/docs/server/adapters/nextjs',
		selector: 'article',
		maxPagesToCrawl: 1,
		outputFileName: 'data/trpc/trpc-backend-nextjs-adapter.json',
		maxTokens: 2000000,
	},
	{
		name: 'trpc-client-reference',
		url: 'https://trpc.io/docs/client',
		match: 'https://trpc.io/docs/client/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/trpc/trpc-client.json',
		maxTokens: 2000000,
	},
] as const satisfies readonly NamedConfig[];

const prisma = [
	{
		name: 'prisma-reference',
		url: 'https://www.prisma.io/docs/orm/reference',
		match: 'https://www.prisma.io/docs/orm/reference/**',
		selector: 'article',
		maxPagesToCrawl: 500,
		outputFileName: 'data/prisma/prisma-reference.json',
		maxTokens: 2000000,
	},
] as const satisfies readonly NamedConfig[];

// ============================================
// Exports
// ============================================

/**
 * Map of batch configurations organized by category.
 */
export const batchConfigs = {
	react,
	nextJs,
	trpc,
	prisma,
} as const;
