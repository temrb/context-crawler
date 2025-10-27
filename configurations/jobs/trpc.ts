import { defineJob } from '../types.js';

export default defineJob({
	entry: 'https://trpc.io/docs/server/introduction',
	match: [
		'https://trpc.io/docs/server/**',
		'https://trpc.io/docs/client/**',
		'https://trpc.io/docs/typedoc/**',
	],
	selector: 'article',
});
