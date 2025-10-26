import { defineJob } from '../types.js';

export default defineJob({
	name: 'zod-docs',
	entry: 'https://zod.dev',
	match: [
		'https://zod.dev/basics',
		'https://zod.dev/api',
		'https://zod.dev/error-customization',
		'https://zod.dev/error-formatting',
		'https://zod.dev/metadata',
		'https://zod.dev/json-schema',
		'https://zod.dev/codecs',
		'https://zod.dev/packages/zod',
		'https://zod.dev/packages/mini',
		'https://zod.dev/packages/core',
	],
	selector: 'article',
});
