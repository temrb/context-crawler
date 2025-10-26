import { defineJob } from '../types.js';

export default defineJob({
	name: 'polar-sh',
	entry: 'https://polar.sh/docs',
	match: [
		'https://polar.sh/docs/features/**',
		'https://polar.sh/docs/integrate/authentication/**',
		'https://polar.sh/docs/api-reference/**',
		'https://polar.sh/docs/guides/**',
	],
	exclude: ['**/support', '**/changelog', '**/llms-full.txt*'],
	selector: '#content-area',
});
