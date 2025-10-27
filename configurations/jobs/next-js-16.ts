import { defineJob } from '../types.js';

export default defineJob([
	{
		entry: 'https://nextjs.org/docs/app/getting-started/proxy',
		match: [
			'https://nextjs.org/docs/app/api-reference/**',
			'https://nextjs.org/docs/architecture/accessibility',
			'https://nextjs.org/docs/app/getting-started/metadata-and-og-images',
		],
		selector: 'article',
	},
]);
