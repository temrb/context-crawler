import { defineJob } from '../types.js';

export default defineJob({
	name: 'reference',
	entry: 'https://react.dev/reference/react',
	match: [
		'https://react.dev/reference/react/**',
		'https://react.dev/reference/react-dom/**',
	],
	selector: 'article',
});
