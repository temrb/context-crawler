import { defineJob } from '../types.js';

export default defineJob([
	{
		name: 'api-reference',
		entry: 'https://nextjs.org/docs/app/api-reference',
		match: ['https://nextjs.org/docs/app/api-reference/**'],
		selector: 'article',
	},
	{
		name: 'metadata',
		entry: 'https://nextjs.org/docs/app/getting-started/metadata-and-og-images',
		match: 'https://nextjs.org/docs/app/getting-started/metadata-and-og-images',
		selector: 'article',
	},
	{
		name: 'architecture-accessibility',
		entry: 'https://nextjs.org/docs/architecture/accessibility',
		match: 'https://nextjs.org/docs/architecture/accessibility',
		selector: 'article',
	},
	{
		name: 'proxy',
		entry: 'https://nextjs.org/docs/app/getting-started/proxy',
		match: 'https://nextjs.org/docs/app/getting-started/proxy',
		selector: 'article',
	},
]);
